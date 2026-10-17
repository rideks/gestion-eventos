-- ════════════════════════════════════════════════════════════════════════════
-- PO cerradas
--
--  · Una PO se da por terminada cuando lo que queda sin facturar ya no se va a
--    facturar (el evento costó menos, el cliente recortó la PO…). Ese resto deja
--    de contar como «PO sin facturar» en el expediente, en Cobros y en el cierre.
--  · Se puede reabrir. Quién y cuándo queda aquí y en la actividad del expediente.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE purchase_orders ADD COLUMN closed_at   TEXT;
ALTER TABLE purchase_orders ADD COLUMN closed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN closed_note TEXT;
