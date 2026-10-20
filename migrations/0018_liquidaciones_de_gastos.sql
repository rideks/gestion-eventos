-- ════════════════════════════════════════════════════════════════════════════
-- Liquidaciones de gastos: los gastos del evento que alguien adelanta de su bolsillo (taxis, material, comidas…)
-- y que no tienen factura de proveedor. Se apuntan como un pago más del expediente, de tipo «liquidación»:
-- cuentan en el coste, en el beneficio y en el Cierre, pero no en los avisos de factura (no la llevan).
-- La persona que adelantó el dinero se guarda en `supplier` (es a quien se le reembolsa) y `supplier_id` queda vacío
-- (no es un proveedor del directorio ni cuenta en sus cifras). El reembolso es el pago: pendiente → pagado.
--   · payments.kind: 'proveedor' (todos los de antes) o 'liquidacion'
--   · payments.spent_on: la fecha de los gastos · payments.sheet_file_id: la hoja de liquidación (con los tiques)
-- Sólo se añaden columnas: no se rehace ninguna tabla.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'proveedor' CHECK (kind IN ('proveedor', 'liquidacion'));
ALTER TABLE payments ADD COLUMN spent_on TEXT;
ALTER TABLE payments ADD COLUMN sheet_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL;
