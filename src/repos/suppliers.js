// @ts-check
// Repositorio de proveedores: TODO el SQL de proveedores, tipos y nombres anteriores, y nada más.
// Sin permisos ni reglas: eso lo decide el servicio (src/services/suppliers.js).
// Las funciones que acaban en Stmt devuelven sentencias para juntarlas en un db.batch (atómico).

import { likeTerm } from './payments.js';
import { orderBy } from '../lib/table.js';

// ── Consultas ──────────────────────────────────────────────────────────────
const LIVE = "e.status <> 'cancelado'";
const HAS_INVOICE = `EXISTS (SELECT 1 FROM payment_documents pd JOIN supplier_invoices si ON si.id = pd.document_id
                             WHERE pd.payment_id = p.id AND si.kind = 'factura')`;
// Columna de la tabla (src/lib/tables.js) → expresión para ordenar (sobre la consulta agrupada)
const SORT = {
  name: 'name COLLATE NOCASE', tipo: 'type COLLATE NOCASE', ciudad: 'city COLLATE NOCASE', contacto: 'contact_name COLLATE NOCASE',
  email: 'email COLLATE NOCASE', expedientes: 'exps', uso: 'last_date', altas: 'created_at', year: 'this_year', gasto: 'contracted',
};

/**
 * Directorio con sus usos y lo contratado (total y en el año dado), por páginas: la página pedida, cuántos hay con
 * esos filtros y la suma de lo contratado de todos ellos.
 * @param {import('../services/types').Db} db
 * @param {{ q?: string, typeId?: number|null, status?: string, city?: string, year: number, sort?: string, dir?: 'asc' | 'desc',
 *           limit?: number, offset?: number }} filters
 * @returns {Promise<{ rows: any[], total: number, sums: { contracted: number, this_year: number } }>}
 */
