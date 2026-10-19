-- ════════════════════════════════════════════════════════════════════════════
-- Business Travel: reservas de viajes de empresa, aparte de los expedientes (que no cambian).
--
--   · bt_bookings         → la reserva: de un cliente (la ficha de Clientes), con su referencia (BT-2026-0001).
--   · bt_passengers       → los pasajeros de la reserva (tratamiento, nombre, email…).
--   · bt_lines            → los servicios de la reserva, en cuatro bloques: transporte, alojamiento,
--                           inscripción y otros. Cada uno con su proveedor (del directorio), fechas,
--                           localizador o nº de reserva y sus importes: sin IVA, % de IVA, con IVA, fee
--                           oculto y PVP (= con IVA + fee). Importes en céntimos; el IVA en puntos básicos.
--   · bt_line_passengers  → qué pasajeros usan cada servicio (un hotel puede tener dos huéspedes).
--   · counters            → contadores seguros para las numeraciones (referencias, albaranes, facturas):
--                           se incrementan en una sola sentencia, sin repetir aunque dos personas guarden a la vez.
--
-- Clientes: tipo (empresa o persona) y tratamiento (Dr. / Dra.) para los que son personas.
-- change_log: el historial común admite ya las reservas, sus albaranes y sus facturas.
-- Sólo se añaden tablas y columnas (change_log se rehace igual, sin nada que apunte a ella).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE clients ADD COLUMN kind TEXT NOT NULL DEFAULT 'empresa' CHECK (kind IN ('empresa', 'persona'));
ALTER TABLE clients ADD COLUMN title TEXT CHECK (title IN ('Dr.', 'Dra.'));

CREATE TABLE counters (
  key   TEXT    PRIMARY KEY,                 -- 'bt_booking:2026', 'bt_albaran:2026'…
  value INTEGER NOT NULL
);

CREATE TABLE bt_bookings (
  id         INTEGER PRIMARY KEY,
  reference  TEXT    NOT NULL UNIQUE,                         -- BT-2026-0001
  client_id  INTEGER NOT NULL REFERENCES clients(id),
  title      TEXT,                                            -- «Congreso SEOM 2026», «Viaje comercial Sevilla»
  status     TEXT    NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'cancelada')),
  notes      TEXT,                                            -- comentarios internos
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_bt_bookings_client ON bt_bookings(client_id, created_at);

CREATE TABLE bt_passengers (
  id         INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bt_bookings(id) ON DELETE CASCADE,
  title      TEXT    CHECK (title IN ('Dr.', 'Dra.')),
  first_name TEXT    NOT NULL,
  last_name  TEXT    NOT NULL,
  email      TEXT,
  phone      TEXT,
  notes      TEXT,                                            -- datos que necesite el servicio
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_bt_passengers_booking ON bt_passengers(booking_id);

CREATE TABLE bt_lines (
  id          INTEGER PRIMARY KEY,
  booking_id  INTEGER NOT NULL REFERENCES bt_bookings(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('transporte', 'alojamiento', 'inscripcion', 'otros')),
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier    TEXT,                                           -- su nombre (el de la ficha al guardarlo)
  description TEXT,                                           -- trayecto · establecimiento · inscripción · servicio
  start_date  TEXT,                                           -- ida · check-in · inicio
  end_date    TEXT,                                           -- vuelta · check-out · fin
  locator     TEXT,                                           -- localizador · nº de reserva
  issued_on   TEXT,                                           -- fecha de emisión (transporte)
  details     TEXT,                                           -- datos adicionales
  base_cents  INTEGER NOT NULL,
  vat_bp      INTEGER NOT NULL CHECK (vat_bp BETWEEN 0 AND 10000),
  total_cents INTEGER NOT NULL,
  fee_cents   INTEGER NOT NULL DEFAULT 0,
  pvp_cents   INTEGER NOT NULL,                               -- total + fee
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_bt_lines_booking ON bt_lines(booking_id, kind);
CREATE INDEX idx_bt_lines_supplier ON bt_lines(supplier_id);

CREATE TABLE bt_line_passengers (
  line_id      INTEGER NOT NULL REFERENCES bt_lines(id) ON DELETE CASCADE,
  passenger_id INTEGER NOT NULL REFERENCES bt_passengers(id) ON DELETE CASCADE,
  PRIMARY KEY (line_id, passenger_id)
);
CREATE INDEX idx_bt_line_passengers_passenger ON bt_line_passengers(passenger_id);

-- Historial común: además de los clientes, las reservas y (en las próximas versiones) sus albaranes y facturas
CREATE TABLE change_log_new (
  id        INTEGER PRIMARY KEY,
  entity    TEXT    NOT NULL CHECK (entity IN ('client', 'bt_booking', 'bt_albaran', 'bt_invoice')),
  entity_id INTEGER NOT NULL,
  user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action    TEXT    NOT NULL,
  summary   TEXT    NOT NULL,
  changes   TEXT,
  at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
INSERT INTO change_log_new (id, entity, entity_id, user_id, action, summary, changes, at)
  SELECT id, entity, entity_id, user_id, action, summary, changes, at FROM change_log;
DROP TABLE change_log;
ALTER TABLE change_log_new RENAME TO change_log;
CREATE INDEX idx_change_log_entity ON change_log(entity, entity_id, at);

-- Tipos de proveedor para los servicios de viaje (se pueden cambiar desde Proveedores)
INSERT INTO supplier_types (name, sort) VALUES
  ('Aerolínea', 72), ('Tren', 74), ('Central de reservas', 76), ('Inscripciones y congresos', 78)
ON CONFLICT (name) DO NOTHING;

-- Permisos nuevos: gestionar las reservas (Jefes, Administración, Tesorería y Eventos) y ver el fee interno
-- (Jefes, Administración y Tesorería). Se cambian en «Usuarios y permisos».
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.value FROM roles r, json_each(CASE r.key
  WHEN 'jefes' THEN '["viajes","viajes.fee"]'
  WHEN 'administracion' THEN '["viajes","viajes.fee"]'
  WHEN 'tesoreria' THEN '["viajes","viajes.fee"]'
  WHEN 'eventos' THEN '["viajes"]'
END) p
WHERE true
ON CONFLICT DO NOTHING;
