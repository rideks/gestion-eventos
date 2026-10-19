// @ts-check
// Repositorio de Business Travel: TODO el SQL de las reservas, sus pasajeros y sus servicios.
// Sin permisos ni reglas: eso lo decide el servicio (src/services/travel.js).
// Las funciones que acaban en Stmt devuelven sentencias para juntarlas en un db.batch (atómico).

/** @typedef {import('../services/types').Db} Db */

import { likeTerm } from './payments.js';

// Totales de una reserva (b alias de bt_bookings)
const TOTALS = `
  (SELECT COUNT(*) FROM bt_passengers x WHERE x.booking_id = b.id) AS passengers,
  (SELECT COUNT(*) FROM bt_lines l WHERE l.booking_id = b.id) AS lines,
  (SELECT COALESCE(SUM(l.base_cents), 0) FROM bt_lines l WHERE l.booking_id = b.id) AS base_cents,
  (SELECT COALESCE(SUM(l.total_cents), 0) FROM bt_lines l WHERE l.booking_id = b.id) AS total_cents,
  (SELECT COALESCE(SUM(l.fee_cents), 0) FROM bt_lines l WHERE l.booking_id = b.id) AS fee_cents,
  (SELECT COALESCE(SUM(l.pvp_cents), 0) FROM bt_lines l WHERE l.booking_id = b.id) AS pvp_cents,
  (SELECT MIN(l.start_date) FROM bt_lines l WHERE l.booking_id = b.id) AS first_date,
  (SELECT MAX(COALESCE(l.end_date, l.start_date)) FROM bt_lines l WHERE l.booking_id = b.id) AS last_date`;
const CLIENT = 'c.name AS client_name, c.title AS client_title, c.kind AS client_kind, c.city AS client_city';

// ── Consultas ──────────────────────────────────────────────────────────────

/**
 * Reservas, las más recientes primero. q: referencia, cliente, descripción, pasajero, proveedor o localizador.
 * month: 'YYYY-MM' (por la fecha de sus servicios: alguno empieza ese mes).
 * @param {Db} db
 * @param {{ q?: string, status?: string, clientId?: number | null, month?: string }} filters
 */
export function list(db, { q = '', status = '', clientId = null, month = '' } = {}) {
  return db.prepare(
    `SELECT b.id, b.reference, b.client_id, b.title, b.status, b.created_at, ${CLIENT}, ${TOTALS}
       FROM bt_bookings b JOIN clients c ON c.id = b.client_id
      WHERE (?1 = '%%' OR b.reference LIKE ?1 OR b.title LIKE ?1 OR c.name LIKE ?1
             OR EXISTS (SELECT 1 FROM bt_passengers p WHERE p.booking_id = b.id AND (p.first_name || ' ' || p.last_name) LIKE ?1)
             OR EXISTS (SELECT 1 FROM bt_lines l WHERE l.booking_id = b.id AND (l.supplier LIKE ?1 OR l.locator LIKE ?1 OR l.description LIKE ?1)))
        AND (?2 = '' OR b.status = ?2)
        AND (?3 IS NULL OR b.client_id = ?3)
        AND (?4 = '' OR EXISTS (SELECT 1 FROM bt_lines l WHERE l.booking_id = b.id AND substr(l.start_date, 1, 7) = ?4))
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT 500`,
  ).bind(likeTerm(q), status, clientId, month).all().then((r) => r.results);
}

/** Las reservas de un cliente (para su ficha) @param {Db} db @param {number} clientId */
export const forClient = (db, clientId) => list(db, { clientId });

/**
 * La reserva con su cliente, sus pasajeros, sus servicios (con los pasajeros de cada uno) y quién la creó
 * @param {Db} db
 * @param {number} id
 */
