-- ════════════════════════════════════════════════════════════════════════════
-- Roles y permisos en la base de datos (antes estaban fijos en el código: 'admin' y 'eventos').
--
--   · roles             → los 5 iniciales (no se pueden borrar) y los que se creen después.
--   · role_permissions  → lista blanca: un rol puede hacer EXACTAMENTE lo que tiene aquí.
--                         Las claves de permiso están descritas en src/lib/permissions.js.
--   · users.role_id / invites.role_id sustituyen a la columna de texto `role`.
--
-- Sin reconstruir tablas: recrear `users` haría un borrado implícito que dispararía los
-- ON DELETE (se perderían el responsable de cada expediente, los autores de pagos, facturas y
-- actividad, y se cerrarían todas las sesiones). Se añade `role_id` y se quita la columna vieja
-- con DROP COLUMN, que no borra filas.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE roles (
  id          INTEGER PRIMARY KEY,
  key         TEXT    NOT NULL UNIQUE,                -- identificador estable: 'jefes', 'tecnico'…
  name        TEXT    NOT NULL UNIQUE COLLATE NOCASE, -- lo que se ve: «Administración»
  description TEXT,
  system      INTEGER NOT NULL DEFAULT 0 CHECK (system IN (0, 1)),  -- 1 = de los iniciales: no se borra
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE role_permissions (
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT    NOT NULL,
  PRIMARY KEY (role_id, permission)
);

INSERT INTO roles (id, key, name, description, system) VALUES
  (1, 'jefes',          'Jefes',          'Dirección: supervisión, análisis y decisiones', 1),
  (2, 'administracion', 'Administración', 'Gestión administrativa y económica', 1),
  (3, 'tesoreria',      'Tesorería',      'Cobros, pagos y seguimiento financiero', 1),
  (4, 'eventos',        'Eventos',        'Gestión operativa de los expedientes y eventos', 1),
  (5, 'tecnico',        'Técnico',        'Usuarios, roles y permisos de la aplicación', 1);

-- Reparto inicial (se cambia después desde «Usuarios y permisos»)
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.value FROM roles r, json_each(CASE r.key
  WHEN 'jefes' THEN '["expedientes","expediente.open","expediente.close","pagos","payment.any_method","payment.receipt","payment.unpay","supplier.review","cobros","invoice.issue","po.manage","delete","settings"]'
  WHEN 'administracion' THEN '["expedientes","expediente.open","expediente.close","pagos","payment.any_method","payment.receipt","payment.unpay","supplier.review","cobros","invoice.issue","po.manage","delete","settings"]'
  WHEN 'tesoreria' THEN '["expedientes","pagos","payment.any_method","payment.receipt","payment.unpay","supplier.review","cobros","invoice.issue","po.manage"]'
  WHEN 'eventos' THEN '["expedientes","pagos"]'
  WHEN 'tecnico' THEN '["users"]'
END) p;

-- Usuarios: Administración → Administración, Gestión de eventos → Eventos
ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id);
UPDATE users SET role_id = CASE role WHEN 'admin' THEN 2 ELSE 4 END;
ALTER TABLE users DROP COLUMN role;
CREATE INDEX idx_users_role ON users(role_id);

-- Invitaciones pendientes: igual
ALTER TABLE invites ADD COLUMN role_id INTEGER REFERENCES roles(id);
UPDATE invites SET role_id = CASE role WHEN 'admin' THEN 2 ELSE 4 END;
ALTER TABLE invites DROP COLUMN role;

-- Todo usuario e invitación tiene rol (ALTER TABLE no permite añadir la columna como NOT NULL)
CREATE TRIGGER users_role_required BEFORE INSERT ON users WHEN NEW.role_id IS NULL
BEGIN SELECT RAISE(ABORT, 'Cada usuario necesita un rol'); END;
CREATE TRIGGER users_role_required_update BEFORE UPDATE OF role_id ON users WHEN NEW.role_id IS NULL
BEGIN SELECT RAISE(ABORT, 'Cada usuario necesita un rol'); END;
CREATE TRIGGER invites_role_required BEFORE INSERT ON invites WHEN NEW.role_id IS NULL
BEGIN SELECT RAISE(ABORT, 'Cada invitación necesita un rol'); END;
