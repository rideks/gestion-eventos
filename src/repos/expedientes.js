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

// ── Número de expediente ───────────────────────────────────────────────────
// Cada expediente recibe su número al crearlo: el siguiente de un contador (counters, 'expediente') que nunca
// baja del mayor número ya usado (Administración puede cambiar uno en «Editar») ni del «primer número» de Ajustes.
// Se da en UNA sentencia, en el mismo batch que el alta: dos altas a la vez nunca reciben el mismo número, y un
// número dado no se vuelve a dar aunque se borre el expediente (puede quedar un hueco).
const FLOOR = `MAX(COALESCE((SELECT MAX(number) FROM expedientes), 0),
                   COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'first_number'), 1001) - 1)`;

/** Reserva el siguiente número (va antes, en el mismo batch, que la sentencia que lo usa con NUMBER) @param {Db} db */
export const nextNumberStmt = (db) => db.prepare(
  `INSERT INTO counters (key, value) VALUES ('expediente', ${FLOOR} + 1)
   ON CONFLICT (key) DO UPDATE SET value = MAX(value, ${FLOOR}) + 1`,
);

/** El número recién reservado con nextNumberStmt (para usarlo dentro de otra sentencia del mismo batch) */
export const NUMBER = "(SELECT value FROM counters WHERE key = 'expediente')";

/** El número que recibirá el próximo expediente (para enseñarlo en Ajustes) @param {Db} db @returns {Promise<number>} */
export async function upcomingNumber(db) {
  const row = await db.prepare(`SELECT MAX(COALESCE(${NUMBER}, 0), ${FLOOR}) + 1 AS n`).first();
  return row.n;
}
