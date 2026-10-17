// Consultas a la base de datos que comparten varias páginas.
import { summarize, nextNumber, SOON_DAYS } from './finance.js';
import { addDays } from './dates.js';

/**
 * Columnas de un pago con los datos de su factura de proveedor (si la tiene).
 * Una factura puede cubrir varios pagos: invoice_number, invoice_date, file_id… salen de supplier_invoices.
 */
export const PAYMENT_SELECT = `
  p.id, p.expediente_id, p.supplier, p.concept, p.base_cents, p.total_cents, p.vat, p.vat_lines, p.due_date, p.status,
  p.paid_on, p.method, p.planned, p.notes, p.created_by, p.created_at, p.updated_at, p.supplier_invoice_id,
  si.number AS invoice_number, si.issued_on AS invoice_date, si.file_id, si.review AS invoice_review,
  si.total_cents AS invoice_total, f.name AS file_name`;
export const PAYMENT_JOINS = 'LEFT JOIN supplier_invoices si ON si.id = p.supplier_invoice_id LEFT JOIN files f ON f.id = si.file_id';

/** Texto de búsqueda para LIKE (sin comodines del usuario); '%%' = sin búsqueda */
const likeTerm = (q) => `%${String(q ?? '').trim().slice(0, 80).replace(/[%_]/g, '')}%`;
const PAYMENT_SEARCH = `(?1 = '%%' OR p.supplier LIKE ?1 OR p.concept LIKE ?1 OR si.number LIKE ?1 OR e.name LIKE ?1 OR CAST(e.number AS TEXT) LIKE ?1)`;

/** Expediente con los nombres del responsable y de quien lo pidió */
export function getExpediente(db, id) {
  return db.prepare(
    `SELECT e.*, m.name AS manager_name, r.name AS requested_by_name, o.name AS opened_by_name, c.name AS closed_by_name
       FROM expedientes e
       LEFT JOIN users m ON m.id = e.manager_id
       LEFT JOIN users r ON r.id = e.requested_by
       LEFT JOIN users o ON o.id = e.opened_by
       LEFT JOIN users c ON c.id = e.closed_by
      WHERE e.id = ?`,
  ).bind(id).first();
}

/** Todo lo económico de un expediente + sus totales */
export async function loadFinance(db, id, now) {
  const [budgets, payments, pos, invoices, allocations] = await db.batch([
    db.prepare(
      `SELECT b.*, f.name AS file_name, u.name AS created_by_name
         FROM budgets b LEFT JOIN files f ON f.id = b.file_id LEFT JOIN users u ON u.id = b.created_by
        WHERE b.expediente_id = ? ORDER BY b.version DESC`,
    ).bind(id),
    db.prepare(
      `SELECT ${PAYMENT_SELECT} FROM payments p ${PAYMENT_JOINS}
        WHERE p.expediente_id = ?
        ORDER BY p.status = 'pagado', COALESCE(p.due_date, '9999-12-31'), p.id`,
    ).bind(id),
    db.prepare(
      `SELECT po.*, f.name AS file_name FROM purchase_orders po LEFT JOIN files f ON f.id = po.file_id
        WHERE po.expediente_id = ? ORDER BY COALESCE(po.issued_on, '9999-12-31'), po.id`,
    ).bind(id),
    db.prepare(
      `SELECT i.*, f.name AS file_name FROM invoices i LEFT JOIN files f ON f.id = i.file_id
        WHERE i.expediente_id = ?
        ORDER BY CASE i.status WHEN 'por_emitir' THEN 0 WHEN 'emitida' THEN 1 WHEN 'cobrada' THEN 2 ELSE 3 END,
                 COALESCE(i.due_date, i.issued_on, '9999-12-31'), i.id`,
    ).bind(id),
    db.prepare(
      `SELECT ip.invoice_id, ip.po_id, ip.amount_cents, po.number AS po_number
         FROM invoice_pos ip JOIN purchase_orders po ON po.id = ip.po_id
        WHERE po.expediente_id = ?`,
    ).bind(id),
  ]).then((rs) => rs.map((r) => r.results));
  const budget = budgets[0] ?? null;
  const summary = summarize({ budget, payments, pos, invoices, allocations }, now);
  return { budgets, budget, payments, pos, invoices, allocations, summary };
}

