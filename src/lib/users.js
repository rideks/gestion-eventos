// Usuarios y roles: consultas de «Usuarios y permisos» y la salvaguarda de que siempre quede
// alguien que pueda gestionar usuarios.
import { managersAfter } from './permissions.js';
import { managers } from '../repos/roles.js';

/** Roles con sus permisos y cuántas personas (activas y en total) tienen cada uno (src/repos/roles.js) */
export { all as loadRoles } from '../repos/roles.js';

/** ¿Seguiría habiendo alguien activo con «Usuarios, roles y permisos» tras el cambio? (ver managersAfter) */
export async function keepsAManager(db, change) {
  const { users, managerRoles } = await managers(db);
  return managersAfter(users, managerRoles, change) > 0;
}

export const LAST_MANAGER = 'Tiene que quedar al menos una persona activa que pueda gestionar usuarios y permisos.';

/** Últimos cambios de usuarios, roles y permisos (registro general, sin expediente) */
export function accessLog(db, limit = 15) {
  return db.prepare(
    `SELECT user_name, text, at FROM activity
      WHERE expediente_id IS NULL AND (action LIKE 'role.%' OR action LIKE 'user.%' OR action LIKE 'invite.%')
      ORDER BY at DESC, id DESC LIMIT ?`,
  ).bind(limit).all().then((r) => r.results);
}
