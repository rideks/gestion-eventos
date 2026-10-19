// @ts-check
// Servicio de clientes: ver el directorio y la ficha, dar de alta, editar (las condiciones quedan en el
// historial), fusionar, borrar, entidades de facturación y elegir el cliente de una solicitud.
// Permisos: «clientes» para ver; «clientes.create» para dar de alta; «clientes.edit» para cambiar;
// «clientes.economia» para los datos fiscales, el fee, el acuerdo de pago y lo presupuestado; y además
// «cobros» para lo facturado y lo cobrado. Al leer, sólo se devuelve lo que el usuario puede ver.
import * as repo from '../repos/clients.js';
import * as changes from '../repos/changes.js';
import { can, activityStmt } from '../lib/app.js';
import { cleanName } from '../lib/suppliers.js';
import { similarNames } from '../lib/name-match.js';
import { clientVolume, seniority, feeLabel } from '../lib/clients.js';
import { diffFields } from '../lib/changes.js';
import { ClientSchema, ClientQuickSchema, ClientEntitySchema, CLIENT_STATUS, CLIENT_KINDS, validate } from '../lib/validate.js';
import { done, fail, forbidden, notFound, invalid } from './result.js';

/** @typedef {import('./types').Context} Context */

const ECONOMY_FIELDS = ['legal_name', 'tax_id', 'fiscal_address', 'billing_email', 'payment_terms', 'fee_bp'];
const BUDGET_FIELDS = ['budget', 'this_year', 'budget_base', 'fee_bp'];
const BILLING_FIELDS = ['invoiced', 'pending', 'invoiced_base', 'collected_total', 'pending_total'];
const strip = (row, fields) => Object.fromEntries(Object.entries(row).filter(([k]) => !fields.includes(k)));
const orList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} o ${items.at(-1)}` : items[0]);

/** Qué parte económica puede ver: el presupuesto y las condiciones; y lo facturado y cobrado */
const sees = (ctx) => {
  const economy = can(ctx.user, 'clientes.economia');
  return { economy, billing: economy && can(ctx.user, 'cobros') };
};
const hide = (ctx) => {
  const { economy, billing } = sees(ctx);
  return [...(economy ? [] : [...ECONOMY_FIELDS, ...BUDGET_FIELDS]), ...(billing ? [] : BILLING_FIELDS)];
};

// Campos de las condiciones y los datos fiscales que se apuntan en el historial
const CONDITION_FIELDS = {
  fee_bp: { label: 'Fee', format: (v) => feeLabel(v) },
  payment_terms: { label: 'Acuerdo de pago', show: false },
};
const DATA_FIELDS = {
  name: { label: 'Nombre' },
  kind: { label: 'Tipo', format: (v) => CLIENT_KINDS[v] ?? v },
  title: { label: 'Tratamiento' },
  status: { label: 'Estado', format: (v) => CLIENT_STATUS[v] ?? v },
  legal_name: { label: 'Nombre fiscal' },
  tax_id: { label: 'NIF' },
  fiscal_address: { label: 'Dirección fiscal', show: false },
  billing_email: { label: 'Email de facturación' },
};

// ── Consultas ──────────────────────────────────────────────────────────────

/**
 * Directorio con filtros y orden. Sin los permisos económicos no llegan importes ni fee (ni se ordena por ellos).
 * @param {Context} ctx
 * @param {{ q?: string, status?: string, order?: string }} [filters]
 */
export async function directory(ctx, { q = '', status = '', order = 'name' } = {}) {
  if (!can(ctx.user, 'clientes')) return forbidden();
  const { economy, billing } = sees(ctx);
  const year = Number(ctx.now.slice(0, 4));
  const orders = { name: 'Nombre', proximo: 'Próximo evento', uso: 'Último evento', expedientes: 'Más expedientes', altas: 'Altas recientes', ...(economy ? { volumen: 'Presupuestado en total', year: `Presupuestado en ${year}` } : {}) };
  const ord = Object.hasOwn(orders, order) ? order : 'name';
  const st = Object.hasOwn(CLIENT_STATUS, status) ? status : '';
  const rows = await repo.list(ctx.db, { q: q.trim().slice(0, 80), status: st, order: ord, year, now: ctx.now });
  const hidden = hide(ctx);
  return done({ rows: rows.map((r) => strip(r, hidden)), orders, order: ord, status: st, year, economy, billing });
}

/**
 * Ficha: datos, contactos de sus expedientes, expedientes (previstos, en curso, terminados), volumen,
 * ciudades, proveedores y hoteles con los que se ha trabajado para él, entidades e historial de condiciones.
 * @param {Context} ctx
 * @param {number} id
 */
export async function ficha(ctx, id) {
  if (!can(ctx.user, 'clientes')) return forbidden();
  const f = await repo.ficha(ctx.db, id);
  if (!f) return notFound();
  const { economy, billing } = sees(ctx);
  const editable = can(ctx.user, 'clientes.edit');
  const supplierMoney = can(ctx.user, 'proveedores.gasto');
  const hidden = hide(ctx);
  const vol = clientVolume(f.expedientes, Number(ctx.now.slice(0, 4)), ctx.now);
  // Personas de contacto que aparecen en sus expedientes (la más reciente primero, sin repetir)
  const seen = new Set();
  const contacts = f.expedientes.filter((e) => e.contact_name && !seen.has(e.contact_name.toLowerCase()) && seen.add(e.contact_name.toLowerCase()))
    .map((e) => ({ name: e.contact_name, email: e.contact_email, phone: e.contact_phone, last: e.start_date }));
  const [history, others] = await Promise.all([
    economy ? changes.forEntity(ctx.db, 'client', id) : [],
    editable ? repo.others(ctx.db, id) : [],
  ]);
  const volume = {
    exps: vol.exps, stages: vol.stages, first: vol.first, last: vol.last, byCity: vol.byCity.map((c) => ({ key: c.key, exps: c.exps, ...(economy ? { budget: c.budget } : {}) })),
    ...(economy ? { budget: vol.budget, thisYear: vol.thisYear, average: vol.average, averageFeeBp: vol.averageFeeBp, byYear: vol.byYear.map((y) => (billing ? y : strip(y, ['invoiced']))) } : {}),
    ...(billing ? { invoiced: vol.invoiced, collected: vol.collected, pending: vol.pending } : {}),
  };
  return done({
    client: strip(f.client, hidden),
    aliases: f.aliases,
    entities: economy ? f.entities : [],
    expedientes: f.expedientes.map((e) => strip(e, hidden)),
    suppliers: supplierMoney ? f.suppliers : f.suppliers.map((s) => strip(s, ['contracted'])),
    contacts,
    seniority: seniority(f.client.since_on, vol.first, ctx.now),
    volume, history, economy, billing, editable, others,
  });
}

/**
 * Lo que necesita el selector de cliente de las solicitudes.
 * @param {Context} ctx
 */
export async function pickerData(ctx) {
  if (!can(ctx.user, 'expedientes') && !can(ctx.user, 'viajes')) return forbidden();
  return done({ options: await repo.options(ctx.db) });
}

/**
 * Buscador general.
 * @param {Context} ctx
 * @param {string} q
 */
export async function search(ctx, q) {
  if (!can(ctx.user, 'clientes')) return forbidden();
  return done(q.trim().length >= 2 ? await repo.search(ctx.db, q.trim().slice(0, 80)) : []);
}

/**
 * Cliente elegido en una solicitud o al editar un expediente. Nunca se crea aquí: se elige de la lista
 * (el selector manda su id) o, sin JavaScript, por su nombre exacto o uno anterior. Devuelve también su
 * fee vigente (el que se copia al expediente nuevo).
 * @param {Context} ctx
 * @param {{ id?: unknown, name?: unknown }} pick
 */
export async function resolveForExpediente(ctx, pick) {
  if (!can(ctx.user, 'expedientes')) return forbidden();
  return resolvePick(ctx, pick);
}

/**
 * Cliente elegido en una reserva de Business Travel: igual que en una solicitud (de la lista; nunca se crea aquí).
 * @param {Context} ctx
 * @param {{ id?: unknown, name?: unknown }} pick
 */
export async function resolveForBooking(ctx, pick) {
  if (!can(ctx.user, 'viajes')) return forbidden();
  return resolvePick(ctx, pick, 'client');
}

/** field: el campo del formulario en el que se enseña el error @param {Context} ctx @param {{ id?: unknown, name?: unknown }} pick */
async function resolvePick(ctx, pick, field = 'company') {
  const name = cleanName(pick?.name);
  const n = Number(pick?.id);
  const c = await repo.resolve(ctx.db, Number.isInteger(n) && n > 0 ? n : null, name);
  if (c) return done(c);
  if (!name) {
    const message = field === 'company' ? 'Empresa (cliente): elígela de la lista' : 'Cliente: elígelo de la lista';
    return fail('invalid', message, { fields: { [field]: message } });
  }
  const similar = similarNames(name, await repo.options(ctx.db), 3);
  const hint = similar.length ? ` ¿Es ${orList(similar.map((x) => `«${x.name}»`))}?` : '';
  const message = `Cliente: «${name}» no está dado de alta.${hint} Elígelo de la lista o, si es nuevo, dalo de alta.`;
  return fail('invalid', message, { fields: { [field]: message } });
}

// ── Cambios ────────────────────────────────────────────────────────────────

/**
 * Alta de un cliente. Antes se comprueba que el nombre no exista y, si no se ha confirmado, que no
 * haya otro con un nombre parecido (→ code 'similar').
 *   quick: alta rápida desde el selector de una solicitud (nombre y ciudad); se confirma con confirm=1.
 *   Si no: el formulario del directorio; se confirma con confirm_similar = el mismo nombre.
 * Sin permiso económico, el fee y los datos fiscales que lleguen no se guardan.
 * @param {Context} ctx
 * @param {Record<string, any>} input
 * @param {{ quick?: boolean }} [options]
 */
export async function create(ctx, input, { quick = false } = {}) {
  if (!can(ctx.user, 'clientes.create')) return forbidden();
  const parsed = validate(quick ? ClientQuickSchema : ClientSchema, { ...input, name: cleanName(input.name), status: input.status ?? 'activo' });
  if (!parsed.ok) return invalid(parsed);
  const d = { ...parsed.data, fee_bp: parsed.data.fee ?? null };
  if (!sees(ctx).economy) for (const f of ECONOMY_FIELDS) d[f] = null;
  const confirmed = quick ? input.confirm === '1' : input.confirm_similar === d.name;
  const taken = await repo.nameTaken(ctx.db, d.name);
  if (taken) return fail('conflict', `Ya existe: ${taken}. Búscalo en la lista.`, { fields: { name: `Ya existe: ${taken}. Búscalo en la lista.` }, taken });
  if (!confirmed) {
    const similar = similarNames(d.name, await repo.options(ctx.db));
    if (similar.length) return fail('similar', 'Ya hay clientes con un nombre parecido: comprueba que no es ninguno de ellos.', { similar });
  }
  const client = await repo.insert(ctx.db, d, ctx.user?.id ?? null);
  if (!client) return fail('conflict', `Ya existe: ${d.name}. Búscalo en la lista.`, { fields: { name: `Ya existe: ${d.name}.` }, taken: d.name });
  await ctx.db.batch([
    changes.changeStmt(ctx.db, 'client', client.id, ctx.user?.id ?? null, 'alta', `Alta del cliente${d.fee_bp !== null ? ` · fee ${feeLabel(d.fee_bp)}` : ''}`),
    activityStmt(ctx.db, ctx.actor, null, 'client.create', `dio de alta al cliente ${client.name}`),
  ]);
  return done({ ...client, aliases: [] });
}

/**
 * Editar la ficha. Si cambia el nombre, el anterior queda como nombre anterior y los expedientes muestran
 * el nuevo. Los cambios de condiciones (fee, acuerdo de pago) y de datos fiscales quedan en el historial;
 * el fee de los expedientes ya pedidos NO cambia (cada uno conserva el que se le aplicó).
 * Sin permiso económico, esos campos no se ven en el formulario: se conservan.
 * @param {Context} ctx
 * @param {number} id
 * @param {Record<string, any>} input
 */
export async function update(ctx, id, input) {
  if (!can(ctx.user, 'clientes.edit')) return forbidden();
  const f = await repo.ficha(ctx.db, id);
  if (!f) return notFound();
  const c = f.client;
  const parsed = validate(ClientSchema, { ...input, name: cleanName(input.name) });
  if (!parsed.ok) return invalid(parsed);
  const d = { ...parsed.data, fee_bp: parsed.data.fee ?? null };
  if (!sees(ctx).economy) for (const k of ECONOMY_FIELDS) d[k] = c[k];
  const taken = await repo.nameTaken(ctx.db, d.name, id);
  if (taken) {
    const message = `Ese nombre ya lo usa ${taken}. Si es el mismo cliente, fusiónalos.`;
    return fail('conflict', message, { fields: { name: message } });
  }
  const cond = diffFields(c, d, CONDITION_FIELDS);
  const data = diffFields(c, d, DATA_FIELDS);
  const userId = ctx.user?.id ?? null;
  await ctx.db.batch([
    repo.updateStmt(ctx.db, id, d),
    ...repo.renameStmts(ctx.db, id, c.name, d.name),
    ...(cond.summary ? [changes.changeStmt(ctx.db, 'client', id, userId, 'condiciones', cond.summary, cond.changes)] : []),
    ...(data.summary ? [changes.changeStmt(ctx.db, 'client', id, userId, 'datos', data.summary, data.changes)] : []),
    activityStmt(ctx.db, ctx.actor, null, 'client.update', d.name !== c.name ? `renombró al cliente ${c.name}: ahora ${d.name}` : `editó la ficha del cliente ${d.name}${cond.summary ? ` (${cond.summary})` : ''}`),
  ]);
  return done({ id, name: d.name, conditions: cond.summary });
}

/**
 * Fusionar un cliente repetido en otro: expedientes, entidades, nombres e historial pasan al bueno.
 * @param {Context} ctx
 * @param {number} id
 * @param {number | null} intoId
 */
export async function merge(ctx, id, intoId) {
  if (!can(ctx.user, 'clientes.edit')) return forbidden();
  const [from, into] = await Promise.all([repo.byId(ctx.db, id), intoId ? repo.byId(ctx.db, intoId) : null]);
  if (!from) return notFound();
  if (!into || into.id === id) return fail('invalid', 'Elige el cliente con el que fusionarlo.', { fields: { into: 'Elige el cliente con el que fusionarlo.' } });
  await ctx.db.batch([
    changes.moveStmt(ctx.db, 'client', from.id, into.id),
    ...repo.mergeStmts(ctx.db, from, into),
    changes.changeStmt(ctx.db, 'client', into.id, ctx.user?.id ?? null, 'fusion', `Fusionado con «${from.name}» (sus expedientes pasan a esta ficha)`),
    activityStmt(ctx.db, ctx.actor, null, 'client.merge', `fusionó al cliente ${from.name} con ${into.name}`),
  ]);
  return done({ from, into });
}

/**
 * Borrar un cliente: sólo si no tiene expedientes (si está repetido, se fusiona).
 * @param {Context} ctx
 * @param {number} id
 */
export async function remove(ctx, id) {
  if (!can(ctx.user, 'clientes.edit')) return forbidden();
  const c = await repo.byId(ctx.db, id);
  if (!c) return notFound();
  if (await repo.expedienteCount(ctx.db, id)) return fail('conflict', 'Tiene expedientes: no se puede borrar. Si está repetido, fusiónalo con el bueno; si ya no se trabaja con él, márcalo como inactivo.');
  await ctx.db.batch([repo.deleteStmt(ctx.db, id), activityStmt(ctx.db, ctx.actor, null, 'client.delete', `borró al cliente ${c.name}`)]);
  return done({ id });
}

/** Cambiar entidades necesita editar y ver los datos fiscales @param {Context} ctx @param {number} clientId */
async function entityAccess(ctx, clientId) {
  if (!can(ctx.user, 'clientes.edit') || !can(ctx.user, 'clientes.economia')) return forbidden();
  const c = await repo.byId(ctx.db, clientId);
  return c ? done(c) : notFound();
}

/**
 * Otra entidad a la que se factura (p. ej. un concesionario).
 * @param {Context} ctx
 * @param {number} clientId
 * @param {Record<string, any>} input
 */
export async function addEntity(ctx, clientId, input) {
  const r = await entityAccess(ctx, clientId);
  if (!r.ok) return r;
  const parsed = validate(ClientEntitySchema, input);
  if (!parsed.ok) return invalid(parsed);
  const row = await repo.insertEntity(ctx.db, clientId, parsed.data);
  if (!row) return fail('conflict', `Ya hay una entidad con el NIF ${parsed.data.tax_id}.`, { fields: { tax_id: `Ya hay una entidad con el NIF ${parsed.data.tax_id}.` } });
  await changes.changeStmt(ctx.db, 'client', clientId, ctx.user?.id ?? null, 'entidad', `Entidad de facturación nueva: ${parsed.data.legal_name}${parsed.data.tax_id ? ` (${parsed.data.tax_id})` : ''}`).run();
  return done({ id: row.id });
}

/**
 * @param {Context} ctx
 * @param {number} clientId
 * @param {number} entityId
 * @param {Record<string, any>} input
 */
export async function updateEntity(ctx, clientId, entityId, input) {
  const r = await entityAccess(ctx, clientId);
  if (!r.ok) return r;
  const before = await repo.entity(ctx.db, clientId, entityId);
  if (!before) return notFound();
  const parsed = validate(ClientEntitySchema, input);
  if (!parsed.ok) return invalid(parsed);
  if (await repo.entityTaxTaken(ctx.db, clientId, parsed.data.tax_id, entityId)) {
    return fail('conflict', `Ya hay una entidad con el NIF ${parsed.data.tax_id}.`, { fields: { tax_id: `Ya hay una entidad con el NIF ${parsed.data.tax_id}.` } });
  }
  const diff = diffFields(before, parsed.data, { legal_name: { label: 'Nombre fiscal' }, tax_id: { label: 'NIF' }, fiscal_address: { label: 'Dirección', show: false }, email: { label: 'Email' } });
  if (!diff.summary) return done({ id: entityId, changed: false });
  await ctx.db.batch([
    repo.updateEntityStmt(ctx.db, entityId, parsed.data),
    changes.changeStmt(ctx.db, 'client', clientId, ctx.user?.id ?? null, 'entidad', `Entidad ${before.legal_name}: ${diff.summary}`, diff.changes),
  ]);
  return done({ id: entityId, changed: true });
}

/**
 * @param {Context} ctx
 * @param {number} clientId
 * @param {number} entityId
 */
export async function removeEntity(ctx, clientId, entityId) {
  const r = await entityAccess(ctx, clientId);
  if (!r.ok) return r;
  const e = await repo.entity(ctx.db, clientId, entityId);
  if (!e) return notFound();
  await ctx.db.batch([
    repo.deleteEntityStmt(ctx.db, entityId),
    changes.changeStmt(ctx.db, 'client', clientId, ctx.user?.id ?? null, 'entidad', `Entidad de facturación quitada: ${e.legal_name}${e.tax_id ? ` (${e.tax_id})` : ''}`),
  ]);
  return done({ id: entityId });
}
