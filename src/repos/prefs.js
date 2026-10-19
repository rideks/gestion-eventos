// @ts-check
// Repositorio de las preferencias de cada persona (user_prefs): un JSON por clave ('tabla:clientes'…).

/** @typedef {import('../services/types').Db} Db */

/** @param {Db} db @param {number} userId @param {string} key @returns {Promise<any>} el valor (ya leído del JSON) o null */
export async function get(db, userId, key) {
  const row = await db.prepare('SELECT value FROM user_prefs WHERE user_id = ? AND key = ?').bind(userId, key).first();
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

/** @param {Db} db @param {number} userId @param {string} key @param {unknown} value */
export const setStmt = (db, userId, key, value) => db.prepare(
  `INSERT INTO user_prefs (user_id, key, value) VALUES (?, ?, ?)
   ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
).bind(userId, key, JSON.stringify(value));

/** @param {Db} db @param {number} userId @param {string} key */
export const deleteStmt = (db, userId, key) => db.prepare('DELETE FROM user_prefs WHERE user_id = ? AND key = ?').bind(userId, key);
