// Contratos y acuerdos con proveedores (migrations/0010_contratos_proveedor.sql).
//
// El estado de un contrato no se guarda: se calcula por fechas cada vez.
//   · Aún no vigente      → empieza más adelante.
//   · Vigente             → en vigor (con o sin fecha de fin).
//   · Próximo a caducar   → faltan menos días que los del aviso de ESE contrato (cada uno tiene el suyo).
//   · Pendiente de renovación → marcado a mano: hay que negociar la renovación.
//   · Caducado            → ya terminó y no se ha renovado ni se ha decidido no renovarlo.
//   · Renovado            → terminó (o lo sustituye otro) y tiene su renovación: es historial.
//   · Finalizado          → terminó y se decidió no renovarlo.
// «Requiere atención» = próximo a caducar, pendiente de renovación o caducado: salen en el inicio y en
// el contador del menú (la misma condición en SQL: contractDue).
//
// El contrato que se aplicó a un expediente es el que estaba en vigor en la fecha del evento.
// Cambiar un contrato no reescribe el pasado: cada cambio queda en su historial y al renovar se crea
// un contrato nuevo (el anterior se conserva).
import { daysBetween, formatDate } from './dates.js';

export const RENEWAL = { pendiente: 'Pendiente de renovación', no: 'No se renueva' };

// Campos que se pueden cambiar y cómo se llaman en el historial
export const CONTRACT_FIELDS = {
  title: 'Nombre',
  signed_on: 'Firma',
  starts_on: 'Inicio',
  ends_on: 'Fin',
  conditions: 'Condiciones',
  rates: 'Tarifas',
  discounts: 'Descuentos y condiciones especiales',
  credit_terms: 'Condiciones de crédito',
  payment_terms: 'Condiciones de pago',
  other_terms: 'Otros acuerdos',
  notes: 'Comentarios',
  alert_days: 'Aviso',
};
const DATE_FIELDS = new Set(['signed_on', 'starts_on', 'ends_on']);

