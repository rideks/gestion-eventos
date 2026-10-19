-- ════════════════════════════════════════════════════════════════════════════
-- Business Travel: cerrar una reserva cuando el viaje ha terminado (y reabrirla).
--
--   · bt_bookings.closed_at / closed_by → cuándo y quién la cerró. Una reserva cerrada sigue con estado
--     'abierta' (no cancelada) y con fecha de cierre; así no se reconstruye la tabla (tiene pasajeros y servicios
--     que apuntan a ella). Cerrada = sólo lectura, como las canceladas.
--   · Permiso «viajes.close» (cerrar y reabrir reservas) para los roles que cierran expedientes y ven los viajes.
-- Sólo se añaden columnas y permisos.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE bt_bookings ADD COLUMN closed_at TEXT;
ALTER TABLE bt_bookings ADD COLUMN closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

INSERT OR IGNORE INTO role_permissions (role_id, permission)
SELECT role_id, 'viajes.close' FROM role_permissions
 WHERE permission = 'expediente.close'
   AND role_id IN (SELECT role_id FROM role_permissions WHERE permission = 'viajes');
