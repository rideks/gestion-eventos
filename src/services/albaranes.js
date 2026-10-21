// @ts-check
// Servicio de los albaranes de Business Travel: uno por reserva, con todos sus servicios y su PVP (sin el fee).
// Permisos: «viajes» para verlo y descargarlo; «viajes.albaran» para emitirlo, emitir una revisión y anularlo;
// «settings» para el formato del número (Ajustes).
// Número: ALB-2026-000001 (formato de Ajustes). Lo da el contador seguro en la misma transacción que el albarán:
// no se repite aunque dos personas emitan a la vez y no se vuelve a usar aunque el albarán se anule.
// Lo que dice cada revisión se guarda tal cual (emisor incluido): el documento de una revisión no cambia nunca.
// Si la reserva cambia después de emitirlo, la ficha lo avisa y se emite una revisión (la anterior se conserva).
import * as repo from '../repos/albaranes.js';
import * as travel from '../repos/travel.js';
import * as settings from '../repos/settings.js';
import * as counters from '../repos/counters.js';
import * as changes from '../repos/changes.js';
import { can, activityStmt } from '../lib/app.js';
import { DEFAULT_ALBARAN_PATTERN, ALBARAN_STATES, albaranCounterKey, albaranContent, sameContent, contentChanges, albaranView } from '../lib/albaranes.js';
import { patternProblem, formatNumber, numberParts, yearly, companyFrom } from '../lib/documents.js';
import { AlbaranSettingsSchema, AlbaranVoidSchema, validate } from '../lib/validate.js';
import { eur } from '../lib/money.js';
import { nowIso } from '../lib/dates.js';
import { done, fail, forbidden, notFound, invalid } from './result.js';

/** @typedef {import('./types').Context} Context */

const PATTERN_KEY = 'albaran_pattern';
const log = (/** @type {Context} */ ctx, /** @type {number} */ bookingId, /** @type {string} */ summary) =>
  changes.changeStmt(ctx.db, 'bt_booking', bookingId, ctx.user?.id ?? null, 'albaran', summary);
const parse = (/** @type {string | null | undefined} */ json) => {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};
const isNumberClash = (/** @type {any} */ err) => /UNIQUE constraint failed: bt_albaranes\.number/i.test(String(err?.message ?? err));

/** El formato del número y los datos del emisor (Ajustes) @param {import('./types').Db} db */
async function docSettings(db) {
  const s = await settings.values(db, [PATTERN_KEY], 'company_');
  return { pattern: s[PATTERN_KEY] || DEFAULT_ALBARAN_PATTERN, company: companyFrom(s) };
}

/** La reserva tal y como la devuelve el repositorio, con los pasajeros de cada servicio @param {any} d */
const withPassengers = (d) => {
  const byLine = new Map();
  for (const l of d.links) byLine.set(l.line_id, [...(byLine.get(l.line_id) ?? []), l.passenger_id]);
  return { booking: d.booking, passengers: d.passengers, lines: d.lines.map((/** @type {any} */ l) => ({ ...l, passenger_ids: byLine.get(l.id) ?? [] })) };
};

/** Lo que diría el albarán ahora @param {{ booking: any, passengers: any[], lines: any[] }} d */
const contentNow = ({ booking: b, passengers, lines }) => albaranContent({
  booking: b,
  client: {
    name: b.client_name, legal_name: b.client_legal_name, title: b.client_title, kind: b.client_kind, tax_id: b.client_tax_id,
    fiscal_address: b.client_fiscal_address, city: b.client_city, billing_email: b.client_billing_email, email: b.client_email,
  },
  passengers,
  lines,
});

/** La reserva con todo, para emitir o enseñar su albarán @param {Context} ctx @param {number} bookingId */
const loadBooking = async (ctx, bookingId) => {
  const d = Number.isInteger(bookingId) ? await travel.detail(ctx.db, bookingId) : null;
  return d ? withPassengers(d) : null;
};

