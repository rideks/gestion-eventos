// @ts-check
// Servicio de Business Travel: las reservas de viajes de empresa de cada cliente, sus pasajeros y sus servicios
// (transporte, alojamiento, inscripción y otros). Aparte de los expedientes: no los usa ni los cambia.
// Permisos: «viajes» para ver y gestionar las reservas; «viajes.fee» para ver y cambiar el fee oculto de cada
// servicio (sin él no llega: el fee de un servicio se conserva al cambiarlo y uno nuevo va sin fee); «viajes.close»
// para cerrar una reserva cuando el viaje ha terminado (y reabrirla).
// Una reserva cancelada o cerrada no se cambia (se puede reabrir). Los cambios quedan en su historial (change_log).
import * as repo from '../repos/travel.js';
import * as changes from '../repos/changes.js';
import * as counters from '../repos/counters.js';
import * as rates from '../repos/rates.js';
import * as clients from './clients.js';
import * as suppliers from './suppliers.js';
import { can, activityStmt } from '../lib/app.js';
import { LINE_KINDS, BOOKING_STATUS, BOOKING_TABS, personName, bookingReference, parseLineAmounts, pvpOf, bookingSummary, bookingDates, bookingState, closeChecks } from '../lib/travel.js';
import { BtBookingSchema, BtPassengerSchema, btLineSchema, validate } from '../lib/validate.js';
import { diffFields } from '../lib/changes.js';
import { eur } from '../lib/money.js';
import { allowedColumns } from '../lib/table.js';
import { TABLES } from '../lib/tables.js';
import { nowIso } from '../lib/dates.js';
import { done, fail, forbidden, notFound, invalid } from './result.js';

/** @typedef {import('./types').Context} Context */

const CANCELLED = 'La reserva está cancelada: reábrela para cambiarla.';
const CLOSED = 'La reserva está cerrada: reábrela para cambiarla.';
const seesFee = (/** @type {Context} */ ctx) => can(ctx.user, 'viajes.fee');
const noFee = (/** @type {Record<string, any>} */ row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'fee_cents'));
const log = (/** @type {Context} */ ctx, /** @type {number} */ id, /** @type {string} */ action, /** @type {string} */ summary, /** @type {any} */ diff = null) =>
  changes.changeStmt(ctx.db, 'bt_booking', id, ctx.user?.id ?? null, action, summary, diff);

/**
 * La reserva (que exista y, para cambiarla, que no esté cancelada ni cerrada)
 * @param {Context} ctx
 * @param {number} id
 * @param {{ write?: boolean }} [options]
 */
async function load(ctx, id, { write = true } = {}) {
  if (!can(ctx.user, 'viajes')) return forbidden();
  const b = Number.isInteger(id) ? await repo.header(ctx.db, id) : null;
  if (!b) return notFound();
  if (write && b.status === 'cancelada') return fail('conflict', CANCELLED);
  if (write && b.closed_at) return fail('conflict', CLOSED);
  return done(b);
}

// ── Consultas ──────────────────────────────────────────────────────────────

/**
 * Reservas por páginas: una pestaña (en curso, por cerrar, mías, cerradas, canceladas o todas; por defecto todas),
 * buscador, filtros (cliente y mes) y orden por cualquier columna que pueda ver. Sin «viajes.fee» no llega el fee
 * (ni se ordena por él). Devuelve cuántas hay en cada pestaña con esos filtros y los totales de la pestaña (sin las
 * canceladas). Cada fila lleva su estado (state) para enseñarlo.
 * @param {Context} ctx
 * @param {{ q?: string, view?: string, month?: string, clientId?: number | null, order?: string, dir?: string | null, limit?: number, offset?: number }} [filters]
 */
