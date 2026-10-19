-- ════════════════════════════════════════════════════════════════════════════
-- Proveedores: directorio con ficha (antes eran sólo un nombre escrito en cada pago).
--
--   · supplier_types     → tipos ampliables (hotel, venue, restaurante…): se añaden desde la aplicación.
--   · suppliers          → la ficha. El número de usos, los expedientes y el gasto NO se guardan:
--                          se calculan siempre desde los pagos (no se pueden quedar desactualizados).
--   · supplier_aliases   → nombres anteriores o de proveedores fusionados: al buscar en el selector
--                          de los pagos también se encuentran por ellos.
--   · payments.supplier_id / supplier_invoices.supplier_id → a qué proveedor pertenecen. El texto
--                          `supplier` se mantiene con el nombre (lo que se ve en listas y documentos).
--
-- Los nombres ya usados pasan a ser proveedores: sin espacios sobrantes y sin distinguir mayúsculas
-- («Hotel X» y «hotel x » son el mismo). Sólo se añaden tablas y columnas: no se borra nada.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE supplier_types (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
INSERT INTO supplier_types (name, sort) VALUES
  ('Hotel', 10), ('Venue / espacio', 20), ('Restaurante', 30), ('Catering', 40), ('Actividades', 50),
  ('Formación', 60), ('Transporte', 70), ('Audiovisuales', 80), ('Otros', 90);

-- status: activo · inactivo (ya no trabajamos con él) · bloqueado (no volver a contratar)
CREATE TABLE suppliers (
  id             INTEGER PRIMARY KEY,
  name           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  type_id        INTEGER REFERENCES supplier_types(id) ON DELETE SET NULL,
  status         TEXT    NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'inactivo', 'bloqueado')),
  city           TEXT,
  address        TEXT,
  contact_name   TEXT,                      -- comercial o persona de contacto
  phone          TEXT,
  email          TEXT,
  max_capacity   INTEGER,                   -- personas (hoteles, venues, restaurantes…)
  since_on       TEXT,                      -- inicio de la relación comercial, si se sabe
  economic_terms TEXT,                      -- condiciones económicas (tarifas, descuentos…)
  payment_terms  TEXT,                      -- condiciones de crédito y de pago
  notes          TEXT,                      -- comentarios internos
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_suppliers_type ON suppliers(type_id, status);

CREATE TABLE supplier_aliases (
  alias       TEXT    PRIMARY KEY COLLATE NOCASE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE
);
CREATE INDEX idx_supplier_aliases_supplier ON supplier_aliases(supplier_id);

ALTER TABLE payments ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);
ALTER TABLE supplier_invoices ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);
CREATE INDEX idx_payments_supplier ON payments(supplier_id);
CREATE INDEX idx_supplier_invoices_supplier ON supplier_invoices(supplier_id);

-- Alta de los proveedores que ya aparecen en pagos y documentos
INSERT INTO suppliers (name)
SELECT TRIM(supplier) FROM payments WHERE TRIM(supplier) <> ''
UNION
SELECT TRIM(supplier) FROM supplier_invoices WHERE TRIM(supplier) <> ''
ON CONFLICT (name) DO NOTHING;
UPDATE payments SET supplier_id = (SELECT s.id FROM suppliers s WHERE s.name = TRIM(payments.supplier));
UPDATE supplier_invoices SET supplier_id = (SELECT s.id FROM suppliers s WHERE s.name = TRIM(supplier_invoices.supplier));
-- El nombre que se ve, el de la ficha (igual para todas las variantes)
UPDATE payments SET supplier = (SELECT s.name FROM suppliers s WHERE s.id = payments.supplier_id) WHERE supplier_id IS NOT NULL;
UPDATE supplier_invoices SET supplier = (SELECT s.name FROM suppliers s WHERE s.id = supplier_invoices.supplier_id) WHERE supplier_id IS NOT NULL;

-- Permisos nuevos (reparto aprobado): ver proveedores, darlos de alta, editarlos y fusionarlos,
-- y ver sus condiciones y el gasto. Eventos también da de alta (es quien contrata).
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.value FROM roles r, json_each(CASE r.key
  WHEN 'jefes' THEN '["proveedores","proveedores.create","proveedores.edit","proveedores.gasto"]'
  WHEN 'administracion' THEN '["proveedores","proveedores.create","proveedores.edit","proveedores.gasto"]'
  WHEN 'tesoreria' THEN '["proveedores","proveedores.create","proveedores.edit","proveedores.gasto"]'
  WHEN 'eventos' THEN '["proveedores","proveedores.create"]'
END) p
WHERE true
ON CONFLICT DO NOTHING;
