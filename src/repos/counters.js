// @ts-check
// Contadores para las numeraciones (referencias de reserva, albaranes, facturas de Business Travel).
// Se incrementan en UNA sentencia: aunque dos personas guarden a la vez, nunca sale el mismo número,
// y un número dado no se vuelve a dar aunque luego se borre lo que lo usaba.

/** @typedef {import('../services/types').Db} Db */

/**
 * El siguiente número de ese contador (el primero es 1)
 * @param {Db} db
 * @param {string} key p. ej. 'bt_booking:2026'
 * @returns {Promise<number>}
 */
export async function next(db, key) {
  const row = await db.prepare('INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT (key) DO UPDATE SET value = value + 1 RETURNING value')
    .bind(key).first();
  return row.value;
}
