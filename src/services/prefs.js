// @ts-check
// Preferencias de cada persona: qué columnas ve en cada tabla, cuántas filas por página y, en las que se pueden
// ver de dos formas (Business Travel), si como tarjetas o como tabla. Se guardan en la base de
// datos (se mantienen al cerrar sesión y en cualquier dispositivo). Sólo se guardan columnas que existen y que esa
// persona puede ver (una columna con importes no aparece sin su permiso aunque se mande a mano).
import * as repo from '../repos/prefs.js';
import { can } from '../lib/app.js';
import { TABLES } from '../lib/tables.js';
import { cleanColumns, PER_PAGE } from '../lib/table.js';
import { done, fail, forbidden } from './result.js';

/** @typedef {import('./types').Context} Context */

/**
 * Lo guardado para una tabla ({ columns, per, view }) o null (lo de por defecto)
 * @param {Context} ctx
 * @param {string} table
 * @returns {Promise<{ columns?: string[], per?: number, view?: string } | null>}
 */
export async function forTable(ctx, table) {
  if (!ctx.user || !Object.hasOwn(TABLES, table)) return null;
  return repo.get(ctx.db, ctx.user.id, `tabla:${table}`);
}

/**
 * Guardar las columnas elegidas y las filas por página de una tabla (reset: volver a lo de por defecto; la vista
 * elegida se conserva). Si sólo llega view (tarjetas o tabla), se cambia la vista y se conserva lo demás.
 * @param {Context} ctx
 * @param {string} table
 * @param {{ columns?: unknown[], per?: unknown, reset?: boolean, view?: unknown }} input
 */
export async function saveTable(ctx, table, { columns = [], per = null, reset = false, view = undefined }) {
  if (!ctx.user) return forbidden();
  const def = /** @type {Record<string, any>} */ (TABLES)[table];
  if (!def) return fail('invalid', 'Tabla desconocida.');
  const key = `tabla:${table}`;
  const saved = await repo.get(ctx.db, ctx.user.id, key);
  const keepView = saved?.view ? { view: saved.view } : {};
  if (view !== undefined) {
    if (!(def.views ?? []).includes(view)) return fail('invalid', 'Esa vista no existe.');
    const value = { ...(saved ?? {}), view: String(view) };
    await repo.setStmt(ctx.db, ctx.user.id, key, value).run();
    return done(value);
  }
  if (reset) {
    await (saved?.view ? repo.setStmt(ctx.db, ctx.user.id, key, keepView) : repo.deleteStmt(ctx.db, ctx.user.id, key)).run();
    return done({ columns: null, per: null, ...keepView });
  }
  const user = ctx.user;
  const value = { columns: cleanColumns(def, columns, (p) => can(user, p)), per: PER_PAGE.includes(Number(per)) ? Number(per) : null, ...keepView };
  await repo.setStmt(ctx.db, ctx.user.id, key, value).run();
  return done(value);
}
