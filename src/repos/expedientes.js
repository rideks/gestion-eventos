// @ts-check
// Repositorio de expedientes. De momento, lo que necesitan las áreas ya en capas (la cabecera de un
// expediente); el resto de sus consultas sigue en src/lib/data.js hasta que Expedientes pase a capas.

/** @typedef {import('../services/types').Db} Db */

/** Expediente con los nombres del responsable y de quien lo pidió, abrió y cerró @param {Db} db @param {number} id */
export function header(db, id) {
  return db.prepare(
    `SELECT e.*, m.name AS manager_name, r.name AS requested_by_name, o.name AS opened_by_name, c.name AS closed_by_name
       FROM expedientes e
       LEFT JOIN users m ON m.id = e.manager_id
       LEFT JOIN users r ON r.id = e.requested_by
       LEFT JOIN users o ON o.id = e.opened_by
       LEFT JOIN users c ON c.id = e.closed_by
      WHERE e.id = ?`,
  ).bind(id).first();
}
