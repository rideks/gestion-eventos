// @ts-check
// Repositorio de archivos: las filas de `files` (el contenido está en R2; eso lo hace src/services/files.js).

/** @typedef {import('../services/types').Db} Db */

/**
 * @param {Db} db
 * @param {{ expedienteId: number | null, key: string, name: string, mime: string, size: number, userId: number | null }} f
 * @returns {Promise<number>} id del archivo
 */
export async function insert(db, { expedienteId, key, name, mime, size, userId }) {
  const row = await db.prepare('INSERT INTO files (expediente_id, key, name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(expedienteId, key, name, mime, size, userId).first();
  return row.id;
}

/** Las claves en R2 de esos archivos @param {Db} db @param {number[]} ids */
export const keys = (db, ids) => db.prepare(`SELECT id, key FROM files WHERE id IN (${ids.map(() => '?').join(',')})`)
  .bind(...ids).all().then((r) => r.results);

/** @param {Db} db @param {number[]} ids */
export const deleteStmt = (db, ids) => db.prepare(`DELETE FROM files WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids);

// ── Temporales (documentos guardados mientras se corrige un formulario) ─────────────

/**
 * @param {Db} db
 * @param {{ key: string, name: string, mime: string, size: number, userId: number, token: string, at: string }} f
 * @returns {Promise<number>} id del archivo
 */
export async function insertStaged(db, { key, name, mime, size, userId, token, at }) {
  const row = await db.prepare(
    'INSERT INTO files (expediente_id, key, name, mime, size, uploaded_by, staged_token, staged_at) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
  ).bind(key, name, mime, size, userId, token, at).first();
  return row.id;
}

/**
 * El temporal con esa clave, si es de esa persona y no ha caducado
 * @param {Db} db @param {string} token @param {number} userId @param {string} since ISO: los subidos antes no valen
 */
export const staged = (db, token, userId, since) => db.prepare(
  'SELECT id, key, name, mime, size FROM files WHERE staged_token = ? AND uploaded_by = ? AND staged_at >= ?',
).bind(token, userId, since).first();
