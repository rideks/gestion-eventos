// Usuarios y roles: consultas de «Usuarios y permisos» y la salvaguarda de que siempre quede
// alguien que pueda gestionar usuarios.
import { managersAfter } from './permissions.js';

/** Roles con sus permisos y cuántas personas (activas y en total) tienen cada uno */
export async function loadRoles(db) {
  const [roles, grants, people, invites] = await db.batch([
    db.prepare('SELECT id, key, name, description, system FROM roles ORDER BY system DESC, id'),
    db.prepare('SELECT role_id, permission FROM role_permissions'),
    db.prepare('SELECT role_id, COUNT(*) AS n, SUM(active) AS active FROM users GROUP BY role_id'),
    db.prepare('SELECT role_id, COUNT(*) AS n FROM invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ? GROUP BY role_id')
      .bind(Math.floor(Date.now() / 1000)),
  ]);
  const perms = new Map();
  for (const g of grants.results) perms.set(g.role_id, [...(perms.get(g.role_id) ?? []), g.permission]);
  const count = new Map(people.results.map((r) => [r.role_id, r]));
  const pending = new Map(invites.results.map((r) => [r.role_id, r.n]));
  return roles.results.map((r) => ({
    ...r,
    permissions: perms.get(r.id) ?? [],
    users: count.get(r.id)?.n ?? 0,
    activeUsers: count.get(r.id)?.active ?? 0,
    invites: pending.get(r.id) ?? 0,
  }));
}

/** ¿Seguiría habiendo alguien activo con «Usuarios, roles y permisos» tras el cambio? (ver managersAfter) */
export async function keepsAManager(db, change) {
  const [users, grants] = await db.batch([
    db.prepare('SELECT id, role_id, active FROM users'),
    db.prepare("SELECT role_id FROM role_permissions WHERE permission = 'users'"),
  ]);
  return managersAfter(users.results, grants.results.map((g) => g.role_id), change) > 0;
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