export async function list(db, { q = '', typeId = null, status = '', city = '', year, sort = 'name', dir = 'asc', limit = 25, offset = 0 }) {
  const base = `
    SELECT s.id, s.name, s.status, s.city, s.contact_name, s.phone, s.email, s.created_at, t.name AS type,
           COUNT(DISTINCT CASE WHEN ${LIVE} THEN p.expediente_id END) AS exps,
           MAX(CASE WHEN ${LIVE} THEN e.start_date END) AS last_date,
           COALESCE(SUM(CASE WHEN ${LIVE} AND p.base_cents > 0 THEN p.base_cents END), 0) AS contracted,
           COALESCE(SUM(CASE WHEN ${LIVE} AND p.base_cents > 0 AND substr(e.start_date, 1, 4) = ?2 THEN p.base_cents END), 0) AS this_year
      FROM suppliers s
      LEFT JOIN supplier_types t ON t.id = s.type_id
      LEFT JOIN payments p ON p.supplier_id = s.id
      LEFT JOIN expedientes e ON e.id = p.expediente_id
     WHERE (?1 = '%%' OR s.name LIKE ?1 OR s.city LIKE ?1 OR s.contact_name LIKE ?1 OR s.email LIKE ?1
            OR EXISTS (SELECT 1 FROM supplier_aliases a WHERE a.supplier_id = s.id AND a.alias LIKE ?1))
       AND (?3 IS NULL OR s.type_id = ?3)
       AND (?4 = '' OR s.status = ?4)
       AND (?5 = '' OR s.city = ?5 COLLATE NOCASE)
     GROUP BY s.id`;
  const args = [likeTerm(q), String(year), typeId, status, city];
  const [count, page] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(contracted), 0) AS contracted, COALESCE(SUM(this_year), 0) AS this_year FROM (${base})`).bind(...args),
    db.prepare(`SELECT * FROM (${base}) ORDER BY ${orderBy(SORT, sort, dir, 'name', 'id')} LIMIT ?6 OFFSET ?7`).bind(...args, limit, offset),
  ]);
  const { n, ...sums } = count.results[0];
  return { rows: page.results, total: n, sums };
}

/** Las ciudades de los proveedores (para el filtro) @param {import('../services/types').Db} db */
export const cities = (db) => db.prepare(
  "SELECT DISTINCT city FROM suppliers WHERE city IS NOT NULL AND TRIM(city) <> '' ORDER BY city COLLATE NOCASE LIMIT 300",
).all().then((r) => r.results.map((x) => x.city));

/** Tipos con cuántos proveedores tiene cada uno */
export function types(db) {
  return db.prepare(
    `SELECT t.id, t.name, COUNT(s.id) AS n FROM supplier_types t LEFT JOIN suppliers s ON s.type_id = t.id
      GROUP BY t.id ORDER BY t.sort, t.name COLLATE NOCASE`,
  ).all().then((r) => r.results);
}

/** Un proveedor (sólo su fila) */
export const byId = (db, id) => db.prepare('SELECT id, name, status FROM suppliers WHERE id = ?').bind(id).first();

/** Los demás proveedores (para elegir con cuál fusionar) */
export const others = (db, id) => db.prepare('SELECT id, name FROM suppliers WHERE id <> ? ORDER BY name COLLATE NOCASE').bind(id).all().then((r) => r.results);

/** Ficha: el proveedor, sus nombres anteriores y una fila por expediente en el que ha trabajado */
export async function ficha(db, id) {
  const [s, aliases, rows] = await db.batch([
    db.prepare(`SELECT s.*, t.name AS type, u.name AS created_by_name FROM suppliers s
                  LEFT JOIN supplier_types t ON t.id = s.type_id LEFT JOIN users u ON u.id = s.created_by WHERE s.id = ?`).bind(id),
    db.prepare('SELECT alias FROM supplier_aliases WHERE supplier_id = ? ORDER BY alias COLLATE NOCASE').bind(id),
    db.prepare(
      `SELECT e.id, e.number, e.name, e.company, e.destination, e.start_date, e.end_date, e.status,
              COUNT(*) AS lines, GROUP_CONCAT(DISTINCT NULLIF(TRIM(p.concept), '')) AS concepts,
              COALESCE(SUM(CASE WHEN p.base_cents > 0 THEN p.base_cents END), 0) AS contracted,
              COALESCE(SUM(CASE WHEN p.base_cents > 0 AND ${HAS_INVOICE} THEN p.base_cents END), 0) AS invoiced,
              COALESCE(SUM(CASE WHEN p.base_cents > 0 AND p.status = 'pagado' THEN p.base_cents END), 0) AS paid,
              COALESCE(SUM(CASE WHEN p.base_cents > 0 AND p.status = 'pendiente' THEN p.base_cents END), 0) AS pending,
              COALESCE(SUM(CASE WHEN p.base_cents < 0 THEN p.base_cents END), 0) AS credits
         FROM payments p JOIN expedientes e ON e.id = p.expediente_id
        WHERE p.supplier_id = ?
        GROUP BY e.id
        ORDER BY e.start_date DESC, e.id DESC`,
    ).bind(id),
  ]);
  const supplier = s.results[0];
  if (!supplier) return null;
  return { supplier, aliases: aliases.results.map((a) => a.alias), expedientes: rows.results };
}

/** Todos los proveedores para el selector de los pagos (con sus nombres anteriores) */
export function options(db) {
  return db.prepare(
    `SELECT s.id, s.name, s.status, s.city, t.name AS type,
            (SELECT GROUP_CONCAT(a.alias, char(10)) FROM supplier_aliases a WHERE a.supplier_id = s.id) AS aliases
       FROM suppliers s LEFT JOIN supplier_types t ON t.id = s.type_id
      ORDER BY s.status = 'bloqueado', s.status = 'inactivo', s.name COLLATE NOCASE
      LIMIT 2000`,
  ).all().then((r) => r.results.map((x) => ({ ...x, aliases: x.aliases ? x.aliases.split('\n') : [] })));
}

/**
 * El proveedor de un id o, si no, de un nombre exacto o anterior (sin distinguir mayúsculas)
 * @param {import('../services/types').Db} db
 * @param {number | null} id
 * @param {string} name
 */
export function resolve(db, id, name) {
  return db.prepare(
    `SELECT s.id, s.name, s.status FROM suppliers s
      WHERE s.id = COALESCE((SELECT x.id FROM suppliers x WHERE x.id = ?1), (SELECT x.id FROM suppliers x WHERE x.name = ?2),
                            (SELECT a.supplier_id FROM supplier_aliases a WHERE a.alias = ?2))`,
  ).bind(id, name).first();
}

/**
 * ¿Ese nombre lo usa ya OTRO proveedor (como nombre o como nombre anterior)? → su nombre o null
 * @param {import('../services/types').Db} db
 * @param {string} name
 * @param {number} [exceptId]
 */
export async function nameTaken(db, name, exceptId = 0) {
  const row = await db.prepare(
    `SELECT s.name FROM suppliers s WHERE s.name = ?1 AND s.id <> ?2
     UNION ALL
     SELECT s.name FROM supplier_aliases a JOIN suppliers s ON s.id = a.supplier_id WHERE a.alias = ?1 AND a.supplier_id <> ?2
     LIMIT 1`,
  ).bind(name, exceptId).first();
  return row?.name ?? null;
}

/** ¿Cuántos pagos y contratos tiene? (para saber si se puede borrar) */
export const usage = (db, id) => db.prepare(
  `SELECT (SELECT COUNT(*) FROM payments WHERE supplier_id = ?1) AS payments,
          (SELECT COUNT(*) FROM supplier_contracts WHERE supplier_id = ?1) AS contracts`,
).bind(id).first();

// ── Cambios ────────────────────────────────────────────────────────────────

/**
 * Alta; null si otra persona lo ha dado de alta a la vez con el mismo nombre
 * @param {import('../services/types').Db} db
 * @param {Record<string, any>} d datos ya validados (SupplierSchema o SupplierQuickSchema)
 * @param {number | null} userId
 */
export function insert(db, d, userId) {
  return db.prepare(
    `INSERT INTO suppliers (name, type_id, status, city, contact_name, phone, email, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (name) DO NOTHING
     RETURNING id, name, status, city, (SELECT t.name FROM supplier_types t WHERE t.id = type_id) AS type`,
  ).bind(d.name, d.type_id ?? null, d.status ?? 'activo', d.city ?? null, d.contact_name ?? null, d.phone ?? null, d.email ?? null, userId).first();
}

export function updateStmt(db, id, d) {
  return db.prepare(
    `UPDATE suppliers SET name = ?, type_id = ?, status = ?, city = ?, address = ?, contact_name = ?, phone = ?, email = ?,
            max_capacity = ?, since_on = ?, economic_terms = ?, payment_terms = ?, notes = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
  ).bind(d.name, d.type_id, d.status, d.city, d.address, d.contact_name, d.phone, d.email,
    d.max_capacity, d.since_on, d.economic_terms, d.payment_terms, d.notes, id);
}

