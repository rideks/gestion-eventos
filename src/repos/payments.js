// @ts-check
// Repositorio de pagos a proveedores: TODO el SQL de `payments` (las líneas de coste de cada expediente,
// previstas o con factura, y su pago con el justificante). Sin permisos ni reglas: eso lo decide el servicio
// (src/services/payments.js). Las funciones que acaban en Stmt devuelven sentencias para un db.batch.

/** @typedef {import('../services/types').Db} Db */

/** Texto de búsqueda para LIKE (sin comodines del usuario); '%%' = sin búsqueda */
export const likeTerm = (/** @type {unknown} */ q) => `%${String(q ?? '').trim().slice(0, 80).replace(/[%_]/g, '')}%`;

// Documentos del proveedor de un pago (facturas y proformas; uno puede cubrir varios pagos)
export const DOCS_OF = (/** @type {string} */ where) => `FROM payment_documents pd JOIN supplier_invoices d ON d.id = pd.document_id WHERE pd.payment_id = p.id AND ${where}`;
// Archivo del último documento del pago (factura si hay; si no, proforma), para el enlace de las listas
const LAST_DOC_FILE = `(SELECT d.file_id FROM payment_documents pd JOIN supplier_invoices d ON d.id = pd.document_id
  WHERE pd.payment_id = p.id AND d.file_id IS NOT NULL ORDER BY d.kind = 'factura' DESC, d.id DESC LIMIT 1)`;

/**
 * Columnas de un pago con el resumen de sus documentos y su justificante:
 *  invoice_count / invoice_pending (facturas y cuántas sin revisar), proforma_count,
 *  invoice_number (los números de sus facturas), file_id / file_name (el último documento: factura si hay).
 */
export const PAYMENT_SELECT = `
  p.id, p.expediente_id, p.supplier, p.supplier_id, p.concept, p.base_cents, p.total_cents, p.vat, p.vat_lines, p.due_date, p.status,
  p.paid_on, p.method, p.planned, p.notes, p.created_by, p.created_at, p.updated_at,
  p.receipt_file_id, rf.name AS receipt_name,
  (SELECT COUNT(*) ${DOCS_OF("d.kind = 'factura'")}) AS invoice_count,
  (SELECT COUNT(*) ${DOCS_OF("d.kind = 'factura' AND d.review = 'pendiente'")}) AS invoice_pending,
  (SELECT COUNT(*) ${DOCS_OF("d.kind = 'proforma'")}) AS proforma_count,
  (SELECT group_concat(number, ', ') FROM (SELECT d.number ${DOCS_OF("d.kind = 'factura' AND d.number IS NOT NULL")} ORDER BY pd.document_id)) AS invoice_number,
  df.id AS file_id, df.name AS file_name`;
export const PAYMENT_JOINS = `LEFT JOIN files rf ON rf.id = p.receipt_file_id LEFT JOIN files df ON df.id = ${LAST_DOC_FILE}`;

const SEARCH = `(?1 = '%%' OR p.supplier LIKE ?1 OR p.concept LIKE ?1 OR e.name LIKE ?1 OR CAST(e.number AS TEXT) LIKE ?1
  OR EXISTS (SELECT 1 ${DOCS_OF('d.number LIKE ?1')}))`;
const WITH_EXP = 'e.number AS exp_number, e.name AS exp_name, e.status AS exp_status, e.manager_id AS exp_manager_id';

// ── Consultas ──────────────────────────────────────────────────────────────

/**
 * Un pago de un expediente, con el resumen de sus documentos y quién lo añadió
 * @param {Db} db
 * @param {number} expedienteId
 * @param {number} id
 */
export const byId = (db, expedienteId, id) => db.prepare(
  `SELECT ${PAYMENT_SELECT}, u.name AS created_by_name FROM payments p ${PAYMENT_JOINS} LEFT JOIN users u ON u.id = p.created_by
    WHERE p.id = ? AND p.expediente_id = ?`,
).bind(id, expedienteId).first();

/**
 * Lo justo para marcarlo pagado (desde cualquier lista): el pago y el estado de su expediente
 * @param {Db} db
 * @param {number} id
 */
export const forPaying = (db, id) => db.prepare(
  `SELECT p.id, p.supplier, p.total_cents, p.status, p.expediente_id, p.receipt_file_id, e.status AS exp_status
     FROM payments p JOIN expedientes e ON e.id = p.expediente_id WHERE p.id = ?`,
).bind(id).first();

/**
 * Pagos pendientes de todos los expedientes, por fecha límite; con búsqueda opcional.
 * until: sólo los que vencen hasta esa fecha (inicio: lo urgente)
 * @param {Db} db
 * @param {string} [q]
 * @param {{ until?: string | null }} [options]
 */
export function pending(db, q = '', { until = null } = {}) {
  return db.prepare(
    `SELECT ${PAYMENT_SELECT}, ${WITH_EXP}
       FROM payments p JOIN expedientes e ON e.id = p.expediente_id ${PAYMENT_JOINS}
      WHERE p.status = 'pendiente' AND e.status != 'cancelado' AND ${SEARCH}
        AND (?2 IS NULL OR p.due_date <= ?2)
      ORDER BY p.due_date IS NULL, p.due_date, e.number, p.id`,
  ).bind(likeTerm(q), until).all().then((r) => r.results);
}

