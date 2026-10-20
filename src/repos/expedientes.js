// @ts-check
// Repositorio de expedientes: la lista (por páginas, con sus pestañas), la cabecera de un expediente y su número.
// El resto de sus consultas (la ficha, el cierre, los cobros) sigue en src/lib/data.js y en sus páginas.

/** @typedef {import('../services/types').Db} Db */

import { likeTerm } from './payments.js';
import { orderBy } from '../lib/table.js';

// ── Lista ─────────────────────────────────────────────────────────────────

// Lo económico de cada expediente (e) para la lista: el presupuesto vigente, el coste, lo que queda por pagar,
// lo facturado (facturas no anuladas) y lo emitido sin cobrar
const SUMMARY = `
  (SELECT b.base_cents FROM budgets b WHERE b.expediente_id = e.id ORDER BY b.version DESC LIMIT 1) AS budget_base,
  (SELECT COALESCE(SUM(p.base_cents), 0) FROM payments p WHERE p.expediente_id = e.id) AS cost_base,
  (SELECT COALESCE(SUM(p.total_cents), 0) FROM payments p WHERE p.expediente_id = e.id AND p.status = 'pendiente') AS to_pay,
  (SELECT COALESCE(SUM(i.base_cents), 0) FROM invoices i WHERE i.expediente_id = e.id AND i.status != 'anulada') AS sales_base,
  (SELECT COALESCE(SUM(i.total_cents), 0) FROM invoices i WHERE i.expediente_id = e.id AND i.status = 'emitida') AS to_collect`;

// Las pestañas (src/lib/expedientes.js → EXP_TABS) sobre la consulta de la lista: ?4 = hoy, ?5 = quien mira.
// Un expediente sin fechas está en curso.
const TABS = {
  curso: "status = 'abierto' AND (COALESCE(end_date, start_date) IS NULL OR COALESCE(end_date, start_date) >= ?4)",
  cerrar: "status = 'abierto' AND COALESCE(end_date, start_date) < ?4",
  mios: "manager_id = ?5 AND status = 'abierto'",
  cerrados: "status = 'cerrado'",
  cancelados: "status = 'cancelado'",
  todos: '1 = 1',
};

// Columna de la tabla (src/lib/tables.js) → expresión para ordenar
const SORT = {
  numero: 'number', cliente: 'company COLLATE NOCASE', destino: 'destination COLLATE NOCASE', fechas: 'start_date',
  responsable: 'manager_name COLLATE NOCASE', asistentes: 'attendees', alta: 'requested_at',
  // en curso → por cerrar → cerrado → cancelado
  estado: "CASE status WHEN 'abierto' THEN (CASE WHEN COALESCE(end_date, start_date) < ?4 THEN 2 ELSE 1 END) WHEN 'cerrado' THEN 3 ELSE 4 END",
  presupuesto: 'budget_base', coste: 'cost_base', por_pagar: 'to_pay', facturado: 'sales_base', por_cobrar: 'to_collect',
  // Sólo de los cerrados (como en el Cierre: lo facturado o, si no hay facturas, el presupuesto, menos el coste)
  beneficio: "CASE WHEN status = 'cerrado' THEN COALESCE(NULLIF(sales_base, 0), budget_base, 0) - cost_base END",
};

/**
 * Expedientes por páginas. q: nombre, cliente, destino o número. clientId / managerId: el cliente y el responsable.
 * month: 'YYYY-MM' (empieza ese mes). view: la pestaña. Devuelve la página, cuántos hay en cada pestaña con esos
 * filtros y las sumas de la pestaña (sin los cancelados).
 * @param {Db} db
 * @param {{ q?: string, clientId?: number | null, managerId?: number | null, month?: string, view?: string, today?: string,
 *           userId?: number | null, sort?: string, dir?: 'asc' | 'desc', limit?: number, offset?: number }} filters
 * @returns {Promise<{ rows: any[], total: number, counts: Record<string, number>, sums: { budget_base: number, cost_base: number, to_pay: number, sales_base: number, to_collect: number } }>}
 */
