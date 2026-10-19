// @ts-check
// Servicio de proveedores: los casos de uso (ver el directorio y la ficha, dar de alta, editar, fusionar,
// borrar, tipos, elegir el proveedor de un pago). Cada uno:
//   1. comprueba el permiso (aunque la página ya lo haga: si se llama desde otro sitio, sigue protegido);
//   2. valida lo que llega del formulario;
//   3. lee y escribe sólo a través del repositorio (src/repos/suppliers.js), en un batch si son varios cambios;
//   4. apunta la actividad;
//   5. devuelve un resultado (src/services/result.js) y, al leer, sólo los datos que el usuario puede ver
//      (sin importes ni condiciones económicas si no tiene permiso de gasto).
import * as repo from '../repos/suppliers.js';
import { can, activityStmt } from '../lib/app.js';
import { cleanName, businessVolume } from '../lib/suppliers.js';
import { similarSuppliers } from '../lib/supplier-match.js';
import { SupplierSchema, SupplierQuickSchema, SupplierTypeSchema, SUPPLIER_STATUS, validate } from '../lib/validate.js';
import { done, fail, forbidden, notFound, invalid } from './result.js';

/** @typedef {import('./types').Context} Context */

const MONEY_FIELDS = ['contracted', 'this_year', 'invoiced', 'paid', 'pending', 'credits'];
const strip = (row, fields) => Object.fromEntries(Object.entries(row).filter(([k]) => !fields.includes(k)));
const orList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} o ${items.at(-1)}` : items[0]);

// ── Consultas ──────────────────────────────────────────────────────────────

/**
 * Directorio con filtros y orden. Sin permiso de gasto, sin importes (ni ordenar por ellos).
 * @param {Context} ctx
 * @param {{ q?: string, typeId?: number|null, status?: string, order?: string }} filters
 */
export async function directory(ctx, { q = '', typeId = null, status = '', order = 'name' } = {}) {
  if (!can(ctx.user, 'proveedores')) return forbidden();
  const money = can(ctx.user, 'proveedores.gasto');
  const year = Number(ctx.now.slice(0, 4));
  const orders = { name: 'Nombre', uso: 'Último evento', expedientes: 'Más expedientes', altas: 'Altas recientes', ...(money ? { year: `Contratado en ${year}`, gasto: 'Contratado en total' } : {}) };
  const ord = Object.hasOwn(orders, order) ? order : 'name';
  const st = Object.hasOwn(SUPPLIER_STATUS, status) ? status : '';
  const [rows, types] = await Promise.all([repo.list(ctx.db, { q: q.trim().slice(0, 80), typeId, status: st, year, order: ord }), repo.types(ctx.db)]);
  return done({ rows: money ? rows : rows.map((r) => strip(r, MONEY_FIELDS)), types, orders, order: ord, status: st, year, money });
}

/**
 * Ficha de un proveedor: sus datos, nombres anteriores, expedientes y volumen de negocio.
 * Sin permiso de gasto: sin condiciones económicas ni importes (el volumen se queda en nº de expedientes y fechas).
 * Con permiso de edición: además, los tipos y los demás proveedores (para fusionar).
 * @param {Context} ctx
 * @param {number} id
 */
export async function ficha(ctx, id) {
  if (!can(ctx.user, 'proveedores')) return forbidden();
  const f = await repo.ficha(ctx.db, id);
  if (!f) return notFound();
  const money = can(ctx.user, 'proveedores.gasto');
  const editable = can(ctx.user, 'proveedores.edit');
  const vol = businessVolume(f.expedientes, Number(ctx.now.slice(0, 4)));
  const [types, others] = editable ? await Promise.all([repo.types(ctx.db), repo.others(ctx.db, id)]) : [[], []];
  return done({
    supplier: money ? f.supplier : strip(f.supplier, ['economic_terms', 'payment_terms']),
    aliases: f.aliases,
    expedientes: money ? f.expedientes : f.expedientes.map((r) => strip(r, MONEY_FIELDS)),
    volume: money ? vol : { exps: vol.exps, lines: vol.lines, first: vol.first, last: vol.last },
    money, editable, types, others,
  });
}

/**
 * Lo que necesita el selector de proveedor de los pagos: todos los proveedores (con nombres anteriores) y los tipos.
 * @param {Context} ctx
 */
export async function pickerData(ctx) {
  if (!can(ctx.user, 'expedientes')) return forbidden();
  const [options, types] = await Promise.all([repo.options(ctx.db), repo.types(ctx.db)]);
  return done({ options, types });
}

/**
 * Proveedor elegido en un pago. Nunca se crea aquí: se elige de la lista (el selector manda su id) y,
 * si es nuevo, se da de alta antes con `create` (que avisa de los parecidos).
 * Sin JavaScript vale el nombre exacto de la ficha o uno anterior (sin distinguir mayúsculas).
 * keepId: el proveedor que ya tenía el pago (se puede mantener aunque esté en «No contratar»).
 * @param {Context} ctx
 * @param {{ id?: unknown, name?: unknown }} pick
 * @param {{ keepId?: number|null }} [options]
 */
export async function resolveForPayment(ctx, pick, { keepId = null } = {}) {
  if (!can(ctx.user, 'expedientes')) return forbidden();
  const name = cleanName(pick?.name);
  const n = Number(pick?.id);
  const s = await repo.resolve(ctx.db, Number.isInteger(n) && n > 0 ? n : null, name);
  if (!s) {
    if (!name) return fail('invalid', 'Proveedor: elígelo de la lista', { fields: { supplier: 'Proveedor: elígelo de la lista' } });
    const similar = similarSuppliers(name, await repo.options(ctx.db), 3).filter((x) => x.status !== 'bloqueado');
    const hint = similar.length ? ` ¿Es ${orList(similar.map((x) => `«${x.name}»`))}?` : '';
    const message = `Proveedor: «${name}» no está dado de alta.${hint} Elígelo de la lista o, si es nuevo, dalo de alta.`;
    return fail('invalid', message, { fields: { supplier: message } });
  }
  if (s.status === 'bloqueado' && s.id !== keepId) {
    const message = `Proveedor: ${s.name} está marcado como «No contratar». Elige otro.`;
    return fail('invalid', message, { fields: { supplier: message } });
  }
  return done(s);
}

/**
 * Los proveedores de varias filas (pagos previstos): cada fila trae { supplier, supplier_id }.
 * value.of(fila) → { id, name }
 * @param {Context} ctx
 * @param {{ supplier: string, supplier_id?: number|null }[]} rows
 */
export async function resolveRowsForPayment(ctx, rows) {
  const key = (r) => `${r.supplier_id ?? ''}|${cleanName(r.supplier).toLowerCase()}`;
  const found = new Map();
  for (const [i, r] of rows.entries()) {
    if (found.has(key(r))) continue;
    const res = await resolveForPayment(ctx, { id: r.supplier_id, name: r.supplier });
    if (!res.ok) return fail(res.code, `Fila ${i + 1}: ${res.message}`);
    found.set(key(r), res.value);
  }
  return done({ of: (r) => found.get(key(r)) });
}

// ── Cambios ────────────────────────────────────────────────────────────────

/**
 * Alta de un proveedor. Antes se comprueba que el nombre no exista y, si no se ha confirmado, que no
 * haya otro con un nombre parecido (→ code 'similar' con la lista, para que la persona elija o confirme).
 *   quick: alta rápida desde el selector de un pago (nombre, tipo y ciudad); se confirma con confirm=1.
 *   Si no: el formulario completo del directorio; se confirma con confirm_similar = el mismo nombre.
 * @param {Context} ctx
 * @param {Record<string, any>} input
 * @param {{ quick?: boolean }} [options]
 */
export async function create(ctx, input, { quick = false } = {}) {
  if (!can(ctx.user, 'proveedores.create')) return forbidden();
  const parsed = validate(quick ? SupplierQuickSchema : SupplierSchema, { ...input, name: cleanName(input.name) });
  if (!parsed.ok) return invalid(parsed);
  const d = parsed.data;
  const confirmed = quick ? input.confirm === '1' : input.confirm_similar === d.name;
  const taken = await repo.nameTaken(ctx.db, d.name);
  if (taken) return fail('conflict', `Ya existe: ${taken}. Búscalo en la lista.`, { fields: { name: `Ya existe: ${taken}. Búscalo en la lista.` }, taken });
  if (!confirmed) {
    const similar = similarSuppliers(d.name, await repo.options(ctx.db));
    if (similar.length) return fail('similar', 'Ya hay proveedores con un nombre parecido: comprueba que no es ninguno de ellos.', { similar });
  }
  const supplier = await repo.insert(ctx.db, d, ctx.user?.id ?? null);
  // Otra persona lo ha dado de alta a la vez
  if (!supplier) return fail('conflict', `Ya existe: ${d.name}. Búscalo en la lista.`, { fields: { name: `Ya existe: ${d.name}.` }, taken: d.name });
  await activityStmt(ctx.db, ctx.actor, null, 'supplier.create', `dio de alta al proveedor ${supplier.name}`).run();
  return done({ ...supplier, aliases: [] });
}

/**
 * Editar la ficha. Si cambia el nombre, el anterior queda como alias y los pagos muestran el nuevo.
 * Sin permiso de gasto, las condiciones económicas no se ven en el formulario: se conservan.
 * @param {Context} ctx
 * @param {number} id
 * @param {Record<string, any>} input
 */
export async function update(ctx, id, input) {
  if (!can(ctx.user, 'proveedores.edit')) return forbidden();
  const f = await repo.ficha(ctx.db, id);
  if (!f) return notFound();
  const s = f.supplier;
  const parsed = validate(SupplierSchema, { ...input, name: cleanName(input.name) });
  if (!parsed.ok) return invalid(parsed);
  const d = parsed.data;
  const taken = await repo.nameTaken(ctx.db, d.name, id);
  if (taken) {
    const message = `Ese nombre ya lo usa ${taken}. Si es el mismo proveedor, fusiónalos.`;
    return fail('conflict', message, { fields: { name: message } });
  }
  if (!can(ctx.user, 'proveedores.gasto')) Object.assign(d, { economic_terms: s.economic_terms, payment_terms: s.payment_terms });
  await ctx.db.batch([
    repo.updateStmt(ctx.db, id, d),
    ...repo.renameStmts(ctx.db, id, s.name, d.name),
    activityStmt(ctx.db, ctx.actor, null, 'supplier.update', d.name !== s.name ? `renombró al proveedor ${s.name}: ahora ${d.name}` : `editó la ficha del proveedor ${d.name}`),
  ]);
  return done({ id, name: d.name });
}

/**
 * Fusionar un proveedor repetido en otro: pagos, documentos, contratos y nombres pasan al bueno.
 * @param {Context} ctx
 * @param {number} id
 * @param {number} intoId
 */
export async function merge(ctx, id, intoId) {
  if (!can(ctx.user, 'proveedores.edit')) return forbidden();
  const [from, into] = await Promise.all([repo.byId(ctx.db, id), repo.byId(ctx.db, intoId)]);
  if (!from) return notFound();
  if (!into || into.id === id) return fail('invalid', 'Elige el proveedor con el que fusionarlo.', { fields: { into: 'Elige el proveedor con el que fusionarlo.' } });
  await ctx.db.batch([
    ...repo.mergeStmts(ctx.db, from, into),
    activityStmt(ctx.db, ctx.actor, null, 'supplier.merge', `fusionó al proveedor ${from.name} con ${into.name}`),
  ]);
  return done({ from, into });
}

/**
 * Borrar un proveedor: sólo si no tiene pagos ni contratos (si está repetido, se fusiona).
 * @param {Context} ctx
 * @param {number} id
 */
export async function remove(ctx, id) {
  if (!can(ctx.user, 'proveedores.edit')) return forbidden();
  const s = await repo.byId(ctx.db, id);
  if (!s) return notFound();
  const use = await repo.usage(ctx.db, id);
  if (use.payments) return fail('conflict', 'Tiene pagos en expedientes: no se puede borrar. Si está repetido, fusiónalo con el bueno; si ya no se trabaja con él, márcalo como inactivo.');
  if (use.contracts) return fail('conflict', 'Tiene contratos: no se puede borrar. Si está repetido, fusiónalo con el bueno (los contratos pasan con él); si ya no se trabaja con él, márcalo como inactivo.');
  await ctx.db.batch([repo.deleteStmt(ctx.db, id), activityStmt(ctx.db, ctx.actor, null, 'supplier.delete', `borró al proveedor ${s.name}`)]);
  return done({ id });
}

/**
 * Tipo de proveedor nuevo.
 * @param {Context} ctx
 * @param {Record<string, any>} input
 */
export async function addType(ctx, input) {
  if (!can(ctx.user, 'proveedores.edit')) return forbidden();
  const parsed = validate(SupplierTypeSchema, { type_name: cleanName(input.type_name) });
  if (!parsed.ok) return invalid(parsed);
  const row = await repo.insertType(ctx.db, parsed.data.type_name);
  return row ? done({ id: row.id }) : fail('conflict', 'Ese tipo ya existe.');
}

/**
 * Quitar un tipo (sólo si ningún proveedor lo tiene).
 * @param {Context} ctx
 * @param {number} typeId
 */
export async function removeType(ctx, typeId) {
  if (!can(ctx.user, 'proveedores.edit')) return forbidden();
  return (await repo.deleteUnusedType(ctx.db, typeId))
    ? done({ id: typeId })
    : fail('conflict', 'Ese tipo lo tiene algún proveedor: cámbiales el tipo antes de quitarlo.');
}
