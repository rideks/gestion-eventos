-- ════════════════════════════════════════════════════════════════════════════
-- Facturas al cliente hechas desde la aplicación
--
--  · Número automático, correlativo y ÚNICO: se asigna al emitir con el formato de Ajustes
--    (invoice_pattern, p. ej. G/{n}/{yy}/01) y el contador del año (invoice_next:2026).
--    El índice único impide que dos facturas tengan el mismo número.
--  · Datos fiscales del cliente en la factura (aún no hay fichas de clientes): NIF/CIF,
--    dirección fiscal y el email al que se envía.
--  · Envío al cliente (de momento simulado): cuándo, a quién y quién.
--  · Datos del emisor (Seven Worlds) en settings: company_legal_name, company_tax_id,
--    company_address, company_iban, company_email (se rellenan en Ajustes).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE invoices ADD COLUMN billed_tax_id  TEXT;
ALTER TABLE invoices ADD COLUMN billed_address TEXT;
ALTER TABLE invoices ADD COLUMN billed_email   TEXT;
ALTER TABLE invoices ADD COLUMN sent_at        TEXT;
ALTER TABLE invoices ADD COLUMN sent_to        TEXT;
ALTER TABLE invoices ADD COLUMN sent_by        INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_invoices_number ON invoices(number) WHERE number IS NOT NULL;

INSERT OR IGNORE INTO settings (key, value) VALUES ('invoice_pattern', 'G/{n}/{yy}/01');

-- Las facturas ya emitidas antes de esto se enviaron por fuera de la aplicación: cuentan como enviadas
UPDATE invoices SET sent_at = COALESCE(issued_on, created_at)
 WHERE status IN ('emitida', 'cobrada') AND sent_at IS NULL;
