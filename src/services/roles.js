// @ts-check
// Servicio de roles y permisos (Usuarios y permisos · un rol). Permiso «users».
// Al guardar, sólo cambia lo que se ha cambiado en la pantalla (applyPermissionChanges): lo marcado se añade y lo
// desmarcado se quita, sobre lo que el rol tiene ahora en la base. Nada se quita a escondidas: si un permiso se queda
// sin el suyo de base, no se guarda y se explica. Siempre tiene que quedar alguien activo que gestione usuarios.
// Los cambios quedan en el registro de actividad. Valen al momento: los permisos se leen en cada petición.
import * as repo from '../repos/roles.js';
import { can, activityStmt } from '../lib/app.js';
import { applyPermissionChanges, managersAfter, permissionLabel } from '../lib/permissions.js';
import { RoleSchema, validate } from '../lib/validate.js';
import { done, fail, forbidden, notFound, invalid } from './result.js';

/** @typedef {import('./types').Context} Context */

export const LAST_MANAGER = 'Tiene que quedar al menos una persona activa que pueda gestionar usuarios y permisos.';

/** El rol (con sus permisos guardados) y todos los roles @param {Context} ctx @param {number} id */
async function load(ctx, id) {
  if (!can(ctx.user, 'users')) return forbidden();
  const roles = Number.isInteger(id) ? await repo.all(ctx.db) : [];
  const role = roles.find((r) => r.id === id);
  return role ? done({ role, roles }) : notFound();
}

/** Un rol: sus datos y permisos tal y como están guardados, y las personas que lo tienen @param {Context} ctx @param {number} id */
export async function detail(ctx, id) {
  const r = await load(ctx, id);
  if (!r.ok) return r;
  return done({ role: r.value.role, people: await repo.people(ctx.db, id) });
}

/**
 * Guardar el nombre, la descripción y los permisos de un rol.
 * @param {Context} ctx
 * @param {number} id
 * @param {Record<string, any>} input name, description
 * @param {{ wanted: string[], original?: string[] | null }} permissions lo marcado al guardar y lo que había al abrir la pantalla
 * @returns {Promise<import('./types').Result<{ changed: boolean, added: string[], removed: string[] }>>}
 */
export async function save(ctx, id, input, { wanted, original = null }) {
  const r = await load(ctx, id);
  if (!r.ok) return r;
  const { role, roles } = r.value;
  const parsed = validate(RoleSchema, input);
  if (!parsed.ok) return invalid(parsed);
  const d = parsed.data;
  if (roles.some((x) => x.id !== id && x.name.toLowerCase() === d.name.toLowerCase())) {
    return fail('invalid', 'Ya hay otro rol con ese nombre.', { fields: { name: 'Ya hay otro rol con ese nombre.' } });
  }
  const next = applyPermissionChanges({ current: role.permissions, wanted, original });
  if (next.missing.length) {
    const what = next.missing.map((m) => `«${permissionLabel(m.key)}» necesita «${permissionLabel(m.base)}»`).join('; ');
    return fail('invalid', `No se ha guardado: ${what}. Marca también el que necesita o desmárcalo.`);
  }
  if (next.removed.includes('users')) {
    const { users, managerRoles } = await repo.managers(ctx.db);
    if (managersAfter(users, managerRoles, { roleId: id, hasUsersPerm: false }) === 0) return fail('conflict', LAST_MANAGER);
  }
  const renamed = d.name !== role.name || (d.description ?? null) !== (role.description ?? null);
  if (!renamed && !next.added.length && !next.removed.length) return done({ changed: false, added: [], removed: [] });
  const changes = [
    d.name !== role.name && `le cambió el nombre a ${d.name}`,
    next.added.length && `le dio ${next.added.map((k) => `«${permissionLabel(k)}»`).join(', ')}`,
    next.removed.length && `le quitó ${next.removed.map((k) => `«${permissionLabel(k)}»`).join(', ')}`,
  ].filter(Boolean);
  await ctx.db.batch([
    repo.updateStmt(ctx.db, id, { name: d.name, description: d.description }),
    ...repo.permissionStmts(ctx.db, id, next.added, next.removed),
    ...(changes.length ? [activityStmt(ctx.db, ctx.actor, null, 'role.update', `cambió el rol ${role.name}: ${changes.join('; ')}`)] : []),
  ]);
  return done({ changed: true, added: next.added, removed: next.removed });
}

/** Borrar un rol: sólo uno creado a mano, que no tenga nadie ni invitaciones pendientes @param {Context} ctx @param {number} id */
export async function remove(ctx, id) {
  const r = await load(ctx, id);
  if (!r.ok) return r;
  const { role } = r.value;
  if (role.system) return fail('conflict', 'Los roles iniciales no se pueden borrar (sí se pueden cambiar sus permisos).');
  if (role.users) return fail('conflict', `Este rol lo tienen ${role.users} ${role.users === 1 ? 'persona' : 'personas'}: cámbiales el rol antes de borrarlo.`);
  if (role.invites) return fail('conflict', 'Hay invitaciones sin usar con este rol: anúlalas antes de borrarlo.');
  await ctx.db.batch([...repo.deleteStmts(ctx.db, id), activityStmt(ctx.db, ctx.actor, null, 'role.delete', `borró el rol ${role.name}`)]);
  return done({ id });
}