export async function list(db, { q = '', clientId = null, managerId = null, month = '', view = 'todos', today = '', userId = null, sort = 'fechas', dir = 'asc', limit = 25, offset = 0 } = {}) {
  const base = `
    SELECT e.id, e.number, e.name, e.company, e.client_id, e.destination, e.start_date, e.end_date, e.attendees, e.status,
           e.manager_id, e.requested_at, e.closed_at, e.cancel_by, e.cancel_reason, e.cancel_notes, m.name AS manager_name, ${SUMMARY}
      FROM expedientes e LEFT JOIN users m ON m.id = e.manager_id
     WHERE (?1 = '%%' OR e.name LIKE ?1 OR e.company LIKE ?1 OR e.destination LIKE ?1 OR CAST(e.number AS TEXT) LIKE ?1)
       AND (?2 IS NULL OR e.client_id = ?2)
       AND (?3 IS NULL OR e.manager_id = ?3)
       AND (?6 = '' OR substr(e.start_date, 1, 7) = ?6)`;
  const tab = TABS[/** @type {keyof typeof TABS} */ (view)] ?? TABS.todos;
  const args = [likeTerm(q), clientId, managerId, today, userId, month];
  const live = `CASE WHEN (${tab}) AND status <> 'cancelado' THEN`;
  const [count, page] = await db.batch([
    db.prepare(`SELECT ${Object.entries(TABS).map(([k, w]) => `COALESCE(SUM(CASE WHEN ${w} THEN 1 ELSE 0 END), 0) AS ${k}`).join(', ')},
                       COALESCE(SUM(CASE WHEN ${tab} THEN 1 ELSE 0 END), 0) AS n,
                       ${['budget_base', 'cost_base', 'to_pay', 'sales_base', 'to_collect'].map((c) => `COALESCE(SUM(${live} ${c} END), 0) AS ${c}`).join(', ')}
                  FROM (${base})`).bind(...args),
    db.prepare(`SELECT * FROM (${base}) WHERE ${tab} ORDER BY ${orderBy(SORT, sort, dir, 'fechas', 'id')} LIMIT ?7 OFFSET ?8`).bind(...args, limit, offset),
  ]);
  const { n, budget_base, cost_base, to_pay, sales_base, to_collect, ...counts } = count.results[0];
  return { rows: page.results, total: n, counts, sums: { budget_base, cost_base, to_pay, sales_base, to_collect } };
}

/** Los clientes que tienen expedientes (para el filtro) @param {Db} db */
export const clientsWithExpedientes = (db) => db.prepare(
  `SELECT DISTINCT c.id, c.name, c.title FROM expedientes e JOIN clients c ON c.id = e.client_id ORDER BY c.name COLLATE NOCASE LIMIT 500`,
).all().then((r) => r.results);

/** Quienes llevan algún expediente (para el filtro «Responsable») @param {Db} db */
export const managers = (db) => db.prepare(
  'SELECT DISTINCT u.id, u.name FROM expedientes e JOIN users u ON u.id = e.manager_id ORDER BY u.name COLLATE NOCASE',
).all().then((r) => r.results);

// ── Un expediente ─────────────────────────────────────────────────────────

/** Expediente con los nombres del responsable y de quien lo pidió, abrió y cerró @param {Db} db @param {number} id */
export function header(db, id) {
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

// ── Número de expediente ───────────────────────────────────────────────────
// Cada expediente recibe su número al crearlo: el siguiente de un contador (counters, 'expediente') que nunca
// baja del mayor número ya usado (Administración puede cambiar uno en «Editar») ni del «primer número» de Ajustes.
// Se da en UNA sentencia, en el mismo batch que el alta: dos altas a la vez nunca reciben el mismo número, y un
// número dado no se vuelve a dar aunque se borre el expediente (puede quedar un hueco).
const FLOOR = `MAX(COALESCE((SELECT MAX(number) FROM expedientes), 0),
                   COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'first_number'), 1001) - 1)`;

/** Reserva el siguiente número (va antes, en el mismo batch, que la sentencia que lo usa con NUMBER) @param {Db} db */
export const nextNumberStmt = (db) => db.prepare(
  `INSERT INTO counters (key, value) VALUES ('expediente', ${FLOOR} + 1)
   ON CONFLICT (key) DO UPDATE SET value = MAX(value, ${FLOOR}) + 1`,
);

/** El número recién reservado con nextNumberStmt (para usarlo dentro de otra sentencia del mismo batch) */
export const NUMBER = "(SELECT value FROM counters WHERE key = 'expediente')";

/** El número que recibirá el próximo expediente (para enseñarlo en Ajustes) @param {Db} db @returns {Promise<number>} */
export async function upcomingNumber(db) {
  const row = await db.prepare(`SELECT MAX(COALESCE(${NUMBER}, 0), ${FLOOR}) + 1 AS n`).first();
  return row.n;
}
