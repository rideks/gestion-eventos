// @ts-check
// Repositorio de los documentos del proveedor (tabla supplier_invoices): FACTURAS y PROFORMAS, y qué pagos
// cubre cada uno (payment_documents: un pago puede tener varios documentos y un documento cubrir varios pagos).
// Sin permisos ni reglas: eso lo decide el servicio de pagos (src/services/payments.js).

/** @typedef {import('../services/types').Db} Db */

import { likeTerm } from './payments.js';

const COLUMNS = `si.*, f.name AS file_name, u.name AS uploaded_by_name, r.name AS reviewed_by_name,
  (SELECT COUNT(*) FROM payment_documents x WHERE x.document_id = si.id) AS payment_count`;
const JOINS = `LEFT JOIN files f ON f.id = si.file_id
  LEFT JOIN users u ON u.id = si.uploaded_by LEFT JOIN users r ON r.id = si.reviewed_by`;

/**
 * Factura (alias si) lista para conformar: está en algún pago y todos los que cubre están hechos
 * (lo usan también los contadores del menú)
 */
export const READY_TO_CONFORM = `EXISTS (SELECT 1 FROM payment_documents pd WHERE pd.document_id = si.id)
  AND NOT EXISTS (SELECT 1 FROM payment_documents pd JOIN payments p ON p.id = pd.payment_id
                   WHERE pd.document_id = si.id AND p.status != 'pagado')`;

// ── Consultas ──────────────────────────────────────────────────────────────

/** Un documento con su archivo, quién lo subió / revisó y cuántos pagos cubre @param {Db} db @param {number} id */
export const byId = (db, id) => db.prepare(`SELECT ${COLUMNS} FROM supplier_invoices si ${JOINS} WHERE si.id = ?`).bind(id).first();

/** Documentos de un pago, los más recientes primero @param {Db} db @param {number} paymentId */
export const forPayment = (db, paymentId) => db.prepare(
  `SELECT ${COLUMNS} FROM payment_documents pd JOIN supplier_invoices si ON si.id = pd.document_id ${JOINS}
    WHERE pd.payment_id = ? ORDER BY si.uploaded_at DESC, si.id DESC`,
).bind(paymentId).all().then((r) => r.results);

/**
 * Pagos que cubre cada documento de un pago (en una sola consulta): Map document_id → pagos
 * @param {Db} db
 * @param {number} paymentId
 * @returns {Promise<Map<number, any[]>>}
 */
export async function coverage(db, paymentId) {
  const { results } = await db.prepare(
    `SELECT pd.document_id, p.id, p.supplier, p.concept, p.total_cents, p.status
       FROM payment_documents pd JOIN payments p ON p.id = pd.payment_id
      WHERE pd.document_id IN (SELECT document_id FROM payment_documents WHERE payment_id = ?)
      ORDER BY p.id`,
  ).bind(paymentId).all();
  const map = new Map();
  for (const r of results) map.set(r.document_id, [...(map.get(r.document_id) ?? []), r]);
  return map;
}

/** Documentos ya subidos en el expediente (para «es un documento que ya está subido») @param {Db} db @param {number} expedienteId */
export const forExpediente = (db, expedienteId) => db.prepare(
  'SELECT si.id, si.kind, si.supplier, si.number FROM supplier_invoices si WHERE si.expediente_id = ? ORDER BY si.supplier, si.id',
).bind(expedienteId).all().then((r) => r.results);

/** El estado de los pagos que cubre (para saber si ya se puede conformar) @param {Db} db @param {number} id */
export const coveredStatuses = (db, id) => db.prepare(
  'SELECT p.status FROM payment_documents pd JOIN payments p ON p.id = pd.payment_id WHERE pd.document_id = ?',
).bind(id).all().then((r) => r.results);

/** ¿Cubre todavía algún pago? @param {Db} db @param {number} id */
export const isUsed = (db, id) => db.prepare('SELECT 1 AS used FROM payment_documents WHERE document_id = ? LIMIT 1').bind(id).first().then((r) => !!r);

/**
 * Facturas de proveedor pendientes de revisar por Administración (las más antiguas primero),
 * con los pagos que cubren. Las proformas no se revisan.
 * unpaid_count: pagos que cubre aún sin hacer (hasta que se hagan, la factura espera: no se puede conformar).
 * replaces_conforme: el pago ya tenía otra factura conforme (se ha subido otra; su motivo va en notes).
 * @param {Db} db
 * @param {string} [q]
 */
