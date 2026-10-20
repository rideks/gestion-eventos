// @ts-check
// Reglas puras de la lista de expedientes (sin base de datos).

/**
 * Las pestañas de la lista: en curso (los abiertos que aún no se han celebrado), por cerrar (celebrados y sin
 * cerrar), míos (los abiertos que lleva quien mira), cerrados, cancelados y todos. El SQL de cada una está en
 * src/repos/expedientes.js.
 */
export const EXP_TABS = {
  curso: 'En curso', cerrar: 'Por cerrar', mios: 'Míos', cerrados: 'Cerrados', cancelados: 'Cancelados', todos: 'Todos',
};

/**
 * La venta de un expediente para la lista: lo facturado (si quien mira ve los cobros, o si ya está cerrado) o, si no,
 * el presupuesto vigente. El beneficio sólo se calcula al cerrar, como en el Cierre.
 * @param {{ status: string, sales_base?: number | null, budget_base?: number | null, cost_base?: number | null }} e
 * @param {boolean} cobros
 * @returns {{ sale: number, margin: number | null }}
 */
export function saleOf(e, cobros) {
  const closed = e.status === 'cerrado';
  const sale = ((cobros || closed) && e.sales_base) || e.budget_base || 0;
  return { sale, margin: closed ? sale - (e.cost_base ?? 0) : null };
}