export async function detail(db, id) {
  const [b, passengers, lines, links] = await db.batch([
    db.prepare(
      `SELECT b.*, ${CLIENT}, c.email AS client_email, c.phone AS client_phone, u.name AS created_by_name
         FROM bt_bookings b JOIN clients c ON c.id = b.client_id LEFT JOIN users u ON u.id = b.created_by
        WHERE b.id = ?`,
    ).bind(id),
    db.prepare('SELECT * FROM bt_passengers WHERE booking_id = ? ORDER BY id').bind(id),
    db.prepare(
      `SELECT l.*, s.status AS supplier_status FROM bt_lines l LEFT JOIN suppliers s ON s.id = l.supplier_id
        WHERE l.booking_id = ? ORDER BY COALESCE(l.start_date, '9999-12-31'), l.id`,
    ).bind(id),
    db.prepare('SELECT lp.line_id, lp.passenger_id FROM bt_line_passengers lp JOIN bt_lines l ON l.id = lp.line_id WHERE l.booking_id = ?').bind(id),
  ]);
  const booking = b.results[0];
  if (!booking) return null;
  return { booking, passengers: passengers.results, lines: lines.results, links: links.results };
}

/** Lo justo para saber si existe y en qué estado está @param {Db} db @param {number} id */
export const header = (db, id) => db.prepare('SELECT id, reference, client_id, title, status FROM bt_bookings WHERE id = ?').bind(id).first();

/** Un servicio de esa reserva @param {Db} db @param {number} bookingId @param {number} id */
export const line = (db, bookingId, id) => db.prepare('SELECT * FROM bt_lines WHERE id = ? AND booking_id = ?').bind(id, bookingId).first();

/** Un pasajero de esa reserva @param {Db} db @param {number} bookingId @param {number} id */
export const passenger = (db, bookingId, id) => db.prepare('SELECT * FROM bt_passengers WHERE id = ? AND booking_id = ?').bind(id, bookingId).first();

/** Los ids de los pasajeros de una reserva @param {Db} db @param {number} bookingId */
export const passengerIds = (db, bookingId) => db.prepare('SELECT id FROM bt_passengers WHERE booking_id = ?').bind(bookingId).all()
  .then((r) => r.results.map((x) => x.id));

/**
 * Personas que ya han viajado para ese cliente (para rellenar el pasajero sin volver a escribirlo):
 * la última vez que aparece cada una (por nombre y apellidos)
 * @param {Db} db
 * @param {number} clientId
 */
export const knownPassengers = (db, clientId) => db.prepare(
  `SELECT p.title, p.first_name, p.last_name, p.email, p.phone FROM bt_passengers p JOIN bt_bookings b ON b.id = p.booking_id
    WHERE b.client_id = ? AND p.id = (SELECT MAX(q.id) FROM bt_passengers q JOIN bt_bookings bq ON bq.id = q.booking_id
                                      WHERE bq.client_id = b.client_id AND lower(q.first_name || ' ' || q.last_name) = lower(p.first_name || ' ' || p.last_name))
    ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE LIMIT 300`,
).bind(clientId).all().then((r) => r.results);

/** ¿Tiene servicios o pasajeros? (una reserva vacía se puede borrar) @param {Db} db @param {number} id */
export const isEmpty = (db, id) => db.prepare(
  'SELECT NOT EXISTS (SELECT 1 FROM bt_lines WHERE booking_id = ?1) AND NOT EXISTS (SELECT 1 FROM bt_passengers WHERE booking_id = ?1) AS empty',
).bind(id).first().then((r) => !!r.empty);

// ── Cambios: reservas ──────────────────────────────────────────────────────

/**
 * Reserva nueva; devuelve su id
 * @param {Db} db
 * @param {{ reference: string, clientId: number, title: string | null, notes: string | null, userId: number | null }} d
 */