export async function list(ctx, { q = '', view = 'todas', month = '', clientId = null, order = 'reserva', dir = null, limit = 25, offset = 0 } = {}) {
  if (!can(ctx.user, 'viajes')) return forbidden();
  const user = ctx.user;
  const sortable = allowedColumns(TABLES.viajes, (p) => can(user, p)).filter((c) => c.sort);
  const col = sortable.find((c) => c.key === order) ?? sortable[0];
  const d = dir === 'asc' || dir === 'desc' ? dir : col.sort;
  const tab = Object.hasOwn(BOOKING_TABS, view) ? view : 'todas';
  const mo = /^\d{4}-\d{2}$/.test(month) ? month : '';
  const [res, clientOptions] = await Promise.all([
    repo.list(ctx.db, { q: q.trim().slice(0, 80), view: tab, today: ctx.now, userId: user?.id ?? null, month: mo,
      clientId: Number.isInteger(clientId) ? clientId : null, sort: col.key, dir: d, limit: Math.min(Math.max(1, limit), 100), offset: Math.max(0, offset) }),
    repo.clientsWithBookings(ctx.db),
  ]);
  const fee = seesFee(ctx);
  const rows = res.rows.map((r) => ({ ...(fee ? r : noFee(r)), state: bookingState(r, ctx.now) }));
  return done({
    rows, total: res.total, counts: res.counts, sums: fee ? res.sums : noFee(res.sums),
    clients: clientOptions, view: tab, month: mo, order: col.key, dir: d, fee,
  });
}

/** Las reservas de un cliente (su ficha) @param {Context} ctx @param {number} clientId */
export async function forClient(ctx, clientId) {
  if (!can(ctx.user, 'viajes')) return forbidden();
  const rows = (await repo.forClient(ctx.db, clientId)).map((r) => ({ ...r, state: bookingState(r, ctx.now) }));
  return done(seesFee(ctx) ? rows : rows.map(noFee));
}

/**
 * Ficha de una reserva: el cliente, los pasajeros, los servicios de cada bloque (con sus pasajeros), el resumen
 * económico, el historial y lo que necesitan sus formularios (tipos de IVA, proveedores, pasajeros conocidos).
 * @param {Context} ctx
 * @param {number} id
 */
export async function detail(ctx, id) {
  if (!can(ctx.user, 'viajes')) return forbidden();
  const d = Number.isInteger(id) ? await repo.detail(ctx.db, id) : null;
  if (!d) return notFound();
  const fee = seesFee(ctx);
  const editable = d.booking.status !== 'cancelada' && !d.booking.closed_at;
  const [history, vatRates, picker, known, clientPicker] = await Promise.all([
    changes.forEntity(ctx.db, 'bt_booking', id),
    rates.list(ctx.db),
    editable ? suppliers.pickerData(ctx) : null,
    editable ? repo.knownPassengers(ctx.db, d.booking.client_id) : [],
    editable ? clients.pickerData(ctx) : null,
  ]);
  const byLine = new Map();
  for (const l of d.links) byLine.set(l.line_id, [...(byLine.get(l.line_id) ?? []), l.passenger_id]);
  const lines = d.lines.map((l) => ({ ...(fee ? l : noFee(l)), passenger_ids: byLine.get(l.id) ?? [] }));
  const full = bookingSummary(d.lines);
  const dates = bookingDates(d.lines);
  const state = bookingState({ ...d.booking, lines: d.lines.length, first_date: dates.from, last_date: dates.to }, ctx.now);
  // Antes de cerrar (sólo si está abierta): lo que está hecho y lo que falta
  const checks = editable ? closeChecks({ passengers: d.passengers, lines }, ctx.now) : [];
  const summary = fee ? full : { ...full, fee: undefined, byKind: Object.fromEntries(Object.entries(full.byKind).map(([k, t]) => [k, { ...t, fee: undefined }])) };
  return done({
    booking: d.booking, passengers: d.passengers, lines, summary, dates, state, checks, canClose: can(ctx.user, 'viajes.close'), history,
    rates: vatRates, options: picker?.ok ? picker.value.options : [], types: picker?.ok ? picker.value.types : [],
    clients: clientPicker?.ok ? clientPicker.value.options : [], known, fee, editable,
  });
}

