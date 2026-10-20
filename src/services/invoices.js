// @ts-check
// Servicio de cobros (facturas al cliente de todos los expedientes): la bandeja como un embudo (1. por facturar →
// 2. por emitir → 3. por cobrar), las facturas pendientes y las cobradas en tabla (por páginas) y cobrar una factura.
// Emitir, enviar y anular siguen en la ficha de la factura (src/lib/invoicing.js) hasta pasarlos también a capas.
// Permisos: «cobros» para ver la bandeja; «invoice.issue» para registrar un cobro.
import * as repo from '../repos/invoices.js';
import { can, activityStmt } from '../lib/app.js';
import { isLocked, LOCKED_MSG } from '../lib/actions.js';
import { CollectSchema, validate } from '../lib/validate.js';
import { billingStatus } from '../lib/finance.js';
import { TABLES } from '../lib/tables.js';
import { allowedColumns } from '../lib/table.js';
import { eur } from '../lib/money.js';
import { nowIso } from '../lib/dates.js';
import { done, fail, forbidden, invalid } from './result.js';

/** @typedef {import('./types').Context} Context */

const STATES = ['por_emitir', 'emitida', 'vencida'];

/** La columna de orden (una que se pueda ordenar y ver) y su sentido @param {Context} ctx @param {'cobros' | 'cobradas'} table @param {string} order @param {string | null} dir */
function sortOf(ctx, table, order, dir) {
  const sortable = allowedColumns(TABLES[table], (p) => can(ctx.user, p)).filter((c) => c.sort);
  const col = sortable.find((c) => c.key === order) ?? sortable.find((c) => c.key === TABLES[table].sort) ?? sortable[0];
  return { sort: col.key, dir: /** @type {'asc' | 'desc'} */ (dir === 'asc' || dir === 'desc' ? dir : col.sort) };
}

/**
 * 1. Por facturar: cada expediente en marcha con lo que le falta según su presupuesto VIGENTE (y sus PO con saldo,
 * para facturarlas directamente). También los que piden revisar algo: facturado de más o PO por encima del presupuesto.
 * @param {Context} ctx
 * @param {string} [q]
 */
export async function toBill(ctx, q = '') {
  if (!can(ctx.user, 'cobros')) return forbidden();
  const term = q.trim().slice(0, 80);
  const [expedientes, pos] = await Promise.all([repo.toInvoiceByExpediente(ctx.db, term), repo.posWithBalance(ctx.db)]);
  /** @type {Map<number, any[]>} */
  const posOf = new Map();
  for (const po of pos) posOf.set(po.expediente_id, [...(posOf.get(po.expediente_id) ?? []), po]);
  const rows = expedientes
    .map((/** @type {any} */ e) => {
      const its = posOf.get(e.id) ?? [];
      const poLeft = its.reduce((a, po) => a + po.left_cents, 0);
      return { ...e, pos: its, poLeft, ...billingStatus(e, poLeft) };
    })
    .filter((e) => e.left > 0 || e.overInvoiced > 0 || e.poExcess > 0);
  return done(rows);
}

/**
 * Facturas por emitir y por cobrar, por páginas (con un límite grande, todas para el embudo en tarjetas).
 * state: por_emitir, emitida (sin vencer) o vencida. Devuelve la página, el total y la suma, y cada estado.
 * @param {Context} ctx
 * @param {{ q?: string, state?: string, order?: string, dir?: string | null, limit?: number, offset?: number }} [o]
 */
export async function openTable(ctx, { q = '', state = '', order = 'estado', dir = null, limit = 25, offset = 0 } = {}) {
  if (!can(ctx.user, 'cobros')) return forbidden();
  const s = sortOf(ctx, 'cobros', order, dir);
  const res = await repo.openTable(ctx.db, {
    q: q.trim().slice(0, 80), state: STATES.includes(state) ? state : '', today: ctx.now, ...s,
    limit: Math.min(Math.max(1, limit), 1000), offset: Math.max(0, offset),
  });
  return done({ ...res, order: s.sort, dir: s.dir });
}

/**
 * Facturas cobradas, por páginas (con un límite, las últimas para las tarjetas por meses). month: 'YYYY-MM'
 * @param {Context} ctx
 * @param {{ q?: string, month?: string, order?: string, dir?: string | null, limit?: number, offset?: number }} [o]
 */
export async function collectedTable(ctx, { q = '', month = '', order = 'cobrada', dir = null, limit = 25, offset = 0 } = {}) {
  if (!can(ctx.user, 'cobros')) return forbidden();
  const s = sortOf(ctx, 'cobradas', order, dir);
  const res = await repo.collectedTable(ctx.db, {
    q: q.trim().slice(0, 80), month: /^\d{4}-\d{2}$/.test(month) ? month : '', ...s,
    limit: Math.min(Math.max(1, limit), 1000), offset: Math.max(0, offset),
  });
  return done({ ...res, order: s.sort, dir: s.dir });
}

/**
 * Registrar el cobro de una factura emitida (desde la bandeja, el expediente, su ficha o el inicio).
 * expedienteId: si se cobra desde un expediente, la factura tiene que ser de ese expediente.
 * @param {Context} ctx
 * @param {Record<string, any>} input invoice_id, collected_on
 * @param {{ expedienteId?: number | null }} [options]
 */
export async function collect(ctx, input, { expedienteId = null } = {}) {
  if (!can(ctx.user, 'invoice.issue')) return forbidden('No tienes permiso para registrar cobros.');
  const parsed = validate(CollectSchema, input);
  if (!parsed.ok) return invalid(parsed);
  const id = Number(input.invoice_id);
  const inv = Number.isInteger(id) ? await repo.forCollect(ctx.db, id) : null;
  // Desde una lista: si mientras tanto la han borrado o es de otro expediente, se avisa
  if (!inv || (expedienteId && inv.expediente_id !== expedienteId)) return fail('invalid', 'Esa factura ya no existe.');
  if (isLocked({ status: inv.exp_status })) return fail('conflict', LOCKED_MSG);
  if (inv.status !== 'emitida') return fail('conflict', 'Sólo se puede cobrar una factura emitida.');
  await ctx.db.batch([
    repo.collectStmt(ctx.db, id, parsed.data.collected_on, nowIso()),
    activityStmt(ctx.db, ctx.actor, inv.expediente_id, 'invoice.collected', `registró el cobro de la factura ${inv.number} de ${inv.billed_to} (${eur(inv.total_cents)})`),
  ]);
  return done({ expedienteId: inv.expediente_id });
}
