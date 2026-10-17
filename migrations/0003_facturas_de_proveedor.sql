-- ════════════════════════════════════════════════════════════════════════════
-- Facturas de proveedor separadas de los pagos, con revisión de Administración
--
--  · Una factura (número, fecha, PDF) puede cubrir VARIOS pagos: el hotel cobra dos
--    anticipos y luego manda una única factura. Cada pago apunta a su factura.
--  · Revisión: quien sube la factura la deja «pendiente»; Administración la abre,
--    anota el número y la da por «conforme».
--  · total_cents (opcional): el total de la factura, para comprobar que cuadra con
--    la suma de los pagos que cubre.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE supplier_invoices (
  id            INTEGER PRIMARY KEY,
  expediente_id INTEGER NOT NULL REFERENCES expedientes(id) ON DELETE CASCADE,
  supplier      TEXT    NOT NULL,
  number        TEXT,
  issued_on     TEXT,
  total_cents   INTEGER,
  file_id       INTEGER REFERENCES files(id) ON DELETE SET NULL,
  review        TEXT    NOT NULL DEFAULT 'pendiente' CHECK (review IN ('pendiente', 'conforme')),
  reviewed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TEXT,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  notes         TEXT
);
CREATE INDEX idx_supplier_invoices_expediente ON supplier_invoices(expediente_id);
CREATE INDEX idx_supplier_invoices_review     ON supplier_invoices(review);

ALTER TABLE payments ADD COLUMN supplier_invoice_id INTEGER REFERENCES supplier_invoices(id) ON DELETE SET NULL;
CREATE INDEX idx_payments_invoice ON payments(supplier_invoice_id);

-- Lo ya guardado: cada nº de factura (o documento suelto) de un proveedor pasa a ser una factura.
-- Se dan por revisadas para no llenar de golpe la bandeja de Administración.
INSERT INTO supplier_invoices (expediente_id, supplier, number, issued_on, file_id, review, uploaded_by, uploaded_at)
SELECT expediente_id, supplier, invoice_number, MIN(invoice_date), MAX(file_id), 'conforme', MIN(created_by), MIN(created_at)
  FROM payments
 WHERE invoice_number IS NOT NULL OR file_id IS NOT NULL
 GROUP BY expediente_id, supplier, COALESCE(invoice_number, 'doc-' || file_id);

UPDATE payments SET supplier_invoice_id = (
  SELECT si.id FROM supplier_invoices si
   WHERE si.expediente_id = payments.expediente_id AND si.supplier = payments.supplier
     AND ((payments.invoice_number IS NOT NULL AND si.number = payments.invoice_number)
       OR (payments.invoice_number IS NULL AND si.number IS NULL AND si.file_id = payments.file_id))
) WHERE invoice_number IS NOT NULL OR file_id IS NOT NULL;

-- payments.invoice_number, invoice_date y file_id quedan sin uso (la factura está en supplier_invoices)
UPDATE payments SET invoice_number = NULL, invoice_date = NULL, file_id = NULL;