/** Nombres ya usados (para autocompletar empresas, clientes y proveedores) */
export async function suggestions(db) {
  const [companies, suppliers] = await db.batch([
    db.prepare(`SELECT name FROM (
                  SELECT company AS name FROM expedientes UNION SELECT billed_to FROM invoices UNION SELECT billed_to FROM purchase_orders
                ) WHERE name IS NOT NULL ORDER BY name COLLATE NOCASE LIMIT 300`),
    db.prepare('SELECT DISTINCT supplier AS name FROM payments ORDER BY supplier COLLATE NOCASE LIMIT 300'),
  ]);
  return { companies: companies.results.map((r) => r.name), suppliers: suppliers.results.map((r) => r.name) };
}

/** Personas que pueden llevar un evento (para el «responsable») */
export async function activeUsers(db) {
  const { results } = await db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name').all();
  return results;
}

/** Contadores de la navegación: solicitudes por abrir, pagos urgentes, facturas por emitir y por revisar */
export function navCounts(db, now) {
  return db.prepare(
    `SELECT (SELECT COUNT(*) FROM expedientes WHERE status = 'solicitado') AS requests,
            (SELECT COUNT(*) FROM supplier_invoices si JOIN expedientes e ON e.id = si.expediente_id
              WHERE si.review = 'pendiente' AND e.status != 'cancelado') AS to_review,
            (SELECT COUNT(*) FROM payments p JOIN expedientes e ON e.id = p.expediente_id
              WHERE p.status = 'pendiente' AND e.status != 'cancelado' AND p.due_date <= ?) AS urgent,
            (SELECT COUNT(*) FROM invoices i JOIN expedientes e ON e.id = i.expediente_id
              WHERE i.status = 'por_emitir' AND e.status != 'cancelado') AS to_issue`,
  ).bind(addDays(now, SOON_DAYS)).first();
}

/** Columnas resumen para los listados de expedientes */
export const LIST_COLUMNS = `
  e.*, m.name AS manager_name,
  (SELECT b.base_cents FROM budgets b WHERE b.expediente_id = e.id ORDER BY b.version DESC LIMIT 1) AS budget_base,
  (SELECT COALESCE(SUM(p.base_cents), 0) FROM payments p WHERE p.expediente_id = e.id) AS cost_base,
  (SELECT COALESCE(SUM(p.total_cents), 0) FROM payments p WHERE p.expediente_id = e.id AND p.status = 'pendiente') AS to_pay,
  (SELECT COALESCE(SUM(i.base_cents), 0) FROM invoices i WHERE i.expediente_id = e.id AND i.status != 'anulada') AS sales_base,
  (SELECT COALESCE(SUM(i.total_cents), 0) FROM invoices i WHERE i.expediente_id = e.id AND i.status = 'emitida') AS to_collect,
  (SELECT COALESCE(SUM(i.total_cents), 0) FROM invoices i WHERE i.expediente_id = e.id AND i.status = 'cobrada') AS collected,
  (SELECT COALESCE(SUM(i.total_cents), 0) FROM invoices i WHERE i.expediente_id = e.id AND i.status IN ('emitida', 'cobrada')) AS invoiced_total`;

