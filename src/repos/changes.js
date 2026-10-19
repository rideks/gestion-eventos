// @ts-check
// Repositorio del historial común de cambios (change_log): qué cambió en una ficha, antes y después,
// quién y cuándo. Lo usan los clientes; las áreas nuevas lo usarán igual (entity = 'client', …).

/** @typedef {import('../services/types').Db} Db */

/**
 * @param {Db} db
 * @param {'client' | 'bt_booking' | 'bt_albaran' | 'bt_invoice'} entity
 * @param {number} entityId
 * @param {number | null} userId
 * @param {string} action alta · datos · condiciones · fusion · entidad…
 * @param {string} summary ya redactado: se lee igual aunque luego cambien los datos
 * @param {Record<string, [unknown, unknown]> | null} [changes]
 */
export function changeStmt(db, entity, entityId, userId, action, summary, changes = null) {
  return db.prepare('INSERT INTO change_log (entity, entity_id, user_id, action, summary, changes) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(entity, entityId, userId, action, summary, changes ? JSON.stringify(changes) : null);
}

/**
 * Historial de una ficha, lo más reciente primero
 * @param {Db} db
 * @param {'client' | 'bt_booking' | 'bt_albaran' | 'bt_invoice'} entity
 * @param {number} entityId
 */
export const forEntity = (db, entity, entityId) => db.prepare(
  `SELECT h.*, u.name AS user_name FROM change_log h LEFT JOIN users u ON u.id = h.user_id
    WHERE h.entity = ? AND h.entity_id = ? ORDER BY h.at DESC, h.id DESC LIMIT 200`,
).bind(entity, entityId).all().then((r) => r.results);

/**
 * Lo que había de una ficha que desaparece (al fusionar) pasa a la otra
 * @param {Db} db
 * @param {'client' | 'bt_booking' | 'bt_albaran' | 'bt_invoice'} entity
 * @param {number} fromId
 * @param {number} intoId
 */
export const moveStmt = (db, entity, fromId, intoId) => db.prepare('UPDATE change_log SET entity_id = ? WHERE entity = ? AND entity_id = ?').bind(intoId, entity, fromId);
