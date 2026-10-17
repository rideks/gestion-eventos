-- ════════════════════════════════════════════════════════════════════════════
-- Esquema inicial · Gestión de eventos (expedientes, pagos y facturación)
-- Se aplica con:  npx wrangler d1 migrations apply DB --local     (local)
--                 npx wrangler d1 migrations apply DB --remote    (producción)
--
-- Convenciones:
--   · Importes en CÉNTIMOS (INTEGER): 2.381,82 € → 238182. Nunca decimales en la base de datos.
--     Pueden ser negativos (abonos, comisiones del hotel, devoluciones).
--   · *_cents base  → sin IVA · *_cents total → con IVA.
--   · Fechas de negocio 'YYYY-MM-DD' (vencimientos, fechas de factura, del evento…).
--   · *_at INTEGER  → segundos Unix (seguridad: sesiones, invitaciones…).
--   · *_at TEXT     → ISO-8601 UTC 'YYYY-MM-DDTHH:MM:SSZ' (registro de actividad).
-- ════════════════════════════════════════════════════════════════════════════

-- ── USUARIOS ───────────────────────────────────────────────────────────────
-- admin   → Administración: abre y cierra expedientes, paga, emite y cobra facturas, usuarios
-- eventos → Gestión de eventos: solicita expedientes, sube presupuestos, facturas, PO…
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'eventos' CHECK (role IN ('admin', 'eventos')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_login_at TEXT
);