/**
 * Sentencias para renombrar: el nombre viejo queda como alias y los pagos y documentos pasan a
 * mostrar el nuevo (todas las pantallas dicen lo mismo).
 */
export function renameStmts(db, id, oldName, newName) {
  if (oldName === newName) return [];
  const caseOnly = oldName.toLowerCase() === newName.toLowerCase();
  return [
    db.prepare('DELETE FROM supplier_aliases WHERE alias = ? AND supplier_id = ?').bind(newName, id),
    ...(caseOnly ? [] : [db.prepare('INSERT INTO supplier_aliases (alias, supplier_id) VALUES (?, ?) ON CONFLICT (alias) DO UPDATE SET supplier_id = excluded.supplier_id').bind(oldName, id)]),
    db.prepare('UPDATE payments SET supplier = ? WHERE supplier_id = ?').bind(newName, id),
    db.prepare('UPDATE supplier_invoices SET supplier = ? WHERE supplier_id = ?').bind(newName, id),
  ];
}

const FILLABLE = ['type_id', 'city', 'address', 'contact_name', 'phone', 'email', 'max_capacity', 'since_on', 'economic_terms', 'payment_terms', 'notes'];

/**
 * Sentencias para fusionar `from` en `into`: sus pagos, documentos y contratos pasan a `into`, su nombre (y sus
 * nombres anteriores) quedan como alias de `into`, los datos que le falten a `into` se completan con
 * los de `from`, y `from` desaparece.
 */
export function mergeStmts(db, from, into) {
  return [
    db.prepare('UPDATE payments SET supplier_id = ?, supplier = ? WHERE supplier_id = ?').bind(into.id, into.name, from.id),
    db.prepare('UPDATE supplier_invoices SET supplier_id = ?, supplier = ? WHERE supplier_id = ?').bind(into.id, into.name, from.id),
    db.prepare('UPDATE supplier_aliases SET supplier_id = ? WHERE supplier_id = ?').bind(into.id, from.id),
    db.prepare('UPDATE supplier_contracts SET supplier_id = ? WHERE supplier_id = ?').bind(into.id, from.id),
    db.prepare('INSERT INTO supplier_aliases (alias, supplier_id) VALUES (?, ?) ON CONFLICT (alias) DO UPDATE SET supplier_id = excluded.supplier_id').bind(from.name, into.id),
    db.prepare(`UPDATE suppliers SET ${FILLABLE.map((f) => `${f} = COALESCE(${f}, (SELECT x.${f} FROM suppliers x WHERE x.id = ?1))`).join(', ')},
                       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?2`).bind(from.id, into.id),
    db.prepare('DELETE FROM suppliers WHERE id = ?').bind(from.id),
  ];
}

export const deleteStmt = (db, id) => db.prepare('DELETE FROM suppliers WHERE id = ?').bind(id);

/** Tipo nuevo al final de la lista; null si ya existe */
export function insertType(db, name) {
  return db.prepare(
    'INSERT INTO supplier_types (name, sort) VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 10 FROM supplier_types)) ON CONFLICT (name) DO NOTHING RETURNING id',
  ).bind(name).first();
}

/** Quita un tipo que no tenga ningún proveedor; devuelve cuántos ha quitado (0 si está en uso) */
export async function deleteUnusedType(db, typeId) {
  const { meta } = await db.prepare('DELETE FROM supplier_types WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM suppliers WHERE type_id = ?1)').bind(typeId).run();
  return meta.changes;
}