/** Pagos ya hechos para los que falta la factura del proveedor; con búsqueda opcional @param {Db} db @param {string} [q] */
export function paidWithoutInvoice(db, q = '') {
  return db.prepare(
    `SELECT ${PAYMENT_SELECT}, ${WITH_EXP}
       FROM payments p JOIN expedientes e ON e.id = p.expediente_id ${PAYMENT_JOINS}
      WHERE p.status = 'pagado' AND p.total_cents != 0 AND e.status != 'cancelado' AND ${SEARCH}
        AND NOT EXISTS (SELECT 1 ${DOCS_OF("d.kind = 'factura'")})
      ORDER BY p.paid_on, p.id`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

/** Pagos ya hechos (historial), los más recientes primero; con búsqueda opcional @param {Db} db @param {string} [q] */
export function paid(db, q = '') {
  return db.prepare(
    `SELECT ${PAYMENT_SELECT}, e.number AS exp_number, e.name AS exp_name, e.status AS exp_status
       FROM payments p JOIN expedientes e ON e.id = p.expediente_id ${PAYMENT_JOINS}
      WHERE p.status = 'pagado' AND ${SEARCH}
      ORDER BY p.paid_on DESC, p.id DESC LIMIT 300`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

// ── Cambios ────────────────────────────────────────────────────────────────

/**
 * Un pago nuevo (con su proveedor de la lista y su desglose de IVA)
 * @param {Db} db
 * @param {number} expedienteId
 * @param {{ supplier: { id: number, name: string }, concept: string | null, amounts: { base: number, total: number, vat: string, lines: unknown[] },
 *           due_date: string | null, status?: string, paid_on?: string | null, method?: string | null, receipt_file_id?: number | null,
 *           notes?: string | null }} d
 * @param {number | null} userId
 */
export function insert(db, expedienteId, d, userId) {
  return db.prepare(
    `INSERT INTO payments (expediente_id, supplier, supplier_id, concept, base_cents, total_cents, vat, vat_lines,
                           due_date, status, paid_on, method, receipt_file_id, planned, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?) RETURNING id, expediente_id, supplier, total_cents, status`,
  ).bind(expedienteId, d.supplier.name, d.supplier.id, d.concept, d.amounts.base, d.amounts.total, d.amounts.vat, JSON.stringify(d.amounts.lines),
    d.due_date, d.status ?? 'pendiente', d.paid_on ?? null, d.method ?? null, d.receipt_file_id ?? null, d.notes ?? null, userId).first();
}

/**
 * Un pago previsto (de «varios pagos previstos»), para el batch
 * @param {Db} db
 * @param {number} expedienteId
 * @param {{ supplier: { id: number, name: string }, concept: string | null, base: number, total: number, vat: string, lines: unknown[], due_date: string | null }} r
 * @param {number | null} userId
 */
export const insertPlannedStmt = (db, expedienteId, r, userId) => db.prepare(
  `INSERT INTO payments (expediente_id, supplier, supplier_id, concept, base_cents, total_cents, vat, vat_lines, due_date, planned, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
).bind(expedienteId, r.supplier.name, r.supplier.id, r.concept, r.base, r.total, r.vat, JSON.stringify(r.lines), r.due_date, userId);

/**
 * Los datos del pago (no su estado: se paga en su paso)
 * @param {Db} db
 * @param {number} id
 * @param {{ supplier: { id: number, name: string }, concept: string | null, amounts: { base: number, total: number, vat: string, lines: unknown[] },
 *           due_date: string | null, notes: string | null }} d
 * @param {string} at
 */
export const updateStmt = (db, id, d, at) => db.prepare(
  `UPDATE payments SET supplier = ?, supplier_id = ?, concept = ?, base_cents = ?, total_cents = ?, vat = ?, vat_lines = ?,
          due_date = ?, notes = ?, updated_at = ? WHERE id = ?`,
).bind(d.supplier.name, d.supplier.id, d.concept, d.amounts.base, d.amounts.total, d.amounts.vat, JSON.stringify(d.amounts.lines),
  d.due_date, d.notes, at, id);

/** @param {Db} db @param {number} id @param {string} paidOn @param {string} method @param {string} at */
export const paidStmt = (db, id, paidOn, method, at) => db.prepare("UPDATE payments SET status = 'pagado', paid_on = ?, method = ?, updated_at = ? WHERE id = ?")
  .bind(paidOn, method, at, id);

/** Vuelve a estar por pagar @param {Db} db @param {number} id @param {string} at */
export const unpaidStmt = (db, id, at) => db.prepare("UPDATE payments SET status = 'pendiente', paid_on = NULL, method = NULL, updated_at = ? WHERE id = ?")
  .bind(at, id);

/** @param {Db} db @param {number} id @param {number | null} fileId @param {string} at */
export const receiptStmt = (db, id, fileId, at) => db.prepare('UPDATE payments SET receipt_file_id = ?, updated_at = ? WHERE id = ?').bind(fileId, at, id);

/** @param {Db} db @param {number} id @param {string} at */
export const touchStmt = (db, id, at) => db.prepare('UPDATE payments SET updated_at = ? WHERE id = ?').bind(at, id);

/** Borra el pago y lo que lo une a sus documentos (los documentos sueltos se borran aparte) @param {Db} db @param {number} id */
export const deleteStmts = (db, id) => [
  db.prepare('DELETE FROM payment_documents WHERE payment_id = ?').bind(id),
  db.prepare('DELETE FROM payments WHERE id = ?').bind(id),
];
