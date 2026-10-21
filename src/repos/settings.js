// @ts-check
// Repositorio de Ajustes (la tabla settings: clave → valor). Sin permisos: eso lo decide el servicio.

/** @typedef {import('../services/types').Db} Db */

/**
 * Los valores de esas claves (las que no están no salen) y de las que empiezan por prefix (p. ej. 'company_')
 * @param {Db} db
 * @param {string[]} keys
 * @param {string} [prefix]
 * @returns {Promise<Record<string, string>>}
 */
export async function values(db, keys, prefix = '') {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key IN (SELECT value FROM json_each(?1)) OR (?2 <> '' AND key LIKE ?2 || '%')")
    .bind(JSON.stringify(keys), prefix).all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

/** Guardar un ajuste @param {Db} db @param {string} key @param {string} value */
export const upsertStmt = (db, key, value) => db.prepare(
  "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
).bind(key, value);
