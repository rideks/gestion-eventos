-- ════════════════════════════════════════════════════════════════════════════
-- Índices para los historiales («Pagados» y «Cobradas»): se ordenan por fecha de pago / cobro
-- y se muestran los últimos 300. Con estos índices se leen en orden y se para al llegar a 300,
-- en vez de leer y ordenar todo el histórico en cada visita.
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX idx_payments_paid      ON payments(status, paid_on);
CREATE INDEX idx_invoices_collected ON invoices(status, collected_on);
