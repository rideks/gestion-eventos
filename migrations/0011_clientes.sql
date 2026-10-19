-- ════════════════════════════════════════════════════════════════════════════
-- Clientes: ficha propia (antes cada expediente tenía sólo el nombre escrito en `company`).
--
--   · clients            → la ficha: nombre comercial, datos fiscales, contacto, acuerdo de pago, fee
--                          vigente (en puntos básicos: 10 % → 1000) y comentarios. El nº de expedientes,
--                          la antigüedad y los importes NO se guardan: se calculan desde los expedientes.
--   · client_aliases     → nombres anteriores o de clientes fusionados (también se encuentran por ellos).
--   · client_entities    → otras entidades a las que se factura (p. ej. los concesionarios de BMW).
--   · change_log         → historial común de cambios (qué, antes y después, quién y cuándo). Lo usan los
--                          clientes para sus condiciones; las áreas que vengan después, también.
--   · expedientes.client_id → a qué cliente pertenece; `company` se mantiene con el nombre (lo que se ve).
--   · expedientes.fee_bp    → el fee que se aplicó a ESE expediente (se copia del cliente al pedirlo):
--                             cambiar el fee del cliente no cambia el de los expedientes anteriores.
--
-- Los nombres ya usados pasan a ser clientes (sin distinguir mayúsculas ni espacios sobrantes) y los datos
-- fiscales de las facturas ya emitidas pasan a la ficha (el cliente) o a sus entidades (el resto).
-- Sólo se añaden tablas y columnas: no se borra nada. No se inventa ningún fee: queda vacío.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE clients (
  id             INTEGER PRIMARY KEY,
  name           TEXT    NOT NULL UNIQUE COLLATE NOCASE,   -- nombre comercial (el que se ve)
  status         TEXT    NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'inactivo')),
  legal_name     TEXT,                                     -- nombre fiscal
  tax_id         TEXT,                                     -- NIF / CIF
  fiscal_address TEXT,
  city           TEXT,
  phone          TEXT,
  email          TEXT,
  billing_email  TEXT,                                     -- a dónde se envían las facturas
  payment_terms  TEXT,                                     -- acuerdo de pago
  fee_bp         INTEGER CHECK (fee_bp IS NULL OR fee_bp BETWEEN 0 AND 10000),
  since_on       TEXT,                                     -- inicio de la relación, si se sabe
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE client_aliases (
  alias     TEXT    PRIMARY KEY COLLATE NOCASE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE
);
CREATE INDEX idx_client_aliases_client ON client_aliases(client_id);

CREATE TABLE client_entities (
  id             INTEGER PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  legal_name     TEXT    NOT NULL,
  tax_id         TEXT,
  fiscal_address TEXT,
  email          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_client_entities_client ON client_entities(client_id);
-- Una misma entidad (por su NIF) no se repite dentro de un cliente
CREATE UNIQUE INDEX idx_client_entities_tax ON client_entities(client_id, tax_id) WHERE tax_id IS NOT NULL;

CREATE TABLE change_log (
  id        INTEGER PRIMARY KEY,
  entity    TEXT    NOT NULL CHECK (entity IN ('client')),
  entity_id INTEGER NOT NULL,
  user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action    TEXT    NOT NULL,                 -- alta · condiciones · datos · fusion…
  summary   TEXT    NOT NULL,                 -- ya redactado: se lee igual aunque luego cambien los datos
  changes   TEXT,                             -- JSON { campo: [antes, después] }
  at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_change_log_entity ON change_log(entity, entity_id, at);

ALTER TABLE expedientes ADD COLUMN client_id INTEGER REFERENCES clients(id);
ALTER TABLE expedientes ADD COLUMN fee_bp INTEGER;
CREATE INDEX idx_expedientes_client ON expedientes(client_id, start_date);

-- Alta de los clientes que ya aparecen en los expedientes (si se escribió de varias formas, se queda la
-- del expediente más reciente)
INSERT INTO clients (name)
SELECT TRIM(company) FROM expedientes WHERE TRIM(company) <> '' ORDER BY id DESC
ON CONFLICT (name) DO NOTHING;
UPDATE expedientes SET client_id = (SELECT c.id FROM clients c WHERE c.name = TRIM(expedientes.company));
-- El nombre que se ve, el de la ficha (igual para todas las variantes)
UPDATE expedientes SET company = (SELECT c.name FROM clients c WHERE c.id = expedientes.client_id) WHERE client_id IS NOT NULL;

-- Datos fiscales del propio cliente: los de su factura más reciente facturada a su nombre
UPDATE clients SET
  legal_name     = (SELECT i.billed_to FROM invoices i JOIN expedientes e ON e.id = i.expediente_id
                     WHERE e.client_id = clients.id AND i.billed_to = clients.name COLLATE NOCASE AND i.billed_tax_id IS NOT NULL ORDER BY i.id DESC LIMIT 1),
  tax_id         = (SELECT i.billed_tax_id FROM invoices i JOIN expedientes e ON e.id = i.expediente_id
                     WHERE e.client_id = clients.id AND i.billed_to = clients.name COLLATE NOCASE AND i.billed_tax_id IS NOT NULL ORDER BY i.id DESC LIMIT 1),
  fiscal_address = (SELECT i.billed_address FROM invoices i JOIN expedientes e ON e.id = i.expediente_id
                     WHERE e.client_id = clients.id AND i.billed_to = clients.name COLLATE NOCASE AND i.billed_tax_id IS NOT NULL ORDER BY i.id DESC LIMIT 1),
  billing_email  = (SELECT i.billed_email FROM invoices i JOIN expedientes e ON e.id = i.expediente_id
                     WHERE e.client_id = clients.id AND i.billed_to = clients.name COLLATE NOCASE AND i.billed_tax_id IS NOT NULL ORDER BY i.id DESC LIMIT 1);

-- El resto de entidades a las que se ha facturado (una por NIF y cliente; con los datos de su última factura)
INSERT INTO client_entities (client_id, legal_name, tax_id, fiscal_address, email)
SELECT e.client_id, i.billed_to, i.billed_tax_id, i.billed_address, i.billed_email
  FROM invoices i JOIN expedientes e ON e.id = i.expediente_id
 WHERE e.client_id IS NOT NULL AND i.billed_tax_id IS NOT NULL
   AND i.billed_tax_id <> COALESCE((SELECT c.tax_id FROM clients c WHERE c.id = e.client_id), '')
   AND i.id = (SELECT MAX(j.id) FROM invoices j JOIN expedientes f ON f.id = j.expediente_id
                WHERE f.client_id = e.client_id AND j.billed_tax_id = i.billed_tax_id)
ON CONFLICT DO NOTHING;

-- Permisos nuevos: ver clientes (todos los que trabajan con expedientes), darlos de alta (también Eventos,
-- que pide los expedientes), editarlos y ver sus datos fiscales, condiciones e importes (Jefes, Administración
-- y Tesorería, como en la tabla aprobada)
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.value FROM roles r, json_each(CASE r.key
  WHEN 'jefes' THEN '["clientes","clientes.create","clientes.edit","clientes.economia"]'
  WHEN 'administracion' THEN '["clientes","clientes.create","clientes.edit","clientes.economia"]'
  WHEN 'tesoreria' THEN '["clientes","clientes.create","clientes.edit","clientes.economia"]'
  WHEN 'eventos' THEN '["clientes","clientes.create"]'
END) p
WHERE true
ON CONFLICT DO NOTHING;
