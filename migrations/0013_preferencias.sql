-- ════════════════════════════════════════════════════════════════════════════
-- Preferencias de cada persona (p. ej. qué columnas ve en cada tabla y cuántas filas por página).
-- Se guardan en la base de datos: se mantienen al cerrar sesión y en cualquier dispositivo.
--   key:   'tabla:clientes', 'tabla:proveedores'…
--   value: JSON ({ "columns": ["ciudad", "fee"], "per": 50 })
-- Sólo añade una tabla.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE user_prefs (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (user_id, key)
);