/** Lo que necesita el formulario de una reserva nueva (la lista de clientes) @param {Context} ctx */
export async function draft(ctx) {
  if (!can(ctx.user, 'viajes')) return forbidden();
  const picker = await clients.pickerData(ctx);
  return done({ clients: picker.ok ? picker.value.options : [] });
}

// ── Reservas ───────────────────────────────────────────────────────────────

/**
 * Reserva nueva de un cliente de la lista (el selector manda su id; si es nuevo, se da de alta antes).
 * Recibe su referencia (BT-2026-0001), única y que no se reutiliza.
 * @param {Context} ctx
 * @param {Record<string, any>} input client, client_id, title, notes
 */
export async function create(ctx, input) {
  if (!can(ctx.user, 'viajes')) return forbidden();
  const parsed = validate(BtBookingSchema, input);
  if (!parsed.ok) return invalid(parsed);
  const client = await clients.resolveForBooking(ctx, { id: input.client_id, name: input.client });
  if (!client.ok) return client;
  const year = ctx.now.slice(0, 4);
  const reference = bookingReference(year, await counters.next(ctx.db, `bt_booking:${year}`));
  const id = await repo.insert(ctx.db, { reference, clientId: client.value.id, title: parsed.data.title, notes: parsed.data.notes, userId: ctx.user?.id ?? null });
  await ctx.db.batch([
    log(ctx, id, 'alta', `Alta de la reserva para ${client.value.name}`),
    activityStmt(ctx.db, ctx.actor, null, 'bt_booking.create', `creó la reserva ${reference} de ${client.value.name}`),
  ]);
  return done({ id, reference });
}

/**
 * Cambiar el cliente, la descripción o los comentarios
 * @param {Context} ctx
 * @param {number} id
 * @param {Record<string, any>} input
 */
export async function update(ctx, id, input) {
  const r = await load(ctx, id);
  if (!r.ok) return r;
  const parsed = validate(BtBookingSchema, input);
  if (!parsed.ok) return invalid(parsed);
  const client = await clients.resolveForBooking(ctx, { id: input.client_id, name: input.client });
  if (!client.ok) return client;
  const before = (await repo.detail(ctx.db, id))?.booking;
  const d = { clientId: client.value.id, title: parsed.data.title, notes: parsed.data.notes };
  const diff = diffFields({ client: before?.client_name, title: before?.title, notes: before?.notes }, { client: client.value.name, ...d },
    { client: { label: 'Cliente' }, title: { label: 'Descripción' }, notes: { label: 'Comentarios', show: false } });
  if (!diff.summary) return done({ id, changed: false });
  await ctx.db.batch([repo.updateStmt(ctx.db, id, d, nowIso()), log(ctx, id, 'datos', diff.summary, diff.changes)]);
  return done({ id, changed: true });
}

/**
 * Cancelar o reabrir
 * @param {Context} ctx
 * @param {number} id
 * @param {'abierta' | 'cancelada'} status
 */
export async function setStatus(ctx, id, status) {
  const r = await load(ctx, id, { write: false });
  if (!r.ok) return r;
  if (!Object.hasOwn(BOOKING_STATUS, status)) return fail('invalid', 'Estado no válido.');
  if (r.value.status === status) return done({ id });
  if (r.value.closed_at) return fail('conflict', CLOSED);
  await ctx.db.batch([
    repo.statusStmt(ctx.db, id, status, nowIso()),
    log(ctx, id, 'estado', status === 'cancelada' ? 'Reserva cancelada' : 'Reserva reabierta'),
    activityStmt(ctx.db, ctx.actor, null, `bt_booking.${status === 'cancelada' ? 'cancel' : 'reopen'}`,
      `${status === 'cancelada' ? 'canceló' : 'reabrió'} la reserva ${r.value.reference}`),
  ]);
  return done({ id });
}

