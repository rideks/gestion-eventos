-- ════════════════════════════════════════════════════════════════════════════
-- Business Travel: el albarán de cada reserva (un documento con todos sus servicios y su PVP, sin el fee).
--
--   · bt_albaranes          → el albarán de una reserva: su número (ALB-2026-000001, con el formato de Ajustes),
--                             su estado (emitido · facturado · anulado), la revisión vigente, cuándo y quién la
--                             emitió y su PVP total. «Pendiente de emisión» no se guarda: es una reserva con
--                             servicios que todavía no tiene albarán.
--   · bt_albaran_revisions  → lo que dice el documento en cada revisión (la 1 al emitirlo; la 2, la 3… si la
--                             reserva cambia después), en JSON: emisor, cliente, servicios por bloque y totales.
--                             Una revisión no se cambia nunca: el documento de cada una se puede volver a sacar.
--
-- Número: lo da el contador seguro de counters ('bt_albaran:2026') en la misma transacción que el albarán, así no
-- se repite aunque dos personas emitan a la vez y no se reutiliza aunque se anule. Es único en todo el sistema.
-- Una reserva tiene como mucho un albarán sin anular (índice único parcial); si se anula (p. ej. al cancelar la
-- reserva) y luego se reabre, el nuevo albarán lleva otro número y el anulado se conserva.
-- Permiso nuevo «viajes.albaran» (emitir, revisar y anular albaranes) para quien ve los viajes y emite facturas.
-- Sólo se añaden tablas y permisos.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE bt_albaranes (
  id          INTEGER PRIMARY KEY,
  booking_id  INTEGER NOT NULL REFERENCES bt_bookings(id),
  number      TEXT    NOT NULL UNIQUE,                        -- ALB-2026-000001
  status      TEXT    NOT NULL DEFAULT 'emitido' CHECK (status IN ('emitido', 'facturado', 'anulado')),
  revision    INTEGER NOT NULL DEFAULT 1,                     -- la vigente
  issued_on   TEXT    NOT NULL,                               -- fecha de emisión de la revisión vigente
  issued_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  total_cents INTEGER NOT NULL,                               -- PVP total de la revisión vigente
  void_reason TEXT,                                           -- por qué se anuló
  voided_at   TEXT,
  voided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE UNIQUE INDEX ux_bt_albaranes_live ON bt_albaranes(booking_id) WHERE status <> 'anulado';
CREATE INDEX idx_bt_albaranes_booking ON bt_albaranes(booking_id, id);
CREATE INDEX idx_bt_albaranes_status ON bt_albaranes(status, issued_on);

CREATE TABLE bt_albaran_revisions (
  id          INTEGER PRIMARY KEY,
  albaran_id  INTEGER NOT NULL REFERENCES bt_albaranes(id) ON DELETE CASCADE,
  revision    INTEGER NOT NULL,
  issued_on   TEXT    NOT NULL,
  issued_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content     TEXT    NOT NULL,                               -- JSON: lo que dice el documento
  total_cents INTEGER NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (albaran_id, revision)
);

INSERT OR IGNORE INTO role_permissions (role_id, permission)
SELECT role_id, 'viajes.albaran' FROM role_permissions
 WHERE permission = 'invoice.issue'
   AND role_id IN (SELECT role_id FROM role_permissions WHERE permission = 'viajes');
