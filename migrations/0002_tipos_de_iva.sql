-- ════════════════════════════════════════════════════════════════════════════
-- Tipos de IVA centralizados y desglose por tipo en cada importe
--
--  · vat_rates: la lista que sale en todos los desplegables. Se gestiona desde
--    Ajustes (añadir, quitar, marcar el de por defecto). El tipo va en puntos
--    básicos: 21 % → 2100 · 9,5 % → 950 (así admite decimales sin redondeos).
--  · vat_lines: el desglose de cada importe, en JSON:
--      [{"rate":1000,"label":"IVA 10 %","base":82145,"total":90360},
--       {"rate":2100,"label":"IVA 21 %","base":198347,"total":240000}]
--    "rate": null = tipo escrito a mano (se respetan base y total tal cual).
--    Cada línea guarda su tipo y su nombre: quitar un tipo de la lista no cambia
--    nada de lo ya guardado. base_cents y total_cents siguen siendo las sumas.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE vat_rates (
  id         INTEGER PRIMARY KEY,
  label      TEXT    NOT NULL,
  rate_bp    INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
INSERT INTO vat_rates (label, rate_bp, is_default) VALUES
  ('IVA 21 %', 2100, 1),
  ('IVA 10 %', 1000, 0),
  ('IGIC 7 %', 700, 0),
  ('IVA 4 %', 400, 0),
  ('Exento 0 %', 0, 0);

ALTER TABLE budgets  ADD COLUMN vat_lines TEXT;
ALTER TABLE payments ADD COLUMN vat_lines TEXT;
ALTER TABLE invoices ADD COLUMN vat_lines TEXT;

-- Lo ya guardado pasa a tener una línea con su tipo ('mixto' → tipo a mano)
UPDATE budgets SET vat_lines = json_array(json_object('rate', NULL, 'label', 'Varios tipos', 'base', base_cents, 'total', total_cents));
UPDATE payments SET vat_lines = json_array(json_object(
  'rate', CASE WHEN vat = 'mixto' THEN NULL ELSE CAST(vat AS INTEGER) * 100 END,
  'label', CASE WHEN vat = 'mixto' THEN 'Varios tipos' WHEN vat = '0' THEN 'Exento 0 %' ELSE 'IVA ' || vat || ' %' END,
  'base', base_cents, 'total', total_cents));
UPDATE invoices SET vat_lines = json_array(json_object(
  'rate', CASE WHEN vat = 'mixto' THEN NULL ELSE CAST(vat AS INTEGER) * 100 END,
  'label', CASE WHEN vat = 'mixto' THEN 'Varios tipos' WHEN vat = '0' THEN 'Exento 0 %' ELSE 'IVA ' || vat || ' %' END,
  'base', base_cents, 'total', total_cents));