// ── Consultas ──────────────────────────────────────────────────────────────

/**
 * Para la ficha de la reserva: su albarán (si lo tiene) con sus revisiones, si la reserva ha cambiado desde que se
 * emitió (y qué), los anulados, por qué no se puede emitir todavía (si es el caso) y si quien mira puede emitir.
 * @param {Context} ctx
 * @param {{ booking: any, passengers: any[], lines: any[] }} data la reserva (cada servicio con passenger_ids)
 */
export async function panel(ctx, data) {
  if (!can(ctx.user, 'viajes')) return forbidden();
  const { albaranes, revisions } = await repo.forBooking(ctx.db, data.booking.id);
  const now = contentNow(data);
  const revs = (/** @type {number} */ id) => revisions.filter((r) => r.albaran_id === id);
  const row = albaranes.find((a) => a.status !== 'anulado');
  let live = null;
  if (row) {
    const { content, ...a } = row;
    const stored = parse(content);
    const what = stored && !sameContent(stored, now) ? contentChanges(stored, now) : [];
    live = { ...a, state: ALBARAN_STATES[/** @type {keyof typeof ALBARAN_STATES} */ (a.status)], revisions: revs(a.id), changed: !!stored && !sameContent(stored, now), changes: what };
  }
  const voided = albaranes.filter((a) => a.status === 'anulado').map(({ content, ...a }) => ({ ...a, revisions: revs(a.id) }));
  const problem = data.booking.status === 'cancelada' ? 'La reserva está cancelada: no lleva albarán.'
    : !data.lines.length ? 'Todavía no tiene servicios: el albarán se emite cuando tenga alguno.' : null;
  return done({
    live, voided, problem, total: now.total_cents,
    state: live ? live.state : problem ? null : ALBARAN_STATES.pendiente,
    canEmit: can(ctx.user, 'viajes.albaran'),
  });
}

/**
 * El albarán como documento (vista imprimible y PDF), ya en textos (albaranView). Por defecto, la revisión vigente
 * de su albarán; con albaranId y revision, esa (también las de un albarán anulado). Si la reserva no tiene albarán,
 * o se pide el borrador (draft), sale el borrador con los datos de ahora: sin número y marcado como BORRADOR.
 * @param {Context} ctx
 * @param {number} bookingId
 * @param {{ albaranId?: number | null, revision?: number | null, draft?: boolean }} [which]
 */
export async function document(ctx, bookingId, { albaranId = null, revision = null, draft = false } = {}) {
  if (!can(ctx.user, 'viajes')) return forbidden();
  const d = await loadBooking(ctx, bookingId);
  if (!d) return notFound();
  const { albaranes, revisions } = await repo.forBooking(ctx.db, bookingId);
  const now = contentNow(d);
  const live = albaranes.find((a) => a.status !== 'anulado') ?? null;
  const a = draft ? null : albaranId ? albaranes.find((x) => x.id === albaranId) : live;
  if (!draft && albaranId && !a) return notFound();
  const booking = { id: d.booking.id, reference: d.booking.reference };
  if (!a) {
    const { company } = await docSettings(ctx.db);
    return done({ view: albaranView({ company, ...now }, { draft: true }), booking, draft: true, albaran: null, revisions: [], changed: false, current: true });
  }
  const rev = revision ?? a.revision;
  const r = rev === a.revision ? { content: a.content, issued_on: a.issued_on } : await repo.revision(ctx.db, bookingId, a.id, rev);
  const content = parse(r?.content);
  if (!r || !content) return notFound();
  const { content: _, ...albaran } = a;
  return done({
    view: albaranView(content, { number: a.number, revision: rev, issued_on: r.issued_on, status: a.status, void_reason: a.void_reason }),
    booking, draft: false, albaran, revisions: revisions.filter((x) => x.albaran_id === a.id),
    // ¿La reserva ha cambiado desde la revisión vigente? (para ofrecer el borrador de la siguiente)
    changed: a.status === 'emitido' && !sameContent(parse(a.content) ?? {}, now), current: rev === a.revision,
  });
}

