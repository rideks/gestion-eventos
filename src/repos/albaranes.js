// @ts-check
// Repositorio de los albaranes de Business Travel: TODO su SQL (albaranes y sus revisiones).
// Sin permisos ni reglas: eso lo decide el servicio (src/services/albaranes.js).
// Las funciones que acaban en Stmt(s) devuelven sentencias para juntarlas en un db.batch (atómico).

/** @typedef {import('../services/types').Db} Db */

const LIVE = "status <> 'anulado'";

/**
 * Los albaranes de una reserva (el vigente y los anulados, el más reciente primero), cada uno con lo que dice su
 * revisión vigente (content, en JSON), y todas sus revisiones (sin el contenido) con quién las emitió
 * @param {Db} db
 * @param {number} bookingId
 */
export async function forBooking(db, bookingId) {
  const [albaranes, revisions] = await db.batch([
    db.prepare(
      `SELECT a.*, r.content, u.name AS issued_by_name, v.name AS voided_by_name
         FROM bt_albaranes a LEFT JOIN bt_albaran_revisions r ON r.albaran_id = a.id AND r.revision = a.revision
         LEFT JOIN users u ON u.id = a.issued_by LEFT JOIN users v ON v.id = a.voided_by
        WHERE a.booking_id = ? ORDER BY a.id DESC`,
    ).bind(bookingId),
    db.prepare(
      `SELECT r.albaran_id, r.revision, r.issued_on, r.total_cents, r.created_at, u.name AS issued_by_name
         FROM bt_albaran_revisions r JOIN bt_albaranes a ON a.id = r.albaran_id LEFT JOIN users u ON u.id = r.issued_by
        WHERE a.booking_id = ? ORDER BY r.albaran_id DESC, r.revision DESC`,
    ).bind(bookingId),
  ]);
  return { albaranes: albaranes.results, revisions: revisions.results };
}

/** Una revisión de un albarán de esa reserva (con lo que dice) @param {Db} db @param {number} bookingId @param {number} albaranId @param {number} revision */
export const revision = (db, bookingId, albaranId, revision) => db.prepare(
  `SELECT r.*, a.number, a.status, a.void_reason, a.revision AS current_revision
     FROM bt_albaran_revisions r JOIN bt_albaranes a ON a.id = r.albaran_id
    WHERE a.booking_id = ? AND a.id = ? AND r.revision = ?`,
).bind(bookingId, albaranId, revision).first();

/** ¿Tiene o ha tenido algún albarán? (entonces la reserva no se puede borrar) @param {Db} db @param {number} bookingId */
export const hasAny = (db, bookingId) => db.prepare('SELECT EXISTS (SELECT 1 FROM bt_albaranes WHERE booking_id = ?) AS any').bind(bookingId).first()
  .then((r) => !!r?.any);

/** El albarán sin anular de una reserva (o null) @param {Db} db @param {number} bookingId */
export const live = (db, bookingId) => db.prepare(`SELECT * FROM bt_albaranes WHERE booking_id = ? AND ${LIVE}`).bind(bookingId).first();

// ── Cambios ────────────────────────────────────────────────────────────────

/**
 * Emitir el albarán de una reserva, todo en la misma transacción: el siguiente número del contador, el albarán
 * (con el número ya compuesto: prefijo + número de 6 cifras + sufijo) y su revisión 1. Si la reserva ya tiene un
 * albarán sin anular (otra persona lo acaba de emitir), no hace nada: ni gasta número. La segunda sentencia
 * devuelve el albarán creado (id y número), o nada.
 * @param {Db} db
 * @param {{ bookingId: number, counterKey: string, prefix: string, suffix: string, issuedOn: string, userId: number | null, content: string, total: number }} d
 */
export function emitStmts(db, d) {
  const free = `NOT EXISTS (SELECT 1 FROM bt_albaranes x WHERE x.booking_id = ?1 AND x.${LIVE})`;
  return [
    db.prepare(`INSERT INTO counters (key, value) SELECT ?2, 1 WHERE ${free} ON CONFLICT (key) DO UPDATE SET value = value + 1`)
      .bind(d.bookingId, d.counterKey),
    db.prepare(
      `INSERT INTO bt_albaranes (booking_id, number, issued_on, issued_by, total_cents)
       SELECT ?1, ?3 || printf('%06d', (SELECT value FROM counters WHERE key = ?2)) || ?4, ?5, ?6, ?7 WHERE ${free}
       RETURNING id, number`,
    ).bind(d.bookingId, d.counterKey, d.prefix, d.suffix, d.issuedOn, d.userId, d.total),
    db.prepare(
      `INSERT INTO bt_albaran_revisions (albaran_id, revision, issued_on, issued_by, content, total_cents)
       SELECT a.id, 1, ?2, ?3, ?4, ?5 FROM bt_albaranes a
        WHERE a.booking_id = ?1 AND a.${LIVE} AND NOT EXISTS (SELECT 1 FROM bt_albaran_revisions r WHERE r.albaran_id = a.id)`,
    ).bind(d.bookingId, d.issuedOn, d.userId, d.content, d.total),
  ];
}

/**
 * Emitir una revisión nueva (from + 1) de un albarán emitido. Si otra persona acaba de emitir otra, no hace nada.
 * La primera sentencia devuelve la revisión nueva, o nada.
 * @param {Db} db
 * @param {{ id: number, from: number, issuedOn: string, userId: number | null, content: string, total: number, at: string }} d
 */
export const reviseStmts = (db, d) => [
  db.prepare(
    `UPDATE bt_albaranes SET revision = ?2 + 1, issued_on = ?3, issued_by = ?4, total_cents = ?5, updated_at = ?6
      WHERE id = ?1 AND revision = ?2 AND status = 'emitido' RETURNING revision`,
  ).bind(d.id, d.from, d.issuedOn, d.userId, d.total, d.at),
  db.prepare(
    `INSERT INTO bt_albaran_revisions (albaran_id, revision, issued_on, issued_by, content, total_cents)
     SELECT id, revision, ?3, ?4, ?5, ?6 FROM bt_albaranes
      WHERE id = ?1 AND revision = ?2 + 1 AND NOT EXISTS (SELECT 1 FROM bt_albaran_revisions r WHERE r.albaran_id = ?1 AND r.revision = ?2 + 1)`,
  ).bind(d.id, d.from, d.issuedOn, d.userId, d.content, d.total),
];

/**
 * Anular un albarán emitido (uno facturado no: antes se anula la factura). Devuelve su id si lo anuló.
 * @param {Db} db @param {number} id @param {{ reason: string, userId: number | null, at: string }} v
 */
export const voidStmt = (db, id, v) => db.prepare(
  `UPDATE bt_albaranes SET status = 'anulado', void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ? AND status = 'emitido' RETURNING id`,
).bind(v.reason, v.at, v.userId, v.at, id);

/** Anular el albarán emitido de una reserva (al cancelarla) @param {Db} db @param {number} bookingId @param {{ reason: string, userId: number | null, at: string }} v */
export const voidForBookingStmt = (db, bookingId, v) => db.prepare(
  `UPDATE bt_albaranes SET status = 'anulado', void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ? WHERE booking_id = ? AND status = 'emitido'`,
).bind(v.reason, v.at, v.userId, v.at, bookingId);