/** Pagos pendientes de todos los expedientes, por fecha límite; con búsqueda opcional */
export function pendingPayments(db, q = '') {
  return db.prepare(
    `SELECT ${PAYMENT_SELECT}, e.number AS exp_number, e.name AS exp_name, e.status AS exp_status
       FROM payments p JOIN expedientes e ON e.id = p.expediente_id ${PAYMENT_JOINS}
      WHERE p.status = 'pendiente' AND e.status != 'cancelado' AND ${PAYMENT_SEARCH}
      ORDER BY p.due_date IS NULL, p.due_date, e.number, p.id`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

/** Pagos ya hechos para los que falta la factura del proveedor; con búsqueda opcional */
export function paidWithoutInvoice(db, q = '') {
  return db.prepare(
    `SELECT ${PAYMENT_SELECT}, e.number AS exp_number, e.name AS exp_name, e.status AS exp_status
       FROM payments p JOIN expedientes e ON e.id = p.expediente_id ${PAYMENT_JOINS}
      WHERE p.status = 'pagado' AND p.supplier_invoice_id IS NULL AND p.total_cents != 0 AND e.status != 'cancelado' AND ${PAYMENT_SEARCH}
      ORDER BY p.paid_on, p.id`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

/**
 * Facturas de proveedor pendientes de revisar por Administración (las más antiguas primero),
 * con los pagos que cubren.
 */
export function invoicesToReview(db, q = '') {
  return db.prepare(
    `SELECT si.*, f.name AS file_name, u.name AS uploaded_by_name, e.number AS exp_number, e.name AS exp_name, e.status AS exp_status,
            (SELECT COUNT(*) FROM payments p WHERE p.supplier_invoice_id = si.id) AS payment_count,
            (SELECT COALESCE(SUM(p.total_cents), 0) FROM payments p WHERE p.supplier_invoice_id = si.id) AS payments_total,
            (SELECT MIN(p.id) FROM payments p WHERE p.supplier_invoice_id = si.id) AS first_payment_id
       FROM supplier_invoices si JOIN expedientes e ON e.id = si.expediente_id
       LEFT JOIN files f ON f.id = si.file_id LEFT JOIN users u ON u.id = si.uploaded_by
      WHERE si.review = 'pendiente' AND e.status != 'cancelado'
        AND (?1 = '%%' OR si.supplier LIKE ?1 OR si.number LIKE ?1 OR e.name LIKE ?1 OR CAST(e.number AS TEXT) LIKE ?1)
      ORDER BY si.uploaded_at, si.id`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

/** Facturas a cliente por emitir y pendientes de cobro, con sus PO; con búsqueda opcional */
export function openInvoices(db, q = '') {
  return db.prepare(
    `SELECT * FROM (
       SELECT i.*, e.number AS exp_number, e.name AS exp_name, f.name AS file_name,
              (SELECT group_concat(po.number, ', ') FROM invoice_pos ip JOIN purchase_orders po ON po.id = ip.po_id WHERE ip.invoice_id = i.id) AS po_numbers
         FROM invoices i JOIN expedientes e ON e.id = i.expediente_id LEFT JOIN files f ON f.id = i.file_id
        WHERE i.status IN ('por_emitir', 'emitida') AND e.status != 'cancelado'
     ) WHERE (?1 = '%%' OR billed_to LIKE ?1 OR number LIKE ?1 OR concept LIKE ?1 OR exp_name LIKE ?1 OR CAST(exp_number AS TEXT) LIKE ?1 OR po_numbers LIKE ?1)
     ORDER BY status = 'emitida', due_date IS NULL, due_date, id`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

/** PO con importe aún sin llevar a ninguna factura; con búsqueda opcional */
export function posWithBalance(db, q = '') {
  return db.prepare(
    `SELECT * FROM (
       SELECT po.*, e.number AS exp_number, e.name AS exp_name, f.name AS file_name,
              po.amount_cents - COALESCE((SELECT SUM(ip.amount_cents) FROM invoice_pos ip JOIN invoices i ON i.id = ip.invoice_id
                                           WHERE ip.po_id = po.id AND i.status != 'anulada'), 0) AS left_cents
         FROM purchase_orders po JOIN expedientes e ON e.id = po.expediente_id LEFT JOIN files f ON f.id = po.file_id
        WHERE e.status != 'cancelado'
     ) WHERE left_cents > 0
         AND (?1 = '%%' OR number LIKE ?1 OR billed_to LIKE ?1 OR exp_name LIKE ?1 OR CAST(exp_number AS TEXT) LIKE ?1)
     ORDER BY exp_number, id`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

/** Número que se propone al abrir un expediente: el mayor + 1 */
export async function suggestNumber(db) {
  const row = await db.prepare(
    "SELECT (SELECT MAX(number) FROM expedientes) AS max, (SELECT value FROM settings WHERE key = 'first_number') AS first",
  ).first();
  return nextNumber(row?.max, row?.first);
}

/** ¿Está libre ese número de expediente? */
export async function numberTaken(db, number, exceptId = 0) {
  return !!(await db.prepare('SELECT 1 FROM expedientes WHERE number = ? AND id != ?').bind(number, exceptId).first());
}

/** Pagos ya hechos (historial), los más recientes primero; con búsqueda opcional */
export function paidPayments(db, q = '') {
  return db.prepare(
    `SELECT ${PAYMENT_SELECT}, e.number AS exp_number, e.name AS exp_name, e.status AS exp_status
       FROM payments p JOIN expedientes e ON e.id = p.expediente_id ${PAYMENT_JOINS}
      WHERE p.status = 'pagado' AND ${PAYMENT_SEARCH}
      ORDER BY p.paid_on DESC, p.id DESC LIMIT 300`,
  ).bind(likeTerm(q)).all().then((r) => r.results);
}

/** Facturas a cliente ya cobradas (historial), las más recientes primero; con búsqueda opcional */
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

/** Agrupa filas por mes de una fecha 'YYYY-MM-DD': [{ key: '2026-10', rows }] */
export function byMonth(rows, field) {
  const groups = [];
  for (const r of rows) {
    const key = String(r[field] ?? '').slice(0, 7) || 'sin-fecha';
    const last = groups[groups.length - 1];
    if (last?.key === key) last.rows.push(r);
    else groups.push({ key, rows: [r] });
  }
  return groups;
}
