-- ════════════════════════════════════════════════════════════════════════════
-- Beneficio previsto de cada versión del presupuesto (en %, guardado en puntos básicos: 15 % → 1500).
-- Lo que se espera ganar con ese presupuesto; se compara con el beneficio real (venta − costes).
-- Opcional: las versiones que ya existen quedan sin él (se puede añadir desde «Presupuesto»).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE budgets ADD COLUMN margin_bp INTEGER;
