// @ts-check
// Repositorio de roles y permisos: TODO su SQL. Sin permisos ni reglas: eso lo decide el servicio
// (src/services/roles.js). Las funciones que acaban en Stmt(s) devuelven sentencias para juntarlas en un db.batch.

/** @typedef {import('../services/types').Db} Db */

/**
 * Roles con sus permisos y cuántas personas (activas y en total) e invitaciones pendientes tiene cada uno
 * @param {Db} db
 */
export async function all(db) {
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

/** Las personas que tienen ese rol (activas primero) @param {Db} db @param {number} roleId */
export const people = (db, roleId) => db.prepare('SELECT id, name, active FROM users WHERE role_id = ? ORDER BY active DESC, name').bind(roleId).all()
  .then((r) => r.results);

/** Lo que hace falta para saber si sigue quedando quien gestione usuarios: las personas y los roles con «users» @param {Db} db */
export async function managers(db) {
  const [users, grants] = await db.batch([
    db.prepare('SELECT id, role_id, active FROM users'),
    db.prepare("SELECT role_id FROM role_permissions WHERE permission = 'users'"),
  ]);
  return { users: users.results, managerRoles: grants.results.map((g) => g.role_id) };
}

/** @param {Db} db @param {number} id @param {{ name: string, description: string | null }} d */
export const updateStmt = (db, id, d) => db.prepare("UPDATE roles SET name = ?, description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
  .bind(d.name, d.description, id);

/** Dar y quitar permisos (sólo esos: los demás no se tocan) @param {Db} db @param {number} id @param {string[]} added @param {string[]} removed */
export const permissionStmts = (db, id, added, removed) => [
  ...(removed.length ? [db.prepare('DELETE FROM role_permissions WHERE role_id = ? AND permission IN (SELECT value FROM json_each(?))').bind(id, JSON.stringify(removed))] : []),
  ...(added.length ? [db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission) SELECT ?, value FROM json_each(?)').bind(id, JSON.stringify(added))] : []),
];

/** Borrar un rol (y sus invitaciones ya usadas, anuladas o caducadas) @param {Db} db @param {number} id */
export const deleteStmts = (db, id) => [
  db.prepare('DELETE FROM invites WHERE role_id = ?').bind(id),
  db.prepare('DELETE FROM roles WHERE id = ?').bind(id),
];
