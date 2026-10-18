-- ════════════════════════════════════════════════════════════════════════════
-- Proformas, varios documentos por pago y justificante de pago
--
--  · supplier_invoices guarda ahora los DOCUMENTOS del proveedor: facturas y proformas
--    (kind). Sólo las facturas pasan por la revisión de Administración; las proformas no
--    avisan a nadie.
--  · Un pago puede tener varias facturas y varias proformas, y un documento puede seguir
--    cubriendo varios pagos (dos anticipos y una única factura): tabla payment_documents.
--    payments.supplier_invoice_id queda sin uso.
--  · notes: el comentario de quien sube el documento (p. ej. por qué se sube otra factura
--    cuando ya había una conforme, que no se puede borrar).
--  · payments.receipt_file_id: el justificante bancario del pago. Sin él no se puede marcar
--    como pagado un pago por transferencia.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE supplier_invoices ADD COLUMN kind TEXT NOT NULL DEFAULT 'factura' CHECK (kind IN ('factura', 'proforma'));
CREATE INDEX idx_supplier_invoices_kind ON supplier_invoices(kind, review);

CREATE TABLE payment_documents (
  payment_id  INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  PRIMARY KEY (payment_id, document_id)
);
CREATE INDEX idx_payment_documents_document ON payment_documents(document_id);

INSERT INTO payment_documents (payment_id, document_id)
SELECT id, supplier_invoice_id FROM payments WHERE supplier_invoice_id IS NOT NULL;
UPDATE payments SET supplier_invoice_id = NULL;

ALTER TABLE payments ADD COLUMN receipt_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL;
