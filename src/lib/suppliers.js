// Directorio de proveedores: fichas, nombres anteriores (alias), fusión y volumen de negocio.
// (Las facturas y proformas de cada pago están en supplier.js.)
//
// Cómo se calcula el volumen de negocio con un proveedor (siempre SIN IVA y sólo con expedientes
// no cancelados; no se guarda: sale de los pagos en cada consulta):
//   · Contratado  = Σ líneas de coste (importe positivo) del proveedor, previstas o con factura.
//   · Con factura = parte de lo contratado cuyas líneas tienen al menos una FACTURA (no proforma).
//   · Pagado      = parte de lo contratado ya pagada · Pendiente = la que falta por pagar.
//   · Abonos      = líneas negativas (abonos, comisiones del hotel, devoluciones): se muestran aparte.
//   · Año         = el del evento (fecha de inicio del expediente).
// Cada línea de coste cuenta una vez: no se suman los importes de los documentos del proveedor
// (una factura puede cubrir varios pagos y su total es opcional).

import { similarSuppliers } from './supplier-match.js';

export { similarSuppliers };

/** Nombre limpio: sin espacios sobrantes */
export const cleanName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ');

const orList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} o ${items.at(-1)}` : items[0]);

/**
 * Proveedor elegido en un pago. Nunca se crea aquí: se elige de la lista (el selector manda su id) y,
 * si es nuevo, se da de alta antes en un paso aparte que avisa de los parecidos (ver /proveedores/alta).
 * Sin JavaScript vale el nombre exacto de la ficha o uno anterior (sin distinguir mayúsculas).
 * keepId: el proveedor que ya tenía el pago (se puede seguir usando aunque esté en «No contratar»).
 * @returns {Promise<{ ok: true, supplier: { id: number, name: string, status: string } } | { ok: false, message: string }>}
 */
export async function resolveSupplier(db, pick, { keepId = null } = {}) {
  const name = cleanName(pick?.name);
  const id = Number(pick?.id);
  const s = await db.prepare(
    `SELECT s.id, s.name, s.status FROM suppliers s
      WHERE s.id = COALESCE((SELECT x.id FROM suppliers x WHERE x.id = ?1), (SELECT x.id FROM suppliers x WHERE x.name = ?2),
                            (SELECT a.supplier_id FROM supplier_aliases a WHERE a.alias = ?2))`,
  ).bind(Number.isInteger(id) && id > 0 ? id : null, name).first();
  if (!s) {
    if (!name) return { ok: false, message: 'Proveedor: elígelo de la lista' };
    const similar = similarSuppliers(name, await supplierOptions(db), 3).filter((x) => x.status !== 'bloqueado');
    const hint = similar.length ? ` ¿Es ${orList(similar.map((x) => `«${x.name}»`))}?` : '';
    return { ok: false, message: `Proveedor: «${name}» no está dado de alta.${hint} Elígelo de la lista o, si es nuevo, dalo de alta.` };
  }
  if (s.status === 'bloqueado' && s.id !== keepId) {
    return { ok: false, message: `Proveedor: ${s.name} está marcado como «No contratar». Elige otro.` };
  }
  return { ok: true, supplier: s };
}

/**
 * Los proveedores de varias filas (pagos previstos): cada fila trae { supplier, supplier_id }.
 * @returns {Promise<{ ok: true, of: (row) => { id, name } } | { ok: false, message: string }>}
 */
export async function resolveSuppliers(db, rows) {
  const found = new Map();
  for (const [i, r] of rows.entries()) {
    const key = `${r.supplier_id ?? ''}|${cleanName(r.supplier).toLowerCase()}`;
    if (!found.has(key)) {
      const res = await resolveSupplier(db, { id: r.supplier_id, name: r.supplier });
      if (!res.ok) return { ok: false, message: `Fila ${i + 1}: ${res.message}` };
      found.set(key, res.supplier);
    }
  }
  return { ok: true, of: (r) => found.get(`${r.supplier_id ?? ''}|${cleanName(r.supplier).toLowerCase()}`) };
}

/** Todos los proveedores para el selector (con sus nombres anteriores, para encontrarlos por ellos) */
export function supplierOptions(db) {
  return db.prepare(
    `SELECT s.id, s.name, s.status, s.city, t.name AS type,
            (SELECT GROUP_CONCAT(a.alias, char(10)) FROM supplier_aliases a WHERE a.supplier_id = s.id) AS aliases
       FROM suppliers s LEFT JOIN supplier_types t ON t.id = s.type_id
      ORDER BY s.status = 'bloqueado', s.status = 'inactivo', s.name COLLATE NOCASE
      LIMIT 2000`,
  ).all().then((r) => r.results.map((x) => ({ ...x, aliases: x.aliases ? x.aliases.split('\n') : [] })));
}

/**
 * Alta de un proveedor (desde el directorio o desde el selector de un pago). Antes se comprueba que
 * el nombre no exista y, si no se ha confirmado, que no haya otro con un nombre parecido.
 * d: los campos de SupplierSchema que se tengan (al menos el nombre).
 * @returns {Promise<{ ok: true, supplier } | { ok: false, taken?: string, similar?: object[] }>}
 */
export async function createSupplier(db, d, userId, { confirmed = false } = {}) {
  const name = cleanName(d.name);
  const taken = await nameTaken(db, name);
  if (taken) return { ok: false, taken };
  if (!confirmed) {
    const similar = similarSuppliers(name, await supplierOptions(db));
    if (similar.length) return { ok: false, similar };
  }
  const supplier = await db.prepare(
    `INSERT INTO suppliers (name, type_id, status, city, contact_name, phone, email, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (name) DO NOTHING
     RETURNING id, name, status, city, (SELECT t.name FROM supplier_types t WHERE t.id = type_id) AS type`,
  ).bind(name, d.type_id ?? null, d.status ?? 'activo', d.city ?? null, d.contact_name ?? null, d.phone ?? null, d.email ?? null, userId).first();
  // Otra persona lo ha dado de alta a la vez
  return supplier ? { ok: true, supplier } : { ok: false, taken: name };
}

// ── Consultas ──────────────────────────────────────────────────────────────
const LIVE = "e.status <> 'cancelado'";
const HAS_INVOICE = `EXISTS (SELECT 1 FROM payment_documents pd JOIN supplier_invoices si ON si.id = pd.document_id
                             WHERE pd.payment_id = p.id AND si.kind = 'factura')`;

/** Directorio con sus usos y lo contratado (total y en el año dado) */
export function supplierList(db, { q = '', typeId = null, status = '', year, order = 'name' } = {}) {
  const like = `%${q}%`;
  const ORDER = {
    name: 's.name COLLATE NOCASE',
    gasto: 'contracted DESC, s.name COLLATE NOCASE',
    year: 'this_year DESC, contracted DESC, s.name COLLATE NOCASE',
    uso: 'last_date IS NULL, last_date DESC, s.name COLLATE NOCASE',
    expedientes: 'exps DESC, s.name COLLATE NOCASE',
    altas: 's.created_at DESC, s.id DESC',
  };
  return db.prepare(
    `SELECT s.id, s.name, s.status, s.city, s.contact_name, s.created_at, t.name AS type,
            COUNT(DISTINCT CASE WHEN ${LIVE} THEN p.expediente_id END) AS exps,
            MAX(CASE WHEN ${LIVE} THEN e.start_date END) AS last_date,
            COALESCE(SUM(CASE WHEN ${LIVE} AND p.base_cents > 0 THEN p.base_cents END), 0) AS contracted,
            COALESCE(SUM(CASE WHEN ${LIVE} AND p.base_cents > 0 AND substr(e.start_date, 1, 4) = ?2 THEN p.base_cents END), 0) AS this_year
       FROM suppliers s
       LEFT JOIN supplier_types t ON t.id = s.type_id
       LEFT JOIN payments p ON p.supplier_id = s.id
       LEFT JOIN expedientes e ON e.id = p.expediente_id
      WHERE (?1 = '%%' OR s.name LIKE ?1 OR s.city LIKE ?1 OR s.contact_name LIKE ?1
             OR EXISTS (SELECT 1 FROM supplier_aliases a WHERE a.supplier_id = s.id AND a.alias LIKE ?1))
        AND (?3 IS NULL OR s.type_id = ?3)
        AND (?4 = '' OR s.status = ?4)
      GROUP BY s.id
      ORDER BY ${ORDER[order] ?? ORDER.name}
      LIMIT 500`,
  ).bind(like, String(year), typeId, status).all().then((r) => r.results);
}

/** Tipos con cuántos proveedores tiene cada uno */
export function supplierTypes(db) {
  return db.prepare(
    `SELECT t.id, t.name, COUNT(s.id) AS n FROM supplier_types t LEFT JOIN suppliers s ON s.type_id = t.id
      GROUP BY t.id ORDER BY t.sort, t.name COLLATE NOCASE`,
  ).all().then((r) => r.results);
}

/** Ficha: el proveedor, sus nombres anteriores y una fila por expediente en el que ha trabajado */
export async function supplierFicha(db, id) {
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

/**
 * Volumen de negocio a partir de las filas por expediente (los cancelados no cuentan).
 * Puro: se prueba en tests/suppliers.test.mjs.
 */
export function businessVolume(rows, year) {
  const live = rows.filter((r) => r.status !== 'cancelado');
  const sum = (list, f) => list.reduce((a, r) => a + (r[f] ?? 0), 0);
  const group = (key) => {
    const m = new Map();
    for (const r of live) {
      const k = key(r) || '—';
      const g = m.get(k) ?? { key: k, exps: 0, contracted: 0, paid: 0 };
      g.exps += 1;
      g.contracted += r.contracted;
      g.paid += r.paid;
      m.set(k, g);
    }
    return [...m.values()];
  };
  const byYear = group((r) => (r.start_date ?? '').slice(0, 4)).sort((a, b) => b.key.localeCompare(a.key));
  // Cambio respecto al año anterior (sólo si hay datos de ese año)
  for (const y of byYear) {
    const prev = byYear.find((p) => Number(p.key) === Number(y.key) - 1);
    y.change = prev && prev.contracted ? (y.contracted - prev.contracted) / prev.contracted : null;
  }
  const dates = live.map((r) => r.start_date).filter(Boolean).sort();
  const contracted = sum(live, 'contracted');
  return {
    exps: live.length,
    lines: sum(live, 'lines'),
    contracted,
    invoiced: sum(live, 'invoiced'),
    paid: sum(live, 'paid'),
    pending: sum(live, 'pending'),
    credits: sum(live, 'credits'),
    thisYear: sum(live.filter((r) => (r.start_date ?? '').startsWith(String(year))), 'contracted'),
    average: live.length ? Math.round(contracted / live.length) : 0,
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
    byYear,
    byClient: group((r) => r.company).sort((a, b) => b.contracted - a.contracted),
    byCity: group((r) => r.destination).sort((a, b) => b.contracted - a.contracted),
  };
}

// ── Cambios ────────────────────────────────────────────────────────────────

/** ¿Ese nombre lo usa ya OTRO proveedor (como nombre o como nombre anterior)? */
export async function nameTaken(db, name, exceptId = 0) {
  const row = await db.prepare(
    `SELECT s.name FROM suppliers s WHERE s.name = ?1 AND s.id <> ?2
     UNION ALL
     SELECT s.name FROM supplier_aliases a JOIN suppliers s ON s.id = a.supplier_id WHERE a.alias = ?1 AND a.supplier_id <> ?2
     LIMIT 1`,
  ).bind(cleanName(name), exceptId).first();
  return row?.name ?? null;
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
 * Sentencias para fusionar `from` en `into`: sus pagos y documentos pasan a `into`, su nombre (y sus
 * nombres anteriores) quedan como alias de `into`, los datos que le falten a `into` se completan con
 * los de `from`, y `from` desaparece.
 */
export function mergeStmts(db, from, into) {
  return [
    db.prepare('UPDATE payments SET supplier_id = ?, supplier = ? WHERE supplier_id = ?').bind(into.id, into.name, from.id),
    db.prepare('UPDATE supplier_invoices SET supplier_id = ?, supplier = ? WHERE supplier_id = ?').bind(into.id, into.name, from.id),
    db.prepare('UPDATE supplier_aliases SET supplier_id = ? WHERE supplier_id = ?').bind(into.id, from.id),
    db.prepare('INSERT INTO supplier_aliases (alias, supplier_id) VALUES (?, ?) ON CONFLICT (alias) DO UPDATE SET supplier_id = excluded.supplier_id').bind(from.name, into.id),
    db.prepare(`UPDATE suppliers SET ${FILLABLE.map((f) => `${f} = COALESCE(${f}, (SELECT x.${f} FROM suppliers x WHERE x.id = ?1))`).join(', ')},
                       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?2`).bind(from.id, into.id),
    db.prepare('DELETE FROM suppliers WHERE id = ?').bind(from.id),
  ];
}
