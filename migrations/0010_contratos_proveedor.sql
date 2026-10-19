-- ════════════════════════════════════════════════════════════════════════════
-- Contratos y acuerdos con proveedores: uno o varios por proveedor, vigentes e históricos.
--
--   · supplier_contracts        → cada contrato con sus fechas y condiciones (tarifas, descuentos, crédito,
--                                 pago, otros acuerdos), el aviso antes de que caduque (días, por contrato:
--                                 sin plazo igual para todos) y la decisión sobre la renovación: «pendiente
--                                 de renovación» (hay que negociarla) o «no se renueva».
--                                 Al renovar se crea un contrato nuevo que apunta al anterior (replaces_id):
--                                 el anterior se conserva tal cual.
--   · supplier_contract_changes → historial de cada contrato: alta, cambios (qué campo, antes y después),
--                                 renovaciones y marcas.
--
-- El estado (vigente, próximo a caducar, caducado, renovado, finalizado) NO se guarda: se calcula por fechas
-- (src/lib/contracts.js). El contrato que se aplicó a un expediente es el que estaba en vigor en la fecha
-- del evento. Sólo se añaden tablas: no se toca nada de lo que ya hay.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE supplier_contracts (
  id              INTEGER PRIMARY KEY,
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
  title           TEXT    NOT NULL,                 -- «Tarifa de grupos 2026», «Acuerdo marco»…
  signed_on       TEXT,                             -- firma o creación
  starts_on       TEXT    NOT NULL,
  ends_on         TEXT,                             -- sin fecha = indefinido
  conditions      TEXT,                             -- condiciones del contrato
  rates           TEXT,                             -- tarifas acordadas
  discounts       TEXT,                             -- descuentos y condiciones especiales
  credit_terms    TEXT,                             -- condiciones de crédito
  payment_terms   TEXT,                             -- condiciones de pago
  other_terms     TEXT,                             -- otros acuerdos comerciales
  notes           TEXT,                             -- comentarios y observaciones
  alert_days      INTEGER CHECK (alert_days IS NULL OR alert_days BETWEEN 1 AND 730),
  renewal         TEXT    CHECK (renewal IS NULL OR renewal IN ('pendiente', 'no')),  -- sin decidir · pendiente de renovación · no se renueva
  replaces_id     INTEGER REFERENCES supplier_contracts(id) ON DELETE SET NULL,
  file_id         INTEGER REFERENCES files(id) ON DELETE SET NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX idx_supplier_contracts_supplier ON supplier_contracts(supplier_id, starts_on);
CREATE INDEX idx_supplier_contracts_ends ON supplier_contracts(ends_on);
-- Un contrato se renueva una sola vez (la renovación de la renovación es otro eslabón)
CREATE UNIQUE INDEX idx_supplier_contracts_replaces ON supplier_contracts(replaces_id) WHERE replaces_id IS NOT NULL;

CREATE TABLE supplier_contract_changes (
  id          INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES supplier_contracts(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL CHECK (action IN ('alta', 'cambio', 'renovacion', 'renovado', 'marca', 'documento')),
  summary     TEXT    NOT NULL,                     -- ya redactado: se lee igual aunque luego cambien los datos
  changes     TEXT,                                 -- JSON { campo: [antes, después] }
  at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_supplier_contract_changes ON supplier_contract_changes(contract_id, at);

-- Permisos nuevos (los de la tabla aprobada: contratos y condiciones, Jefes, Administración y Tesorería)
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.value FROM roles r, json_each('["contratos","contratos.edit"]') p
WHERE r.key IN ('jefes', 'administracion', 'tesoreria')
ON CONFLICT DO NOTHING;