// ── Emitir, revisar y anular ───────────────────────────────────────────────

/**
 * Emitir el albarán de una reserva: recibe su número, la fecha de hoy y su revisión 1 con lo que dice ahora.
 * Hace falta que tenga servicios y que no esté cancelada (una cerrada sí: el viaje ya se hizo).
 * @param {Context} ctx
 * @param {number} bookingId
 */
export async function emit(ctx, bookingId) {
  if (!can(ctx.user, 'viajes.albaran')) return forbidden();
  const d = await loadBooking(ctx, bookingId);
  if (!d) return notFound();
  if (d.booking.status === 'cancelada') return fail('conflict', 'La reserva está cancelada: no se emite su albarán.');
  if (!d.lines.length) return fail('conflict', 'La reserva todavía no tiene servicios: añádelos antes de emitir el albarán.');
  if (await repo.live(ctx.db, bookingId)) return fail('conflict', 'La reserva ya tiene su albarán. Si ha cambiado, emite una revisión.');
  const { pattern, company } = await docSettings(ctx.db);
  const year = Number(ctx.now.slice(0, 4));
  const key = albaranCounterKey(pattern, year);
  const { prefix, suffix } = numberParts(pattern, year);
  const content = { company, ...contentNow(d) };
  const stmts = repo.emitStmts(ctx.db, {
    bookingId, counterKey: key, prefix, suffix, issuedOn: ctx.now, userId: ctx.user?.id ?? null, content: JSON.stringify(content), total: content.total_cents,
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await ctx.db.batch(stmts);
      const row = res[1].results[0];
      if (!row) return fail('conflict', 'Otra persona acaba de emitir el albarán de esta reserva.');
      await ctx.db.batch([
        log(ctx, bookingId, `Albarán ${row.number} emitido · PVP ${eur(content.total_cents)}`),
        activityStmt(ctx.db, ctx.actor, null, 'bt_albaran.emit', `emitió el albarán ${row.number} de la reserva ${d.booking.reference} (${eur(content.total_cents)})`),
      ]);
      return done({ id: row.id, number: row.number });
    } catch (err) {
      // El siguiente número ya existe (el formato se cambió en Ajustes): se salta y se prueba con el siguiente
      if (!isNumberClash(err)) throw err;
      await counters.next(ctx.db, key);
    }
  }
  return fail('conflict', 'No se ha podido dar un número de albarán libre: revisa el formato en Ajustes.');
}

/**
 * Emitir una revisión del albarán (mismo número, revisión siguiente, fecha de hoy) cuando la reserva ha cambiado
 * algo de lo que sale en el documento. La revisión anterior se conserva tal cual. Uno facturado no se revisa.
 * @param {Context} ctx
 * @param {number} bookingId
 */
export async function revise(ctx, bookingId) {
  if (!can(ctx.user, 'viajes.albaran')) return forbidden();
  const d = await loadBooking(ctx, bookingId);
  if (!d) return notFound();
  const a = await repo.live(ctx.db, bookingId);
  if (!a) return fail('conflict', 'La reserva todavía no tiene albarán: emítelo.');
  if (a.status === 'facturado') return fail('conflict', 'El albarán ya está facturado: no se puede revisar.');
  const stored = parse((await repo.revision(ctx.db, bookingId, a.id, a.revision))?.content);
  const now = contentNow(d);
  if (stored && sameContent(stored, now)) return fail('conflict', 'No hay cambios: el albarán ya recoge la reserva tal y como está.');
  if (!d.lines.length) return fail('conflict', 'La reserva se ha quedado sin servicios: si ya no sigue adelante, anula el albarán o cancela la reserva.');
  const { company } = await docSettings(ctx.db);
  const content = { company, ...now };
  const [updated] = await ctx.db.batch(repo.reviseStmts(ctx.db, {
    id: a.id, from: a.revision, issuedOn: ctx.now, userId: ctx.user?.id ?? null, content: JSON.stringify(content), total: content.total_cents, at: nowIso(),
  }));
  const rev = updated.results[0]?.revision;
  if (!rev) return fail('conflict', 'Otra persona acaba de emitir una revisión de este albarán.');
  const what = stored ? contentChanges(stored, now) : [];
  await ctx.db.batch([
    log(ctx, bookingId, `Albarán ${a.number}: revisión ${rev} emitida${what.length ? ` (cambian ${what.join(', ')})` : ''}`),
    activityStmt(ctx.db, ctx.actor, null, 'bt_albaran.revise', `emitió la revisión ${rev} del albarán ${a.number} (${eur(content.total_cents)})`),
  ]);
  return done({ number: a.number, revision: rev });
}