/**
 * Cerrar una reserva: el viaje ha terminado y está todo (servicios, pasajeros en cada uno y localizadores; ver
 * closeChecks en src/lib/travel.js). Queda de sólo lectura. Permiso «viajes.close».
 * @param {Context} ctx
 * @param {number} id
 */
export async function close(ctx, id) {
  if (!can(ctx.user, 'viajes.close')) return forbidden();
  const r = await load(ctx, id);
  if (!r.ok) return r;
  const d = await repo.detail(ctx.db, id);
  if (!d) return notFound();
  const byLine = new Map();
  for (const l of d.links) byLine.set(l.line_id, [...(byLine.get(l.line_id) ?? []), l.passenger_id]);
  const pending = closeChecks({ passengers: d.passengers, lines: d.lines.map((l) => ({ ...l, passenger_ids: byLine.get(l.id) ?? [] })) }, ctx.now)
    .filter((c) => !c.ok);
  if (pending.length) {
    const what = pending.map((c) => (c.missing?.length ? `${c.label.toLowerCase()} (${c.missing.join(', ')})` : c.label.toLowerCase()));
    return fail('conflict', `Todavía no se puede cerrar: ${what.join('; ')}.`);
  }
  const at = nowIso();
  await ctx.db.batch([
    repo.closeStmt(ctx.db, id, ctx.user?.id ?? null, at, at),
    log(ctx, id, 'estado', 'Reserva cerrada'),
    activityStmt(ctx.db, ctx.actor, null, 'bt_booking.close', `cerró la reserva ${r.value.reference}`),
  ]);
  return done({ id });
}

/**
 * Reabrir una reserva cerrada (para corregir algo). Permiso «viajes.close».
 * @param {Context} ctx
 * @param {number} id
 */
export async function reopenClosed(ctx, id) {
  if (!can(ctx.user, 'viajes.close')) return forbidden();
  const r = await load(ctx, id, { write: false });
  if (!r.ok) return r;
  if (!r.value.closed_at) return done({ id });
  await ctx.db.batch([
    repo.closeStmt(ctx.db, id, null, null, nowIso()),
    log(ctx, id, 'estado', 'Reserva reabierta (estaba cerrada)'),
    activityStmt(ctx.db, ctx.actor, null, 'bt_booking.reopen', `reabrió la reserva cerrada ${r.value.reference}`),
  ]);
  return done({ id });
}

/**
 * Borrar una reserva: sólo vacía (sin pasajeros ni servicios), p. ej. creada por error. Si no, se cancela.
 * Su referencia no se vuelve a usar.
 * @param {Context} ctx
 * @param {number} id
 */
export async function remove(ctx, id) {
  const r = await load(ctx, id, { write: false });
  if (!r.ok) return r;
  if (!(await repo.isEmpty(ctx.db, id))) return fail('conflict', 'Tiene pasajeros o servicios: no se puede borrar. Si ya no sigue adelante, cancélala.');
  await ctx.db.batch([
    repo.deleteStmt(ctx.db, id),
    activityStmt(ctx.db, ctx.actor, null, 'bt_booking.delete', `borró la reserva ${r.value.reference} (vacía)`),
  ]);
  return done({ id });
}

// ── Pasajeros ──────────────────────────────────────────────────────────────

/** @param {Context} ctx @param {number} id @param {Record<string, any>} input */
export async function addPassenger(ctx, id, input) {
  const r = await load(ctx, id);
  if (!r.ok) return r;
  const parsed = validate(BtPassengerSchema, input);
  if (!parsed.ok) return invalid(parsed);
  const pid = await repo.insertPassenger(ctx.db, id, parsed.data);
  await ctx.db.batch([repo.touchStmt(ctx.db, id, nowIso()), log(ctx, id, 'pasajero', `Pasajero: ${personName(parsed.data)}`)]);
  return done({ id: pid });
}