const inDays = (d) => (d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`);
const ago = (d) => (d === 1 ? 'ayer' : `hace ${d} días`);

/**
 * Estado de un contrato en la fecha `now`.
 * c: { starts_on, ends_on, alert_days, renewal, renewed_by } (renewed_by: id de su renovación, si la tiene)
 * @returns {{ key, label, tone, days: number|null, text: string, attention: boolean }}
 */
export function contractState(c, now) {
  const days = c.ends_on ? daysBetween(now, c.ends_on) : null;
  const renewed = c.renewed_by != null;
  const st = (key, label, tone, text) => ({ key, label, tone, days, text, attention: ['por_caducar', 'pendiente', 'caducado'].includes(key) });
  if (c.starts_on > now) return st('futuro', 'Aún no vigente', 'info', `Empieza el ${formatDate(c.starts_on)}`);
  if (days !== null && days < 0) {
    if (renewed) return st('renovado', 'Renovado', 'muted', `Terminó el ${formatDate(c.ends_on)} · renovado`);
    if (c.renewal === 'no') return st('finalizado', 'Finalizado', 'muted', `Terminó el ${formatDate(c.ends_on)} · no se renovó`);
    return st('caducado', 'Caducado', 'danger', `Caducó ${ago(-days)}${c.renewal === 'pendiente' ? ' · pendiente de renovación' : ''}`);
  }
  const ends = days === null ? 'Sin fecha de fin' : `Caduca ${inDays(days)}`;
  if (renewed) return st('vigente', 'Vigente', 'ok', `${ends} · ya renovado`);
  if (c.renewal === 'no') return st('vigente', 'Vigente', 'ok', `${ends} · no se renovará`);
  if (c.renewal === 'pendiente') return st('pendiente', RENEWAL.pendiente, 'warn', ends);
  if (days !== null && c.alert_days != null && days <= c.alert_days) return st('por_caducar', 'Próximo a caducar', 'warn', ends);
  return st('vigente', 'Vigente', 'ok', ends);
}

/** Lo mismo que `attention` de contractState, en SQL (alias c; `now`: el parámetro con la fecha de hoy) */
export const contractDue = (now = '?1') => `c.starts_on <= ${now}
  AND NOT EXISTS (SELECT 1 FROM supplier_contracts r WHERE r.replaces_id = c.id)
  AND (c.renewal IS NULL OR c.renewal <> 'no')
  AND (c.renewal = 'pendiente'
       OR c.ends_on < ${now}
       OR (c.alert_days IS NOT NULL AND c.ends_on <= date(${now}, '+' || c.alert_days || ' days')))`;

/** El contrato que estaba en vigor en una fecha (el que empezó más tarde, si se solapan) */
export function contractOn(contracts, date) {
  if (!date) return null;
  let best = null;
  for (const c of contracts) {
    if (c.starts_on <= date && (!c.ends_on || c.ends_on >= date) && (!best || c.starts_on > best.starts_on)) best = c;
  }
  return best;
}

/** Orden de las listas: primero lo que requiere atención (lo más urgente arriba), después lo vigente y el historial */
export function byUrgency(a, b) {
  const rank = (x) => (x.state.attention ? 0 : x.state.key === 'vigente' || x.state.key === 'futuro' ? 1 : 2);
  return rank(a) - rank(b)
    || (rank(a) === 2 ? (b.ends_on ?? '').localeCompare(a.ends_on ?? '') : (a.ends_on ?? '9999').localeCompare(b.ends_on ?? '9999'))
    || a.id - b.id;
}

/**
 * Qué ha cambiado entre dos versiones de un contrato.
 * @returns {{ changes: Record<string, [any, any]>, summary: string }} summary: «Fin: 31/12/2026 → 30/06/2027 · Tarifas»
 */
export function contractDiff(before, after) {
  const changes = {};
  const parts = [];
  for (const [f, label] of Object.entries(CONTRACT_FIELDS)) {
    const a = before[f] ?? null;
    const b = after[f] ?? null;
    if (a === b) continue;
    changes[f] = [a, b];
    if (DATE_FIELDS.has(f)) parts.push(`${label}: ${a ? formatDate(a) : 'sin fecha'} → ${b ? formatDate(b) : 'sin fecha'}`);
    else if (f === 'alert_days') parts.push(`${label}: ${a ? `${a} días` : 'sin aviso'} → ${b ? `${b} días` : 'sin aviso'}`);
    else if (f === 'title') parts.push(`${label}: «${a}» → «${b}»`);
    else parts.push(label);
  }
  return { changes, summary: parts.join(' · ') };
}

/** Datos para el formulario de una renovación: las mismas condiciones, empezando al día siguiente del fin */
export function renewalDraft(c, addDays) {
  const starts = c.ends_on ? addDays(c.ends_on, 1) : null;
  const length = c.ends_on ? daysBetween(c.starts_on, c.ends_on) : null;
  return {
    title: c.title,
    starts_on: starts ?? '',
    ends_on: starts && length !== null ? addDays(starts, length) : '',
    conditions: c.conditions, rates: c.rates, discounts: c.discounts, credit_terms: c.credit_terms,
    payment_terms: c.payment_terms, other_terms: c.other_terms, alert_days: c.alert_days,
  };
}

// ── Consultas ──────────────────────────────────────────────────────────────
const SELECT = `c.*, s.name AS supplier_name, s.city AS supplier_city, s.status AS supplier_status, t.name AS supplier_type,
  (SELECT r.id FROM supplier_contracts r WHERE r.replaces_id = c.id) AS renewed_by,
  f.name AS file_name, u.name AS created_by_name`;
const JOINS = `JOIN suppliers s ON s.id = c.supplier_id LEFT JOIN supplier_types t ON t.id = s.type_id
  LEFT JOIN files f ON f.id = c.file_id LEFT JOIN users u ON u.id = c.created_by`;
const withState = (now) => (c) => ({ ...c, state: contractState(c, now) });

/** Los contratos de un proveedor, con su estado */
export function supplierContracts(db, supplierId, now) {
  return db.prepare(`SELECT ${SELECT} FROM supplier_contracts c ${JOINS} WHERE c.supplier_id = ? ORDER BY c.starts_on DESC, c.id DESC`)
    .bind(supplierId).all().then((r) => r.results.map(withState(now)).sort(byUrgency));
}

/** Todos los contratos (pantalla de caducidades), con su estado; q busca en el proveedor y el nombre */
export function allContracts(db, now, q = '') {
  const like = `%${q}%`;
  return db.prepare(`SELECT ${SELECT} FROM supplier_contracts c ${JOINS}
                      WHERE (?1 = '%%' OR s.name LIKE ?1 OR c.title LIKE ?1 OR s.city LIKE ?1) ORDER BY c.ends_on, c.id LIMIT 1000`)
    .bind(like).all().then((r) => r.results.map(withState(now)).sort(byUrgency));
}

/** Contratos que requieren atención (inicio): próximos a caducar, pendientes de renovación o caducados */
export function contractsDue(db, now) {
  return db.prepare(`SELECT ${SELECT} FROM supplier_contracts c ${JOINS} WHERE ${contractDue()} ORDER BY c.ends_on IS NULL, c.ends_on, c.id`)
    .bind(now).all().then((r) => r.results.map(withState(now)));
}

/** Un contrato con su proveedor, el contrato al que renueva, su renovación y su historial */
export async function contractDetail(db, id, now) {
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
  const contract = c.results[0];
  return contract ? { contract: withState(now)(contract), history: history.results } : null;
}

/** Sentencia para apuntar algo en el historial de un contrato */
export function changeStmt(db, contractId, userId, action, summary, changes = null) {
  return db.prepare('INSERT INTO supplier_contract_changes (contract_id, user_id, action, summary, changes) VALUES (?, ?, ?, ?, ?)')
    .bind(contractId, userId, action, summary, changes ? JSON.stringify(changes) : null);
}
