// @ts-check
// Repositorio de facturas al cliente (Cobros): las bandejas (lo que falta por facturar de cada expediente, las PO
// con saldo, las facturas por emitir y por cobrar, las cobradas), sus tablas por páginas y el cobro de una factura.
// Sin permisos ni reglas: eso lo decide el servicio (src/services/invoices.js). La ficha de una factura, emitirla y
// enviarla siguen en sus páginas (src/lib/invoicing.js) hasta pasarlas también a capas.

/** @typedef {import('../services/types').Db} Db */

import { likeTerm } from './payments.js';
import { orderBy } from '../lib/table.js';

// ── Bandejas ───────────────────────────────────────────────────────────────

/** Facturas a cliente por emitir y pendientes de cobro, con sus PO; con búsqueda opcional */
/** @param {Db} db @param {string} [q] */
export function openInvoices(db, q = '') {
  return db.prepare(
    `SELECT * FROM (
       SELECT i.*, e.number AS exp_number, e.name AS exp_name, e.manager_id AS exp_manager_id, f.name AS file_name,
              (SELECT group_concat(po.number, ', ') FROM invoice_pos ip JOIN purchase_orders po ON po.id = ip.po_id WHERE ip.invoice_id = i.id) AS po_numbers
         FROM invoices i JOIN expedientes e ON e.id = i.expediente_id LEFT JOIN files f ON f.id = i.file_id
        WHERE i.status IN ('por_emitir', 'emitida') AND e.status != 'cancelado'
     ) WHERE (?1 = '%%' OR billed_to LIKE ?1 OR number LIKE ?1 OR concept LIKE ?1 OR exp_name LIKE ?1 OR CAST(exp_number AS TEXT) LIKE ?1 OR po_numbers LIKE ?1)
     ORDER BY status = 'emitida', due_date IS NULL, due_date, id`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

/**
 * Lo que falta por facturar de cada expediente en marcha (solicitudes y abiertos): su presupuesto (la
 * última versión, sin IVA) menos lo ya facturado o pedido (facturas no anuladas). Sale en cuanto se
 * crea el expediente con su presupuesto. Con búsqueda opcional.
 */
/** @param {Db} db @param {string} [q] */
export function toInvoiceByExpediente(db, q = '') {
  return db.prepare(
    `SELECT * FROM (
       SELECT e.id, e.number, e.name, e.company, e.status, e.start_date, e.end_date, e.manager_id,
              COALESCE((SELECT b.base_cents FROM budgets b WHERE b.expediente_id = e.id ORDER BY b.version DESC LIMIT 1), 0) AS budget_base,
              (SELECT b.version FROM budgets b WHERE b.expediente_id = e.id ORDER BY b.version DESC LIMIT 1) AS budget_version,
              (SELECT b.base_cents FROM budgets b WHERE b.expediente_id = e.id ORDER BY b.version DESC LIMIT 1 OFFSET 1) AS prev_budget_base,
              (SELECT COALESCE(SUM(i.base_cents), 0) FROM invoices i WHERE i.expediente_id = e.id AND i.status != 'anulada') AS invoiced_base,
              -- PO: su importe; las cerradas, sólo lo que se llegó a facturar de ellas
              (SELECT COALESCE(SUM(CASE WHEN po.closed_at IS NULL THEN po.amount_cents
                        ELSE COALESCE((SELECT SUM(ip.amount_cents) FROM invoice_pos ip JOIN invoices i ON i.id = ip.invoice_id
                                        WHERE ip.po_id = po.id AND i.status != 'anulada'), 0) END), 0)
                 FROM purchase_orders po WHERE po.expediente_id = e.id) AS po_total
         FROM expedientes e
        WHERE e.status IN ('solicitado', 'abierto')
     ) WHERE (?1 = '%%' OR name LIKE ?1 OR company LIKE ?1 OR CAST(number AS TEXT) LIKE ?1)
     ORDER BY start_date, id`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

/**
 * PO con importe aún sin llevar a ninguna factura, de los expedientes que siguen en marcha
 * (en uno cerrado ya no se factura más); con búsqueda opcional.
 */
/** @param {Db} db @param {string} [q] */
export function posWithBalance(db, q = '') {
  return db.prepare(
    `SELECT * FROM (
       SELECT po.*, e.number AS exp_number, e.name AS exp_name, e.status AS exp_status, e.manager_id AS exp_manager_id, f.name AS file_name,
              po.amount_cents - COALESCE((SELECT SUM(ip.amount_cents) FROM invoice_pos ip JOIN invoices i ON i.id = ip.invoice_id
                                           WHERE ip.po_id = po.id AND i.status != 'anulada'), 0) AS left_cents
         FROM expedientes e JOIN purchase_orders po ON po.expediente_id = e.id LEFT JOIN files f ON f.id = po.file_id
        WHERE e.status IN ('abierto', 'solicitado') AND po.closed_at IS NULL
     ) WHERE left_cents > 0
         AND (?1 = '%%' OR number LIKE ?1 OR billed_to LIKE ?1 OR exp_name LIKE ?1 OR CAST(exp_number AS TEXT) LIKE ?1)
     ORDER BY exp_number, id`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

/** Facturas a cliente ya cobradas (historial), las más recientes primero; con búsqueda opcional */
/** @param {Db} db @param {string} [q] */
export function collectedInvoices(db, q = '') {
  return db.prepare(
    `SELECT i.*, e.number AS exp_number, e.name AS exp_name, f.name AS file_name,
            (SELECT group_concat(po.number, ', ') FROM invoice_pos ip JOIN purchase_orders po ON po.id = ip.po_id WHERE ip.invoice_id = i.id) AS po_numbers
       FROM invoices i JOIN expedientes e ON e.id = i.expediente_id LEFT JOIN files f ON f.id = i.file_id
      WHERE i.status = 'cobrada'
        AND (?1 = '%%' OR i.billed_to LIKE ?1 OR i.number LIKE ?1 OR i.concept LIKE ?1 OR e.name LIKE ?1 OR CAST(e.number AS TEXT) LIKE ?1)
      ORDER BY i.collected_on DESC, i.id DESC LIMIT 300`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

// ── Tablas (por páginas) ───────────────────────────────────────────────────

const INVOICE = `i.*, e.number AS exp_number, e.name AS exp_name, e.manager_id AS exp_manager_id, f.name AS file_name,
  (SELECT group_concat(po.number, ', ') FROM invoice_pos ip JOIN purchase_orders po ON po.id = ip.po_id WHERE ip.invoice_id = i.id) AS po_numbers`;
const SEARCH = `(?1 = '%%' OR billed_to LIKE ?1 OR number LIKE ?1 OR concept LIKE ?1 OR exp_name LIKE ?1 OR CAST(exp_number AS TEXT) LIKE ?1 OR po_numbers LIKE ?1)`;
// Estado de una factura pendiente (?2 = hoy): por emitir, emitida y vencida
const STATES = {
  por_emitir: "status = 'por_emitir'",
  emitida: "status = 'emitida' AND (due_date IS NULL OR due_date >= ?2)",
  vencida: "status = 'emitida' AND due_date < ?2",
};
// Columna de la tabla (src/lib/tables.js → cobros y cobradas) → expresión para ordenar
const SORT = {
  factura: 'number', cliente: 'billed_to COLLATE NOCASE', expediente: 'exp_number', emitida: 'issued_on', vence: 'due_date',
  cobrada: 'collected_on', base: 'base_cents', total: 'total_cents',
  // por emitir → vencida → pendiente de cobro
  estado: "CASE WHEN status = 'por_emitir' THEN 1 WHEN due_date < ?2 THEN 2 ELSE 3 END",
};

/**
 * Facturas por emitir y por cobrar, por páginas (con un límite grande, todas para las tarjetas).
 * state: por_emitir, emitida (sin vencer) o vencida. Devuelve la página, el total y la suma de lo filtrado, y
 * cuántas hay y cuánto suman en cada estado (con el buscador, sin el estado).
 * @param {Db} db
 * @param {{ q?: string, state?: string, today: string, sort?: string, dir?: 'asc' | 'desc', limit?: number, offset?: number }} o
 */
export async function openTable(db, { q = '', state = '', today, sort = 'estado', dir = 'asc', limit = 25, offset = 0 }) {
  const base = `
    SELECT * FROM (
      SELECT ${INVOICE} FROM invoices i JOIN expedientes e ON e.id = i.expediente_id LEFT JOIN files f ON f.id = i.file_id
       WHERE i.status IN ('por_emitir', 'emitida') AND e.status != 'cancelado'
    ) WHERE ${SEARCH}`;
  const cond = STATES[/** @type {keyof typeof STATES} */ (state)] ?? '1 = 1';
  const args = [likeTerm(q), today];
  const [count, page] = await db.batch([
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END), 0) AS n, COALESCE(SUM(CASE WHEN ${cond} THEN total_cents END), 0) AS sum,
                       ${Object.entries(STATES).map(([k, w]) => `COALESCE(SUM(CASE WHEN ${w} THEN 1 ELSE 0 END), 0) AS ${k}_n, COALESCE(SUM(CASE WHEN ${w} THEN total_cents END), 0) AS ${k}_sum`).join(', ')}
                  FROM (${base})`).bind(...args),
    db.prepare(`SELECT * FROM (${base}) WHERE ${cond} ORDER BY ${orderBy(SORT, sort, dir, 'estado', 'id')} LIMIT ?3 OFFSET ?4`).bind(...args, limit, offset),
  ]);
  const c = count.results[0];
  const groups = Object.fromEntries(Object.keys(STATES).map((k) => [k, { n: c[`${k}_n`], sum: c[`${k}_sum`] }]));
  return { rows: page.results, total: c.n, sum: c.sum, groups };
}

/**
 * Facturas cobradas, por páginas (con un límite, las últimas para las tarjetas por meses). month: 'YYYY-MM' (cobradas ese mes)
 * @param {Db} db
 * @param {{ q?: string, month?: string, sort?: string, dir?: 'asc' | 'desc', limit?: number, offset?: number }} o
 */
export async function collectedTable(db, { q = '', month = '', sort = 'cobrada', dir = 'desc', limit = 25, offset = 0 } = {}) {
  const base = `
    SELECT * FROM (
      SELECT ${INVOICE} FROM invoices i JOIN expedientes e ON e.id = i.expediente_id LEFT JOIN files f ON f.id = i.file_id
       WHERE i.status = 'cobrada'
    ) WHERE ${SEARCH} AND (?2 = '' OR substr(collected_on, 1, 7) = ?2)`;
  const args = [likeTerm(q), month];
  const [count, page] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS sum FROM (${base})`).bind(...args),
    db.prepare(`SELECT * FROM (${base}) ORDER BY ${orderBy(SORT, sort, dir, 'cobrada', 'id')} LIMIT ?3 OFFSET ?4`).bind(...args, limit, offset),
  ]);
  return { rows: page.results, total: count.results[0].n, sum: count.results[0].sum };
}

// ── Cobrar una factura ─────────────────────────────────────────────────────

/** Lo justo para cobrarla: la factura y el estado de su expediente @param {Db} db @param {number} id */
export const forCollect = (db, id) => db.prepare(
  `SELECT i.id, i.number, i.billed_to, i.total_cents, i.status, i.expediente_id, e.status AS exp_status
     FROM invoices i JOIN expedientes e ON e.id = i.expediente_id WHERE i.id = ?`,
).bind(id).first();

/** @param {Db} db @param {number} id @param {string} collectedOn @param {string} at */
export const collectStmt = (db, id, collectedOn, at) => db.prepare("UPDATE invoices SET status = 'cobrada', collected_on = ?, updated_at = ? WHERE id = ?")
  .bind(collectedOn, at, id);
