-- ════════════════════════════════════════════════════════════════════════════
-- Cancelar con motivo: al cancelar un expediente o una reserva de Business Travel se apunta quién cancela
-- (el cliente o nosotros), el motivo de una lista y un comentario (src/lib/cancel.js). Así hay un histórico de qué
-- clientes cancelan y por qué (ficha y directorio de clientes).
--   · expedientes: cancel_by, cancel_reason, cancel_notes (cuándo y quién: closed_at y closed_by, como hasta ahora)
--   · bt_bookings: lo mismo y además cancelled_at y cancelled_by (las reservas no lo guardaban)
-- Las canceladas de antes quedan «sin motivo apuntado»; la fecha de las reservas sale de su historial.
-- Sólo se añaden columnas.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE expedientes ADD COLUMN cancel_by TEXT;
ALTER TABLE expedientes ADD COLUMN cancel_reason TEXT;
ALTER TABLE expedientes ADD COLUMN cancel_notes TEXT;

ALTER TABLE bt_bookings ADD COLUMN cancel_by TEXT;
ALTER TABLE bt_bookings ADD COLUMN cancel_reason TEXT;
ALTER TABLE bt_bookings ADD COLUMN cancel_notes TEXT;
ALTER TABLE bt_bookings ADD COLUMN cancelled_at TEXT;
ALTER TABLE bt_bookings ADD COLUMN cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE bt_bookings
   SET cancelled_at = COALESCE((SELECT MAX(c.at) FROM change_log c
                                 WHERE c.entity = 'bt_booking' AND c.entity_id = bt_bookings.id AND c.summary LIKE 'Reserva cancelada%'), updated_at),
       cancelled_by = (SELECT c.user_id FROM change_log c
                        WHERE c.entity = 'bt_booking' AND c.entity_id = bt_bookings.id AND c.summary LIKE 'Reserva cancelada%'
                        ORDER BY c.at DESC LIMIT 1)
 WHERE status = 'cancelada';