export function toReview(db, q = '') {
  return db.prepare(
    `SELECT si.*, f.name AS file_name, u.name AS uploaded_by_name, e.number AS exp_number, e.name AS exp_name, e.status AS exp_status,
            (SELECT COUNT(*) FROM payment_documents pd WHERE pd.document_id = si.id) AS payment_count,
            (SELECT COALESCE(SUM(p.total_cents), 0) FROM payment_documents pd JOIN payments p ON p.id = pd.payment_id WHERE pd.document_id = si.id) AS payments_total,
            (SELECT MIN(pd.payment_id) FROM payment_documents pd WHERE pd.document_id = si.id) AS first_payment_id,
            (SELECT COUNT(*) FROM payment_documents pd JOIN payments p ON p.id = pd.payment_id
              WHERE pd.document_id = si.id AND p.status != 'pagado') AS unpaid_count,
            EXISTS (SELECT 1 FROM payment_documents pd JOIN payment_documents o ON o.payment_id = pd.payment_id AND o.document_id != si.id
                      JOIN supplier_invoices od ON od.id = o.document_id
                     WHERE pd.document_id = si.id AND od.kind = 'factura' AND od.review = 'conforme') AS replaces_conforme
       FROM supplier_invoices si JOIN expedientes e ON e.id = si.expediente_id
       LEFT JOIN files f ON f.id = si.file_id LEFT JOIN users u ON u.id = si.uploaded_by
      WHERE si.kind = 'factura' AND si.review = 'pendiente' AND e.status != 'cancelado'
        AND (?1 = '%%' OR si.supplier LIKE ?1 OR si.number LIKE ?1 OR e.name LIKE ?1 OR CAST(e.number AS TEXT) LIKE ?1)
      ORDER BY si.uploaded_at, si.id`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

// ── Cambios ────────────────────────────────────────────────────────────────

/**
 * Documento nuevo de un pago (el proveedor, el del pago)
 * @param {Db} db
 * @param {{ id: number, expediente_id: number, supplier: string }} payment
 * @param {{ kind: string, number: string | null, issued_on: string | null, total: number | null, comment: string | null, fileId: number | null,
 *           conforme: boolean, userId: number | null, at: string }} d
 * @returns {Promise<number>} id del documento
 */
export async function insert(db, payment, d) {
  const row = await db.prepare(
    `INSERT INTO supplier_invoices (expediente_id, kind, supplier, supplier_id, number, issued_on, total_cents, file_id, review, reviewed_by, reviewed_at, uploaded_by, uploaded_at, notes)
     VALUES (?, ?, ?, (SELECT supplier_id FROM payments WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(payment.expediente_id, d.kind, payment.supplier, payment.id, d.number, d.issued_on, d.total, d.fileId,
    d.conforme ? 'conforme' : 'pendiente', d.conforme ? d.userId : null, d.conforme ? d.at : null, d.userId, d.at, d.comment).first();
  return row.id;
}

/** El documento cubre (también) ese pago @param {Db} db @param {number} paymentId @param {number} documentId */
export const linkStmt = (db, paymentId, documentId) => db.prepare('INSERT OR IGNORE INTO payment_documents (payment_id, document_id) VALUES (?, ?)').bind(paymentId, documentId);

/** @param {Db} db @param {number} paymentId @param {number} documentId */
export const unlinkStmt = (db, paymentId, documentId) => db.prepare('DELETE FROM payment_documents WHERE payment_id = ? AND document_id = ?').bind(paymentId, documentId);

/** @param {Db} db @param {number} id */
export const deleteStmt = (db, id) => db.prepare('DELETE FROM supplier_invoices WHERE id = ?').bind(id);

/**
 * Factura revisada: su número (y fecha) y conforme
 * @param {Db} db
 * @param {number} id
 * @param {{ number: string, issued_on: string | null }} d
 * @param {number | null} userId
 * @param {string} at
 */
export const conformStmt = (db, id, d, userId, at) => db.prepare(
  "UPDATE supplier_invoices SET number = ?, issued_on = ?, review = 'conforme', reviewed_by = ?, reviewed_at = ? WHERE id = ?",
).bind(d.number, d.issued_on, userId, at, id);