-- id = SHA-256 del token. El token en claro sólo existe en la cookie del navegador.
CREATE TABLE sessions (
  id           TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Alta de usuarios sólo por invitación (no hay registro abierto)
CREATE TABLE invites (
  id         INTEGER PRIMARY KEY,
  token_hash TEXT    NOT NULL UNIQUE,
  role       TEXT    NOT NULL DEFAULT 'eventos' CHECK (role IN ('admin', 'eventos')),
  note       TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  revoked_at INTEGER
);

CREATE TABLE login_attempts (
  id         INTEGER PRIMARY KEY,
  email      TEXT    NOT NULL COLLATE NOCASE,
  ip         TEXT,
  ok         INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts_email ON login_attempts(email, created_at);

-- Ajustes clave/valor (p. ej. primer número de expediente)
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
INSERT INTO settings (key, value) VALUES ('first_number', '1001');

-- ── EXPEDIENTES ────────────────────────────────────────────────────────────
-- solicitado → lo ha pedido Eventos y Administración aún no le ha dado número
-- abierto    → en curso: se van subiendo facturas, PO, pagos y cobros
-- cerrado    → cuadrado y archivado (sólo lectura; Administración puede reabrirlo)
-- cancelado  → el evento no se hace
CREATE TABLE expedientes (
  id             INTEGER PRIMARY KEY,
  number         INTEGER UNIQUE,                 -- EXP 1287 (NULL mientras está solicitado)
  name           TEXT    NOT NULL,               -- Lanzamiento Winlevi
  company        TEXT    NOT NULL,               -- GLENMARK
  contact_name   TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  destination    TEXT,
  start_date     TEXT,
  end_date       TEXT,
  attendees      INTEGER,
  notes          TEXT,
  status         TEXT    NOT NULL DEFAULT 'solicitado'
                 CHECK (status IN ('solicitado', 'abierto', 'cerrado', 'cancelado')),
  manager_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- responsable del evento
  requested_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  opened_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  opened_at      TEXT,
  closed_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at      TEXT,
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_expedientes_status ON expedientes(status, start_date);

-- ── DOCUMENTOS (los ficheros viven en R2; aquí los metadatos) ──────────────
CREATE TABLE files (
  id            INTEGER PRIMARY KEY,
  expediente_id INTEGER REFERENCES expedientes(id) ON DELETE CASCADE,
  key           TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  mime          TEXT    NOT NULL,
  size          INTEGER NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_files_expediente ON files(expediente_id);

-- ── PRESUPUESTO (versiones: puede cambiar hasta el último momento) ─────────
CREATE TABLE budgets (
  id            INTEGER PRIMARY KEY,
  expediente_id INTEGER NOT NULL REFERENCES expedientes(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  base_cents    INTEGER NOT NULL,
  total_cents   INTEGER NOT NULL,
  note          TEXT,
  file_id       INTEGER REFERENCES files(id) ON DELETE SET NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (expediente_id, version)
);

-- ── PAGOS A PROVEEDORES (lado izquierdo del cierre) ────────────────────────
-- Cada fila es un coste del evento: nace como PREVISIÓN (hotel: 21.400 € antes del 29/01)
-- o directamente como factura recibida. Se le añade la factura cuando llega y se marca pagada.
-- Varias filas pueden compartir nº de factura (p. ej. una parte por transferencia y otra con tarjeta).
CREATE TABLE payments (
  id             INTEGER PRIMARY KEY,
  expediente_id  INTEGER NOT NULL REFERENCES expedientes(id) ON DELETE CASCADE,
  supplier       TEXT    NOT NULL,
  concept        TEXT,
  invoice_number TEXT,                           -- NULL = aún sin factura del proveedor
  invoice_date   TEXT,
  base_cents     INTEGER NOT NULL,
  total_cents    INTEGER NOT NULL,
  vat            TEXT    NOT NULL DEFAULT '21',  -- '21' · '10' · '4' · '0' · 'mixto'
  due_date       TEXT,                           -- fecha límite de pago
  status         TEXT    NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'pagado')),
  paid_on        TEXT,
  method         TEXT    CHECK (method IN ('transferencia', 'tarjeta', 'domiciliacion', 'efectivo', 'otro')),
  planned        INTEGER NOT NULL DEFAULT 0 CHECK (planned IN (0, 1)),  -- 1 = venía en la previsión
  file_id        INTEGER REFERENCES files(id) ON DELETE SET NULL,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_payments_expediente ON payments(expediente_id);
CREATE INDEX idx_payments_due        ON payments(status, due_date);

-- ── ÓRDENES DE COMPRA DEL CLIENTE (PO) ─────────────────────────────────────
CREATE TABLE purchase_orders (
  id            INTEGER PRIMARY KEY,
  expediente_id INTEGER NOT NULL REFERENCES expedientes(id) ON DELETE CASCADE,
  number        TEXT    NOT NULL,
  billed_to     TEXT    NOT NULL,                -- entidad que paga (BMW, un concesionario…)
  amount_cents  INTEGER NOT NULL,                -- sin IVA
  issued_on     TEXT,
  file_id       INTEGER REFERENCES files(id) ON DELETE SET NULL,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_po_expediente ON purchase_orders(expediente_id);

-- ── FACTURAS A CLIENTE (lado derecho del cierre) ───────────────────────────
-- por_emitir → Eventos la pide (con sus PO) · emitida → Administración le pone nº y PDF
-- cobrada    → el dinero ha llegado          · anulada → no cuenta (se sustituye por otra)
CREATE TABLE invoices (
  id            INTEGER PRIMARY KEY,
  expediente_id INTEGER NOT NULL REFERENCES expedientes(id) ON DELETE CASCADE,
  number        TEXT,                            -- G/000808/26/01 (NULL mientras está por emitir)
  billed_to     TEXT    NOT NULL,
  concept       TEXT,
  base_cents    INTEGER NOT NULL,
  total_cents   INTEGER NOT NULL,
  vat           TEXT    NOT NULL DEFAULT '21',
  status        TEXT    NOT NULL DEFAULT 'por_emitir'
                CHECK (status IN ('por_emitir', 'emitida', 'cobrada', 'anulada')),
  issued_on     TEXT,
  due_date      TEXT,
  collected_on  TEXT,
  file_id       INTEGER REFERENCES files(id) ON DELETE SET NULL,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_invoices_expediente ON invoices(expediente_id);
CREATE INDEX idx_invoices_status     ON invoices(status, due_date);

-- Qué PO cubre cada factura y por cuánto (una factura puede necesitar varias PO
-- y una PO grande puede facturarse en varias veces)
CREATE TABLE invoice_pos (
  invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  po_id        INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  PRIMARY KEY (invoice_id, po_id)
);
CREATE INDEX idx_invoice_pos_po ON invoice_pos(po_id);

-- ── ACTIVIDAD Y NOTAS (sustituye a los correos de ida y vuelta) ────────────
CREATE TABLE activity (
  id            INTEGER PRIMARY KEY,
  expediente_id INTEGER REFERENCES expedientes(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name     TEXT,
  action        TEXT    NOT NULL,                -- 'note' = comentario escrito a mano
  text          TEXT,
  ip            TEXT,
  at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_activity_expediente ON activity(expediente_id, at DESC);
CREATE INDEX idx_activity_at         ON activity(at DESC);
