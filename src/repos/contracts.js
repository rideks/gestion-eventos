// @ts-check
// Repositorio de contratos de proveedor: TODO el SQL de supplier_contracts y su historial.
// Sin permisos ni reglas: eso lo decide el servicio (src/services/contracts.js).
// Las funciones que acaban en Stmt devuelven sentencias para juntarlas en un db.batch (atómico).

/**
 * Contratos que requieren atención, en SQL (alias c; `now`: el parámetro con la fecha de hoy).
 * Es la misma regla que `attention` de contractState (src/lib/contracts.js): una prueba comprueba que coinciden.
 */
export const contractDue = (now = '?1') => `c.starts_on <= ${now}
  AND NOT EXISTS (SELECT 1 FROM supplier_contracts r WHERE r.replaces_id = c.id)
  AND (c.renewal IS NULL OR c.renewal <> 'no')
  AND (c.renewal = 'pendiente'
       OR c.ends_on < ${now}
       OR (c.alert_days IS NOT NULL AND c.ends_on <= date(${now}, '+' || c.alert_days || ' days')))`;

const SELECT = `c.*, s.name AS supplier_name, s.city AS supplier_city, s.status AS supplier_status, t.name AS supplier_type,
  (SELECT r.id FROM supplier_contracts r WHERE r.replaces_id = c.id) AS renewed_by,
  f.name AS file_name, u.name AS created_by_name`;
const JOINS = `JOIN suppliers s ON s.id = c.supplier_id LEFT JOIN supplier_types t ON t.id = s.type_id
  LEFT JOIN files f ON f.id = c.file_id LEFT JOIN users u ON u.id = c.created_by`;

/** Los contratos de un proveedor */
export const forSupplier = (db, supplierId) => db.prepare(
  `SELECT ${SELECT} FROM supplier_contracts c ${JOINS} WHERE c.supplier_id = ? ORDER BY c.starts_on DESC, c.id DESC`,
).bind(supplierId).all().then((r) => r.results);

/** Todos (q busca en el proveedor, el nombre del contrato y la ciudad) */
export const all = (db, q = '') => db.prepare(
  `SELECT ${SELECT} FROM supplier_contracts c ${JOINS}
    WHERE (?1 = '%%' OR s.name LIKE ?1 OR c.title LIKE ?1 OR s.city LIKE ?1) ORDER BY c.ends_on, c.id LIMIT 1000`,
).bind(`%${q}%`).all().then((r) => r.results);

/** Los que requieren atención */
export const due = (db, now) => db.prepare(
  `SELECT ${SELECT} FROM supplier_contracts c ${JOINS} WHERE ${contractDue()} ORDER BY c.ends_on IS NULL, c.ends_on, c.id`,
).bind(now).all().then((r) => r.results);

/** Cuántos requieren atención (contador del menú) */
export const dueCount = (db, now) => db.prepare(`SELECT COUNT(*) AS n FROM supplier_contracts c WHERE ${contractDue()}`).bind(now).first().then((r) => r.n);

/** Un contrato con su proveedor, el contrato al que renueva, su renovación y su historial */
export async function detail(db, id) {
  const [c, history] = await db.batch([
    db.prepare(`SELECT ${SELECT}, p.title AS replaces_title, p.starts_on AS replaces_starts_on, p.ends_on AS replaces_ends_on,
                       n.title AS renewed_title, n.starts_on AS renewed_starts_on
                  FROM supplier_contracts c ${JOINS}
                  LEFT JOIN supplier_contracts p ON p.id = c.replaces_id
                  LEFT JOIN supplier_contracts n ON n.replaces_id = c.id
                 WHERE c.id = ?`).bind(id),
    db.prepare(`SELECT h.*, u.name AS user_name FROM supplier_contract_changes h LEFT JOIN users u ON u.id = h.user_id
                 WHERE h.contract_id = ? ORDER BY h.at DESC, h.id DESC`).bind(id),
  ]);
  return c.results[0] ? { contract: c.results[0], history: history.results } : null;
}

/** El contrato de un proveedor (con el id de su renovación, si la tiene) */
export const ofSupplier = (db, id, supplierId) => db.prepare(
  `SELECT c.*, (SELECT r.id FROM supplier_contracts r WHERE r.replaces_id = c.id) AS renewed_by
     FROM supplier_contracts c WHERE c.id = ? AND c.supplier_id = ?`,
).bind(id, supplierId).first();

// ── Cambios ────────────────────────────────────────────────────────────────

/**
 * @param {import('../services/types').Db} db
 * @param {number} supplierId
 * @param {Record<string, any>} d datos ya validados (ContractSchema)
 * @param {{ replacesId?: number | null, fileId?: number | null, userId: number | null }} options
 * @returns {Promise<number>} id del contrato
 */
export function insert(db, supplierId, d, { replacesId = null, fileId = null, userId }) {
  return db.prepare(
    `INSERT INTO supplier_contracts (supplier_id, title, signed_on, starts_on, ends_on, conditions, rates, discounts, credit_terms,
                                     payment_terms, other_terms, notes, alert_days, replaces_id, file_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(supplierId, d.title, d.signed_on, d.starts_on, d.ends_on, d.conditions, d.rates, d.discounts, d.credit_terms,
    d.payment_terms, d.other_terms, d.notes, d.alert_days, replacesId, fileId, userId).first().then((r) => r.id);
}

export function updateStmt(db, id, d) {
  return db.prepare(
    `UPDATE supplier_contracts SET title = ?, signed_on = ?, starts_on = ?, ends_on = ?, conditions = ?, rates = ?, discounts = ?,
            credit_terms = ?, payment_terms = ?, other_terms = ?, notes = ?, alert_days = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
  ).bind(d.title, d.signed_on, d.starts_on, d.ends_on, d.conditions, d.rates, d.discounts, d.credit_terms,
    d.payment_terms, d.other_terms, d.notes, d.alert_days, id);
}

/** @param {import('../services/types').Db} db @param {number} id @param {'pendiente' | 'no' | null} renewal */
export const renewalStmt = (db, id, renewal) => db.prepare(
  "UPDATE supplier_contracts SET renewal = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
).bind(renewal, id);

export const fileStmt = (db, id, fileId) => db.prepare('UPDATE supplier_contracts SET file_id = ? WHERE id = ?').bind(fileId, id);

export const deleteStmt = (db, id) => db.prepare('DELETE FROM supplier_contracts WHERE id = ?').bind(id);

/**
 * Apunta algo en el historial de un contrato (summary ya redactado; changes: { campo: [antes, después] })
 * @param {import('../services/types').Db} db
 * @param {number} contractId
 * @param {number | null} userId
 * @param {'alta' | 'cambio' | 'renovacion' | 'renovado' | 'marca' | 'documento'} action
 * @param {string} summary
 * @param {Record<string, [unknown, unknown]> | null} [changes]
 */
export function changeStmt(db, contractId, userId, action, summary, changes = null) {
  return db.prepare('INSERT INTO supplier_contract_changes (contract_id, user_id, action, summary, changes) VALUES (?, ?, ?, ?, ?)')
    .bind(contractId, userId, action, summary, changes ? JSON.stringify(changes) : null);
}