export async function insert(db, d) {
  const row = await db.prepare('INSERT INTO bt_bookings (reference, client_id, title, notes, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(d.reference, d.clientId, d.title, d.notes, d.userId).first();
  return row.id;
}

/** @param {Db} db @param {number} id @param {{ clientId: number, title: string | null, notes: string | null }} d @param {string} at */
export const updateStmt = (db, id, d, at) => db.prepare('UPDATE bt_bookings SET client_id = ?, title = ?, notes = ?, updated_at = ? WHERE id = ?')
  .bind(d.clientId, d.title, d.notes, at, id);

/** @param {Db} db @param {number} id @param {'abierta' | 'cancelada'} status @param {string} at */
export const statusStmt = (db, id, status, at) => db.prepare('UPDATE bt_bookings SET status = ?, updated_at = ? WHERE id = ?').bind(status, at, id);

/** @param {Db} db @param {number} id @param {string} at */
export const touchStmt = (db, id, at) => db.prepare('UPDATE bt_bookings SET updated_at = ? WHERE id = ?').bind(at, id);

/** @param {Db} db @param {number} id */
export const deleteStmt = (db, id) => db.prepare('DELETE FROM bt_bookings WHERE id = ?').bind(id);

// ── Cambios: pasajeros ─────────────────────────────────────────────────────

/**
 * @param {Db} db
 * @param {number} bookingId
 * @param {{ title: string | null, first_name: string, last_name: string, email: string | null, phone: string | null, notes: string | null }} p
 */
export async function insertPassenger(db, bookingId, p) {
  const row = await db.prepare('INSERT INTO bt_passengers (booking_id, title, first_name, last_name, email, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(bookingId, p.title, p.first_name, p.last_name, p.email, p.phone, p.notes).first();
  return row.id;
}

/**
 * @param {Db} db
 * @param {number} id
 * @param {{ title: string | null, first_name: string, last_name: string, email: string | null, phone: string | null, notes: string | null }} p
 */
export const updatePassengerStmt = (db, id, p) => db.prepare(
  'UPDATE bt_passengers SET title = ?, first_name = ?, last_name = ?, email = ?, phone = ?, notes = ? WHERE id = ?',
).bind(p.title, p.first_name, p.last_name, p.email, p.phone, p.notes, id);

/** Se quita también de los servicios que usaba @param {Db} db @param {number} id */
export const deletePassengerStmt = (db, id) => db.prepare('DELETE FROM bt_passengers WHERE id = ?').bind(id);

// ── Cambios: servicios ─────────────────────────────────────────────────────

/**
 * @typedef {{ kind: string, supplier: { id: number, name: string } | null, description: string | null, start_date: string | null,
 *   end_date: string | null, locator: string | null, issued_on: string | null, details: string | null,
 *   base: number, vat_bp: number, total: number, fee: number, pvp: number }} LineData
 */

/** Servicio nuevo; devuelve su id @param {Db} db @param {number} bookingId @param {LineData} d @param {number | null} userId */
export async function insertLine(db, bookingId, d, userId) {
  const row = await db.prepare(
    `INSERT INTO bt_lines (booking_id, kind, supplier_id, supplier, description, start_date, end_date, locator, issued_on, details,
                           base_cents, vat_bp, total_cents, fee_cents, pvp_cents, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(bookingId, d.kind, d.supplier?.id ?? null, d.supplier?.name ?? null, d.description, d.start_date, d.end_date, d.locator, d.issued_on,
    d.details, d.base, d.vat_bp, d.total, d.fee, d.pvp, userId).first();
  return row.id;
}

/** @param {Db} db @param {number} id @param {LineData} d @param {string} at */
export const updateLineStmt = (db, id, d, at) => db.prepare(
  `UPDATE bt_lines SET supplier_id = ?, supplier = ?, description = ?, start_date = ?, end_date = ?, locator = ?, issued_on = ?, details = ?,
          base_cents = ?, vat_bp = ?, total_cents = ?, fee_cents = ?, pvp_cents = ?, updated_at = ? WHERE id = ?`,
).bind(d.supplier?.id ?? null, d.supplier?.name ?? null, d.description, d.start_date, d.end_date, d.locator, d.issued_on, d.details,
  d.base, d.vat_bp, d.total, d.fee, d.pvp, at, id);

/** Los pasajeros de un servicio (se sustituyen todos) @param {Db} db @param {number} lineId @param {number[]} passengerIds */
export const linkPassengersStmts = (db, lineId, passengerIds) => [
  db.prepare('DELETE FROM bt_line_passengers WHERE line_id = ?').bind(lineId),
  ...passengerIds.map((p) => db.prepare('INSERT INTO bt_line_passengers (line_id, passenger_id) VALUES (?, ?)').bind(lineId, p)),
];

/** @param {Db} db @param {number} id */
export const deleteLineStmt = (db, id) => db.prepare('DELETE FROM bt_lines WHERE id = ?').bind(id);
