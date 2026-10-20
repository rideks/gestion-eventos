// @ts-check
// Repositorio de clientes: TODO el SQL de clientes, sus nombres anteriores y sus entidades de facturación.
// Sin permisos ni reglas: eso lo decide el servicio (src/services/clients.js).
// Las funciones que acaban en Stmt devuelven sentencias para juntarlas en un db.batch (atómico).

/** @typedef {import('../services/types').Db} Db */

import { likeTerm } from './payments.js';
import { orderBy } from '../lib/table.js';

const LIVE = "e.status <> 'cancelado'";
// Las cancelaciones que cuentan en las cifras del cliente: no los duplicados ni los creados por error (src/lib/cancel.js)
const COUNTS = "COALESCE(e.cancel_reason, '') <> 'duplicado'";
const BUDGET = '(SELECT b.base_cents FROM budgets b WHERE b.expediente_id = e.id ORDER BY b.version DESC LIMIT 1)';
const INVOICED = "(SELECT COALESCE(SUM(i.base_cents), 0) FROM invoices i WHERE i.expediente_id = e.id AND i.status IN ('emitida', 'cobrada'))";
const COLLECTED = "(SELECT COALESCE(SUM(i.total_cents), 0) FROM invoices i WHERE i.expediente_id = e.id AND i.status = 'cobrada')";
const PENDING = "(SELECT COALESCE(SUM(i.total_cents), 0) FROM invoices i WHERE i.expediente_id = e.id AND i.status = 'emitida')";
// Columna de la tabla (src/lib/tables.js) → expresión para ordenar (sobre la consulta agrupada)
const SORT = {
  name: 'name COLLATE NOCASE', tipo: 'kind', ciudad: 'city COLLATE NOCASE', nif: 'tax_id', email: 'email COLLATE NOCASE',
  expedientes: 'exps', cancelados: 'cancelled', tasa: 'CASE WHEN exps + cancelled = 0 THEN NULL ELSE 1.0 * cancelled / (exps + cancelled) END',
  viajes: 'bookings', viajes_canceladas: 'bookings_cancelled', proximo: 'next_date', uso: 'last_date', fee: 'fee_bp', volumen: 'budget',
  year: 'this_year', facturado: 'invoiced', pendiente: 'pending', altas: 'created_at',
};

/**
 * Directorio con sus expedientes (aceptados y cancelados) y su volumen (presupuestado, facturado y pendiente de cobro), por páginas.
 * Devuelve la página pedida, cuántos hay en total con esos filtros y la suma de sus importes (de todos, no sólo
 * de la página).
 * @param {Db} db
 * @param {{ q?: string, status?: string, kind?: string, city?: string, sort?: string, dir?: 'asc' | 'desc', year: number, now: string,
 *           limit?: number, offset?: number }} filters
 * @returns {Promise<{ rows: any[], total: number, sums: { budget: number, this_year: number, invoiced: number, pending: number } }>}
 */
