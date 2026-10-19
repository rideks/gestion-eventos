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