/** @param {Context} ctx @param {number} id @param {number} passengerId @param {Record<string, any>} input */
export async function updatePassenger(ctx, id, passengerId, input) {
  const r = await load(ctx, id);
  if (!r.ok) return r;
  const before = await repo.passenger(ctx.db, id, passengerId);
  if (!before) return notFound();
  const parsed = validate(BtPassengerSchema, input);
  if (!parsed.ok) return invalid(parsed);
  const diff = diffFields(before, parsed.data, {
    title: { label: 'Tratamiento' }, first_name: { label: 'Nombre' }, last_name: { label: 'Apellidos' }, email: { label: 'Email' },
    phone: { label: 'Teléfono' }, notes: { label: 'Datos adicionales', show: false },
  });
  if (!diff.summary) return done({ id: passengerId, changed: false });
  await ctx.db.batch([
    repo.updatePassengerStmt(ctx.db, passengerId, parsed.data),
    repo.touchStmt(ctx.db, id, nowIso()),
    log(ctx, id, 'pasajero', `${personName(before)}: ${diff.summary}`, diff.changes),
  ]);
  return done({ id: passengerId, changed: true });
}

/** Se quita también de los servicios que usaba @param {Context} ctx @param {number} id @param {number} passengerId */
export async function removePassenger(ctx, id, passengerId) {
  const r = await load(ctx, id);
  if (!r.ok) return r;
  const p = await repo.passenger(ctx.db, id, passengerId);
  if (!p) return notFound();
  await ctx.db.batch([
    repo.deletePassengerStmt(ctx.db, passengerId),
    repo.touchStmt(ctx.db, id, nowIso()),
    log(ctx, id, 'pasajero', `Pasajero quitado: ${personName(p)}`),
  ]);
  return done({ id: passengerId });
}

// ── Servicios ──────────────────────────────────────────────────────────────

/**
 * Valida un servicio de un bloque: sus datos, su proveedor (del directorio), sus pasajeros (de la reserva) y sus
 * importes. before: el servicio que se cambia (su fee se conserva si no se puede ver).
 * @param {Context} ctx
 * @param {number} bookingId
 * @param {string} kind
 * @param {Record<string, any>} input
 * @param {unknown[]} passengerIds
 * @param {Record<string, any> | null} before
 */
async function lineData(ctx, bookingId, kind, input, passengerIds, before = null) {
  const k = LINE_KINDS[/** @type {keyof typeof LINE_KINDS} */ (kind)];
  if (!k) return fail('invalid', 'Tipo de servicio no válido.');
  const parsed = validate(btLineSchema(k.fields, k.required), input);
  if (!parsed.ok) return invalid(parsed);
  // Proveedor: del directorio (el que ya tenía se puede mantener aunque ahora esté en «No contratar»)
  let supplier = null;
  if (String(input.supplier ?? '').trim() || String(input.supplier_id ?? '').trim()) {
    const s = await suppliers.resolveForTravel(ctx, { id: input.supplier_id, name: input.supplier }, { keepId: before?.supplier_id ?? null });
    if (!s.ok) return s;
    supplier = { id: s.value.id, name: s.value.name };
  } else if (k.supplier === 'required') {
    return fail('invalid', 'Proveedor: elígelo de la lista', { fields: { supplier: 'Proveedor: elígelo de la lista' } });
  }
  // Pasajeros: de esta reserva
  const mine = new Set(await repo.passengerIds(ctx.db, bookingId));
  const ids = [...new Set(passengerIds.map(Number))].filter((p) => mine.has(p));
  if (k.passengers === 'one' && ids.length !== 1) {
    return fail('invalid', `${k.who}: elige uno${mine.size ? '' : ' (añade antes el pasajero a la reserva)'}`, { fields: { passengers: `${k.who}: elige uno` } });
  }
  if (kind !== 'otros' && !ids.length) {
    return fail('invalid', `${k.who}: elige al menos uno${mine.size ? '' : ' (añade antes los pasajeros a la reserva)'}`, { fields: { passengers: `${k.who}: elige al menos uno` } });
  }
  // Importes: el fee sólo lo escribe quien puede verlo
  const amounts = parseLineAmounts({ base: input.base, total: input.total, vat: input.vat, fee: seesFee(ctx) ? input.fee ?? '' : null });
  if (!amounts.ok) return fail('invalid', amounts.message, { fields: { [amounts.field]: amounts.message } });
  const fee = amounts.fee ?? before?.fee_cents ?? 0;
  return done({
    data: { kind, supplier, ...parsed.data, base: amounts.base, vat_bp: amounts.vat_bp, total: amounts.total, fee, pvp: pvpOf(amounts.total, fee) },
    passengerIds: ids,
  });
}