export async function list(db, { q = '', status = '', kind = '', city = '', sort = 'name', dir = 'asc', year, now, limit = 25, offset = 0 }) {
  const base = `
    SELECT c.id, c.name, c.status, c.kind, c.title, c.city, c.tax_id, c.email, c.phone, c.fee_bp, c.created_at,
           COUNT(CASE WHEN ${LIVE} THEN e.id END) AS exps,
           COUNT(CASE WHEN e.status = 'cancelado' AND ${COUNTS} THEN e.id END) AS cancelled,
           (SELECT COUNT(*) FROM bt_bookings bb WHERE bb.client_id = c.id AND bb.status <> 'cancelada') AS bookings,
           (SELECT COUNT(*) FROM bt_bookings bb WHERE bb.client_id = c.id AND bb.status = 'cancelada' AND COALESCE(bb.cancel_reason, '') <> 'duplicado') AS bookings_cancelled,
           MAX(CASE WHEN ${LIVE} AND e.start_date <= ?5 THEN e.start_date END) AS last_date,
           MIN(CASE WHEN ${LIVE} AND e.start_date > ?5 THEN e.start_date END) AS next_date,
           COALESCE(SUM(CASE WHEN ${LIVE} THEN ${BUDGET} END), 0) AS budget,
           COALESCE(SUM(CASE WHEN ${LIVE} AND substr(e.start_date, 1, 4) = ?2 THEN ${BUDGET} END), 0) AS this_year,
           COALESCE(SUM(CASE WHEN ${LIVE} THEN ${INVOICED} END), 0) AS invoiced,
           COALESCE(SUM(CASE WHEN ${LIVE} THEN ${PENDING} END), 0) AS pending
      FROM clients c
      LEFT JOIN expedientes e ON e.client_id = c.id
     WHERE (?1 = '%%' OR c.name LIKE ?1 OR c.legal_name LIKE ?1 OR c.tax_id LIKE ?1 OR c.city LIKE ?1 OR c.email LIKE ?1
            OR EXISTS (SELECT 1 FROM client_aliases a WHERE a.client_id = c.id AND a.alias LIKE ?1)
            OR EXISTS (SELECT 1 FROM client_entities x WHERE x.client_id = c.id AND (x.legal_name LIKE ?1 OR x.tax_id LIKE ?1)))
       AND (?3 = '' OR c.status = ?3)
       AND (?6 = '' OR c.kind = ?6)
       AND (?7 = '' OR c.city = ?7 COLLATE NOCASE)
     GROUP BY c.id`;
  const args = [likeTerm(q), String(year), status, 0, now, kind, city];
  const [count, page] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(budget), 0) AS budget, COALESCE(SUM(this_year), 0) AS this_year,
                       COALESCE(SUM(invoiced), 0) AS invoiced, COALESCE(SUM(pending), 0) AS pending FROM (${base})`).bind(...args),
    db.prepare(`SELECT * FROM (${base}) ORDER BY ${orderBy(SORT, sort, dir, 'name', 'id')} LIMIT ?8 OFFSET ?9`).bind(...args, limit, offset),
  ]);
  const { n, ...sums } = count.results[0];
  return { rows: page.results, total: n, sums };
}

/** Las ciudades de los clientes (para el filtro) @param {Db} db */
export const cities = (db) => db.prepare(
  "SELECT DISTINCT city FROM clients WHERE city IS NOT NULL AND TRIM(city) <> '' ORDER BY city COLLATE NOCASE LIMIT 300",
).all().then((r) => r.results.map((x) => x.city));

/** @param {Db} db @param {number} id */
export const byId = (db, id) => db.prepare('SELECT id, name, status, fee_bp, payment_terms FROM clients WHERE id = ?').bind(id).first();

/** @param {Db} db @param {number} id */
export const others = (db, id) => db.prepare('SELECT id, name FROM clients WHERE id <> ? ORDER BY name COLLATE NOCASE').bind(id).all().then((r) => r.results);

/**
 * Ficha: el cliente, sus nombres anteriores, sus entidades de facturación, una fila por expediente
 * (con sus importes) y los proveedores con los que se ha trabajado para él.
 * @param {Db} db
 * @param {number} id
 */
export async function ficha(db, id) {
  const [c, aliases, entities, exps, suppliers] = await db.batch([
    db.prepare('SELECT c.*, u.name AS created_by_name FROM clients c LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ?').bind(id),
    db.prepare('SELECT alias FROM client_aliases WHERE client_id = ? ORDER BY alias COLLATE NOCASE').bind(id),
    db.prepare('SELECT * FROM client_entities WHERE client_id = ? ORDER BY legal_name COLLATE NOCASE, id').bind(id),
    db.prepare(
      `SELECT e.id, e.number, e.name, e.status, e.start_date, e.end_date, e.destination, e.fee_bp, e.attendees,
              e.closed_at, e.cancel_by, e.cancel_reason, e.cancel_notes,
              e.contact_name, e.contact_email, e.contact_phone, m.name AS manager_name,
              ${BUDGET} AS budget_base, ${INVOICED} AS invoiced_base, ${COLLECTED} AS collected_total, ${PENDING} AS pending_total
         FROM expedientes e LEFT JOIN users m ON m.id = e.manager_id
        WHERE e.client_id = ?
        ORDER BY e.start_date DESC, e.id DESC`,
    ).bind(id),
    db.prepare(
      `SELECT s.id, s.name, s.city, t.name AS type, COUNT(DISTINCT p.expediente_id) AS exps,
              COALESCE(SUM(CASE WHEN p.base_cents > 0 THEN p.base_cents END), 0) AS contracted
         FROM payments p JOIN expedientes e ON e.id = p.expediente_id JOIN suppliers s ON s.id = p.supplier_id
         LEFT JOIN supplier_types t ON t.id = s.type_id
        WHERE e.client_id = ? AND ${LIVE}
        GROUP BY s.id
        ORDER BY exps DESC, contracted DESC, s.name COLLATE NOCASE`,
    ).bind(id),
  ]);
  const client = c.results[0];
  if (!client) return null;
  return { client, aliases: aliases.results.map((a) => a.alias), entities: entities.results, expedientes: exps.results, suppliers: suppliers.results };
}

/** Todos los clientes para el selector de las solicitudes (con sus nombres anteriores) @param {Db} db */
export function options(db) {
  return db.prepare(
    `SELECT c.id, c.name, c.status, c.title, c.city,
            (SELECT GROUP_CONCAT(a.alias, char(10)) FROM client_aliases a WHERE a.client_id = c.id) AS aliases
       FROM clients c ORDER BY c.status = 'inactivo', c.name COLLATE NOCASE LIMIT 2000`,
  ).all().then((r) => r.results.map((x) => ({ ...x, aliases: x.aliases ? x.aliases.split('\n') : [] })));
}

/**
 * El cliente de un id o, si no, de un nombre exacto o anterior (sin distinguir mayúsculas)
 * @param {Db} db
 * @param {number | null} id
 * @param {string} name
 */
export function resolve(db, id, name) {
  return db.prepare(
    `SELECT c.id, c.name, c.status, c.kind, c.title, c.fee_bp, c.payment_terms FROM clients c
      WHERE c.id = COALESCE((SELECT x.id FROM clients x WHERE x.id = ?1), (SELECT x.id FROM clients x WHERE x.name = ?2),
                            (SELECT a.client_id FROM client_aliases a WHERE a.alias = ?2))`,
  ).bind(id, name).first();
}

/**
 * ¿Ese nombre lo usa ya OTRO cliente (como nombre o como nombre anterior)? → su nombre o null
 * @param {Db} db
 * @param {string} name
 * @param {number} [exceptId]
 */
export async function nameTaken(db, name, exceptId = 0) {
  const row = await db.prepare(
    `SELECT c.name FROM clients c WHERE c.name = ?1 AND c.id <> ?2
     UNION ALL
     SELECT c.name FROM client_aliases a JOIN clients c ON c.id = a.client_id WHERE a.alias = ?1 AND a.client_id <> ?2
     LIMIT 1`,
  ).bind(name, exceptId).first();
  return row?.name ?? null;
}

/** Cuántos expedientes tiene (para saber si se puede borrar) @param {Db} db @param {number} id */
export const expedienteCount = (db, id) => db.prepare('SELECT COUNT(*) AS n FROM expedientes WHERE client_id = ?').bind(id).first().then((r) => r.n);

/**
 * Buscador general: por nombre, nombre fiscal, NIF, ciudad, nombre anterior o entidad
 * @param {Db} db
 * @param {string} q
 */
export const search = (db, q) => db.prepare(
  `SELECT c.id, c.name, c.city, (SELECT COUNT(*) FROM expedientes e WHERE e.client_id = c.id AND e.status <> 'cancelado') AS exps
     FROM clients c
    WHERE c.name LIKE ?1 OR c.legal_name LIKE ?1 OR c.tax_id LIKE ?1 OR c.city LIKE ?1
       OR EXISTS (SELECT 1 FROM client_aliases a WHERE a.client_id = c.id AND a.alias LIKE ?1)
       OR EXISTS (SELECT 1 FROM client_entities x WHERE x.client_id = c.id AND (x.legal_name LIKE ?1 OR x.tax_id LIKE ?1))
    ORDER BY c.name COLLATE NOCASE LIMIT 20`,
).bind(`%${q}%`).all().then((r) => r.results);

// ── Cambios ────────────────────────────────────────────────────────────────

/**
 * Alta; null si otra persona lo ha dado de alta a la vez con el mismo nombre
 * @param {Db} db
 * @param {Record<string, any>} d datos ya validados (ClientSchema o ClientQuickSchema)
 * @param {number | null} userId
 */
export function insert(db, d, userId) {
  return db.prepare(
    `INSERT INTO clients (name, status, kind, title, legal_name, tax_id, fiscal_address, city, phone, email, billing_email, payment_terms, fee_bp,
                          since_on, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (name) DO NOTHING
     RETURNING id, name, status, kind, title, city`,
  ).bind(d.name, d.status ?? 'activo', d.kind ?? 'empresa', d.title ?? null, d.legal_name ?? null, d.tax_id ?? null, d.fiscal_address ?? null,
    d.city ?? null, d.phone ?? null, d.email ?? null, d.billing_email ?? null, d.payment_terms ?? null, d.fee_bp ?? null, d.since_on ?? null,
    d.notes ?? null, userId).first();
}

/** @param {Db} db @param {number} id @param {Record<string, any>} d */
export function updateStmt(db, id, d) {
  return db.prepare(
    `UPDATE clients SET name = ?, status = ?, kind = ?, title = ?, legal_name = ?, tax_id = ?, fiscal_address = ?, city = ?, phone = ?, email = ?,
            billing_email = ?, payment_terms = ?, fee_bp = ?, since_on = ?, notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?`,
  ).bind(d.name, d.status, d.kind ?? 'empresa', d.title ?? null, d.legal_name, d.tax_id, d.fiscal_address, d.city, d.phone, d.email,
    d.billing_email, d.payment_terms, d.fee_bp, d.since_on, d.notes, id);
}

/**
 * Renombrar: el nombre viejo queda como nombre anterior y los expedientes muestran el nuevo
 * @param {Db} db @param {number} id @param {string} oldName @param {string} newName
 */
export function renameStmts(db, id, oldName, newName) {
  if (oldName === newName) return [];
  const caseOnly = oldName.toLowerCase() === newName.toLowerCase();
  return [
    db.prepare('DELETE FROM client_aliases WHERE alias = ? AND client_id = ?').bind(newName, id),
    ...(caseOnly ? [] : [db.prepare('INSERT INTO client_aliases (alias, client_id) VALUES (?, ?) ON CONFLICT (alias) DO UPDATE SET client_id = excluded.client_id').bind(oldName, id)]),
    db.prepare('UPDATE expedientes SET company = ? WHERE client_id = ?').bind(newName, id),
  ];
}

const FILLABLE = ['legal_name', 'tax_id', 'fiscal_address', 'city', 'phone', 'email', 'billing_email', 'payment_terms', 'fee_bp', 'since_on', 'notes'];

/**
 * Fusionar `from` en `into`: expedientes, entidades y nombres pasan a `into`; los datos que le falten a
 * `into` se completan con los de `from`; `from` desaparece.
 * @param {Db} db
 * @param {{ id: number, name: string }} from
 * @param {{ id: number, name: string }} into
 */
export function mergeStmts(db, from, into) {
  return [
    db.prepare('UPDATE expedientes SET client_id = ?, company = ? WHERE client_id = ?').bind(into.id, into.name, from.id),
    db.prepare('UPDATE client_aliases SET client_id = ? WHERE client_id = ?').bind(into.id, from.id),
    // Las entidades que ya tenga `into` (mismo NIF) no se repiten: las de `from` se borran con él
    db.prepare('UPDATE OR IGNORE client_entities SET client_id = ? WHERE client_id = ?').bind(into.id, from.id),
    db.prepare('INSERT INTO client_aliases (alias, client_id) VALUES (?, ?) ON CONFLICT (alias) DO UPDATE SET client_id = excluded.client_id').bind(from.name, into.id),
    db.prepare(`UPDATE clients SET ${FILLABLE.map((f) => `${f} = COALESCE(${f}, (SELECT x.${f} FROM clients x WHERE x.id = ?1))`).join(', ')},
                       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?2`).bind(from.id, into.id),
    db.prepare('DELETE FROM clients WHERE id = ?').bind(from.id),
  ];
}

/** @param {Db} db @param {number} id */
export const deleteStmt = (db, id) => db.prepare('DELETE FROM clients WHERE id = ?').bind(id);

// ── Entidades de facturación ───────────────────────────────────────────────

/** @param {Db} db @param {number} clientId @param {number} entityId */
export const entity = (db, clientId, entityId) => db.prepare('SELECT * FROM client_entities WHERE id = ? AND client_id = ?').bind(entityId, clientId).first();

/** null si ya tiene una entidad con ese NIF @param {Db} db @param {number} clientId @param {Record<string, any>} d */
export function insertEntity(db, clientId, d) {
  return db.prepare(
    'INSERT INTO client_entities (client_id, legal_name, tax_id, fiscal_address, email) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id',
  ).bind(clientId, d.legal_name, d.tax_id, d.fiscal_address, d.email).first();
}

/** @param {Db} db @param {number} entityId @param {Record<string, any>} d */
export const updateEntityStmt = (db, entityId, d) => db.prepare(
  'UPDATE client_entities SET legal_name = ?, tax_id = ?, fiscal_address = ?, email = ? WHERE id = ?',
).bind(d.legal_name, d.tax_id, d.fiscal_address, d.email, entityId);

/** @param {Db} db @param {number} entityId */
export const deleteEntityStmt = (db, entityId) => db.prepare('DELETE FROM client_entities WHERE id = ?').bind(entityId);

/** ¿Otra entidad del cliente tiene ese NIF? @param {Db} db @param {number} clientId @param {string | null} taxId @param {number} [exceptId] */
export const entityTaxTaken = (db, clientId, taxId, exceptId = 0) => (taxId
  ? db.prepare('SELECT legal_name FROM client_entities WHERE client_id = ? AND tax_id = ? AND id <> ?').bind(clientId, taxId, exceptId).first()
  : Promise.resolve(null));
