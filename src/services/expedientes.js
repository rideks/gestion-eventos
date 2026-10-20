// @ts-check
// Servicio de expedientes: la lista (pestañas, buscador, filtros, orden y páginas). La ficha, el cierre y los cobros
// siguen en sus páginas (src/lib/data.js) hasta pasarlos también a capas.
// Permisos: «expedientes» para verla. Lo facturado y lo pendiente de cobro, sólo con «cobros» (el servicio no lo
// devuelve si no); de un expediente cerrado se ve su venta y su beneficio, como en el Cierre.
import * as repo from '../repos/expedientes.js';
import { can } from '../lib/app.js';
import { TABLES } from '../lib/tables.js';
import { allowedColumns } from '../lib/table.js';
import { EXP_TABS } from '../lib/expedientes.js';
import { expedienteState } from '../lib/finance.js';
import { done, forbidden } from './result.js';

/** @typedef {import('./types').Context} Context */

/**
 * Expedientes por páginas para la lista: la página, cuántos hay en cada pestaña, las sumas de la pestaña y las
 * opciones de los filtros (clientes y responsables). order: una columna que se pueda ordenar y que pueda ver.
 * @param {Context} ctx
 * @param {{ q?: string, view?: string, clientId?: number | null, managerId?: number | null, month?: string,
 *           order?: string, dir?: string | null, limit?: number, offset?: number }} [options]
 */
export async function list(ctx, { q = '', view = 'curso', clientId = null, managerId = null, month = '', order = 'fechas', dir = null, limit = 25, offset = 0 } = {}) {
  if (!can(ctx.user, 'expedientes')) return forbidden();
  const user = ctx.user;
  const cobros = can(user, 'cobros');
  const sortable = allowedColumns(TABLES.expedientes, (p) => can(user, p)).filter((c) => c.sort);
  const col = sortable.find((c) => c.key === order) ?? sortable.find((c) => c.key === TABLES.expedientes.sort) ?? sortable[0];
  const d = dir === 'asc' || dir === 'desc' ? dir : col.sort;
  const tab = Object.hasOwn(EXP_TABS, view) ? view : 'curso';
  const mo = /^\d{4}-\d{2}$/.test(month) ? month : '';
  const id = (/** @type {unknown} */ n) => (Number.isInteger(n) ? /** @type {number} */ (n) : null);
  const [res, clients, managers] = await Promise.all([
    repo.list(ctx.db, {
      q: q.trim().slice(0, 80), view: tab, today: ctx.now, userId: user?.id ?? null, month: mo, clientId: id(clientId), managerId: id(managerId),
      sort: col.key, dir: d, limit: Math.min(Math.max(1, limit), 100), offset: Math.max(0, offset),
    }),
    repo.clientsWithExpedientes(ctx.db),
    repo.managers(ctx.db),
  ]);
  // Sin «cobros»: ni lo pendiente de cobro ni lo facturado (salvo la venta de los cerrados, que sale en su Cierre)
  const rows = res.rows.map((r) => ({
    ...r,
    ...(cobros ? {} : { to_collect: null, sales_base: r.status === 'cerrado' ? r.sales_base : null }),
    state: expedienteState(r, ctx.now),
  }));
  const sums = cobros ? res.sums : { ...res.sums, to_collect: null, sales_base: null };
  return done({ rows, total: res.total, counts: res.counts, sums, clients, managers, view: tab, month: mo, order: col.key, dir: d, cobros });
}