/**
 * Anular el albarán de una reserva (p. ej. emitido por error), con el motivo. Se conserva con su número, que no se
 * vuelve a usar; la reserva vuelve a quedar pendiente de emisión. Uno facturado no se anula (antes, la factura).
 * @param {Context} ctx
 * @param {number} bookingId
 * @param {Record<string, any>} input void_reason
 */
export async function voidAlbaran(ctx, bookingId, input) {
  if (!can(ctx.user, 'viajes.albaran')) return forbidden();
  const b = Number.isInteger(bookingId) ? await travel.header(ctx.db, bookingId) : null;
  if (!b) return notFound();
  const a = await repo.live(ctx.db, bookingId);
  if (!a) return fail('conflict', 'La reserva no tiene un albarán que anular.');
  if (a.status === 'facturado') return fail('conflict', 'El albarán está facturado: para anularlo, antes hay que anular la factura.');
  const v = validate(AlbaranVoidSchema, input);
  if (!v.ok) return invalid(v);
  const voided = await repo.voidStmt(ctx.db, a.id, { reason: v.data.void_reason, userId: ctx.user?.id ?? null, at: nowIso() }).first();
  if (!voided) return fail('conflict', 'El albarán ya no está emitido.');
  await ctx.db.batch([
    log(ctx, bookingId, `Albarán ${a.number} anulado · «${v.data.void_reason}»`),
    activityStmt(ctx.db, ctx.actor, null, 'bt_albaran.void', `anuló el albarán ${a.number} de la reserva ${b.reference}`),
  ]);
  return done({ number: a.number });
}

// ── Ajustes: el formato del número ─────────────────────────────────────────

/** El formato y el próximo número (sin darlo) @param {Context} ctx */
export async function numbering(ctx) {
  if (!can(ctx.user, 'settings')) return forbidden();
  const { pattern } = await docSettings(ctx.db);
  const year = Number(ctx.now.slice(0, 4));
  const n = (await counters.last(ctx.db, albaranCounterKey(pattern, year))) + 1;
  return done({ pattern, next: formatNumber(pattern, n, year), yearly: yearly(pattern) });
}

/**
 * Cambiar el formato del número (los albaranes ya emitidos conservan el suyo)
 * @param {Context} ctx
 * @param {Record<string, any>} input albaran_pattern
 */
export async function saveNumbering(ctx, input) {
  if (!can(ctx.user, 'settings')) return forbidden();
  const v = validate(AlbaranSettingsSchema, input);
  if (!v.ok) return invalid(v);
  const bad = patternProblem(v.data.albaran_pattern, DEFAULT_ALBARAN_PATTERN);
  if (bad) return fail('invalid', bad, { fields: { albaran_pattern: bad } });
  await ctx.db.batch([
    settings.upsertStmt(ctx.db, PATTERN_KEY, v.data.albaran_pattern),
    activityStmt(ctx.db, ctx.actor, null, 'settings.albaranes', `cambió el formato de los albaranes: ${v.data.albaran_pattern}`),
  ]);
  return done({ pattern: v.data.albaran_pattern });
}