/** 'Transporte · Ryanair · Madrid → Barcelona' */
const lineTitle = (/** @type {{ kind: string, supplier: { name: string } | null, description: string | null }} */ d) =>
  [LINE_KINDS[/** @type {keyof typeof LINE_KINDS} */ (d.kind)].label, d.supplier?.name, d.description].filter(Boolean).join(' · ');

/**
 * Servicio nuevo en un bloque de la reserva
 * @param {Context} ctx
 * @param {number} id
 * @param {string} kind transporte · alojamiento · inscripcion · otros
 * @param {Record<string, any>} input
 * @param {unknown[]} passengerIds
 */
export async function addLine(ctx, id, kind, input, passengerIds = []) {
  const r = await load(ctx, id);
  if (!r.ok) return r;
  const v = await lineData(ctx, id, kind, input, passengerIds);
  if (!v.ok) return v;
  const { data, passengerIds: ids } = v.value;
  const lineId = await repo.insertLine(ctx.db, id, data, ctx.user?.id ?? null);
  await ctx.db.batch([
    ...repo.linkPassengersStmts(ctx.db, lineId, ids),
    repo.touchStmt(ctx.db, id, nowIso()),
    log(ctx, id, 'servicio', `Añadido: ${lineTitle(data)} · PVP ${eur(data.pvp)}`),
  ]);
  return done({ id: lineId });
}

/**
 * Cambiar un servicio (sus datos, sus pasajeros o sus importes)
 * @param {Context} ctx
 * @param {number} id
 * @param {number} lineId
 * @param {Record<string, any>} input
 * @param {unknown[]} passengerIds
 */
export async function updateLine(ctx, id, lineId, input, passengerIds = []) {
  const r = await load(ctx, id);
  if (!r.ok) return r;
  const before = await repo.line(ctx.db, id, lineId);
  if (!before) return notFound();
  const v = await lineData(ctx, id, before.kind, input, passengerIds, before);
  if (!v.ok) return v;
  const { data, passengerIds: ids } = v.value;
  const what = data.pvp !== before.pvp_cents ? ` · PVP ${eur(before.pvp_cents)} → ${eur(data.pvp)}` : '';
  await ctx.db.batch([
    repo.updateLineStmt(ctx.db, lineId, data, nowIso()),
    ...repo.linkPassengersStmts(ctx.db, lineId, ids),
    repo.touchStmt(ctx.db, id, nowIso()),
    log(ctx, id, 'servicio', `Cambiado: ${lineTitle(data)}${what}`),
  ]);
  return done({ id: lineId });
}

/** @param {Context} ctx @param {number} id @param {number} lineId */
export async function removeLine(ctx, id, lineId) {
  const r = await load(ctx, id);
  if (!r.ok) return r;
  const l = await repo.line(ctx.db, id, lineId);
  if (!l) return notFound();
  await ctx.db.batch([
    repo.deleteLineStmt(ctx.db, lineId),
    repo.touchStmt(ctx.db, id, nowIso()),
    log(ctx, id, 'servicio', `Quitado: ${lineTitle({ kind: l.kind, supplier: l.supplier ? { name: l.supplier } : null, description: l.description })} · PVP ${eur(l.pvp_cents)}`),
  ]);
  return done({ id: lineId });
}
