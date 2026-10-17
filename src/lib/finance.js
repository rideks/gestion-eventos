// Reglas del negocio: estados, totales del expediente, próximos pasos y cierre.
// Funciones puras (sin base de datos) para poder probarlas con `npm test`.

import { daysBetween, isDate } from './dates.js';
import { eur } from './money.js';

/** '1 pago' · '3 pagos' */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Días antes del vencimiento en los que un pago se marca como «vence pronto» */
export const SOON_DAYS = 7;

export const PAYMENT_METHODS = {
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta (TC)',
  domiciliacion: 'Domiciliación',
  efectivo: 'Efectivo',
  otro: 'Otro',
};

// ── Estados ────────────────────────────────────────────────────────────────
// tone → clase .pill-<tone> (ok, warn, danger, info, accent, muted)

export function expedienteState(e, now) {
  if (e.status === 'solicitado') return { key: 'solicitado', label: 'Por abrir', tone: 'warn' };
  if (e.status === 'cerrado') return { key: 'cerrado', label: 'Cerrado', tone: 'muted' };
  if (e.status === 'cancelado') return { key: 'cancelado', label: 'Cancelado', tone: 'danger' };
  const last = e.end_date || e.start_date;
  if (isDate(last) && last < now) return { key: 'por_cerrar', label: 'Celebrado · por cerrar', tone: 'info' };
  return { key: 'abierto', label: 'En curso', tone: 'ok' };
}

export function paymentState(p, now) {
  if (p.status === 'pagado') return { key: 'pagado', label: 'Pagado', tone: 'ok' };
  if (isDate(p.due_date)) {
    const d = daysBetween(now, p.due_date);
    if (d < 0) return { key: 'vencido', label: 'Vencido', tone: 'danger' };
    if (d <= SOON_DAYS) return { key: 'pronto', label: d === 0 ? 'Vence hoy' : 'Vence pronto', tone: 'warn' };
  }
  if (!p.supplier_invoice_id && p.planned) return { key: 'previsto', label: 'Previsto', tone: 'muted' };
  return { key: 'pendiente', label: 'Por pagar', tone: 'info' };
}

/**
 * Factura del proveedor de un pago:
 *  · sin factura (en rojo si ya está pagado: hay que reclamarla)
 *  · subida y pendiente de que Administración la revise (naranja)
 *  · revisada y conforme (verde)
 */
export function supplierInvoiceState(p) {
  if (!p.supplier_invoice_id) {
    if (p.total_cents === 0) return null;
    return p.status === 'pagado'
      ? { key: 'falta', label: 'Falta factura', tone: 'danger' }
      : { key: 'sin', label: 'Sin factura', tone: 'muted' };
  }
  return p.invoice_review === 'conforme'
    ? { key: 'conforme', label: 'Con factura', tone: 'ok' }
    : { key: 'revisar', label: 'Factura por revisar', tone: 'orange' };
}

export function invoiceState(i, now) {
  if (i.status === 'por_emitir') return { key: 'por_emitir', label: 'Por emitir', tone: 'warn' };
  if (i.status === 'cobrada') return { key: 'cobrada', label: 'Cobrada', tone: 'ok' };
  if (i.status === 'anulada') return { key: 'anulada', label: 'Anulada', tone: 'muted' };
  if (isDate(i.due_date) && i.due_date < now) return { key: 'vencida', label: 'Cobro vencido', tone: 'danger' };
  return { key: 'emitida', label: 'Pendiente de cobro', tone: 'info' };
}

// ── Totales ────────────────────────────────────────────────────────────────
const sum = (rows, field) => rows.reduce((acc, r) => acc + (r[field] ?? 0), 0);

/**
 * Totales de un expediente.
 * @param {{ budget?: any, payments: any[], pos: any[], invoices: any[], allocations: any[] }} data
 *   allocations: filas de invoice_pos ({ invoice_id, po_id, amount_cents })
 */
export function summarize({ budget = null, payments = [], pos = [], invoices = [], allocations = [] }, now) {
  // Venta prevista: el presupuesto vigente (última versión)
  const sale = { base: budget?.base_cents ?? 0, total: budget?.total_cents ?? 0 };

  // Costes: todas las filas de proveedores (previstas y con factura)
  const cost = { base: sum(payments, 'base_cents'), total: sum(payments, 'total_cents') };
  const paidRows = payments.filter((p) => p.status === 'pagado');
  const pendingRows = payments.filter((p) => p.status !== 'pagado');
  const paid = sum(paidRows, 'total_cents');
  const toPay = sum(pendingRows, 'total_cents');
  const overdue = pendingRows.filter((p) => isDate(p.due_date) && p.due_date < now);
  const soon = pendingRows.filter((p) => isDate(p.due_date) && p.due_date >= now && daysBetween(now, p.due_date) <= SOON_DAYS);
  const withoutInvoice = payments.filter((p) => !p.supplier_invoice_id && p.total_cents !== 0);
  const paidWithoutInvoice = withoutInvoice.filter((p) => p.status === 'pagado');
  // Facturas subidas que Administración aún no ha revisado (una factura puede cubrir varios pagos)
  const toReview = [...new Set(payments.filter((p) => p.supplier_invoice_id && p.invoice_review !== 'conforme').map((p) => p.supplier_invoice_id))];

  // Facturas al cliente (las anuladas no cuentan)
  const live = invoices.filter((i) => i.status !== 'anulada');
  const issued = live.filter((i) => i.status === 'emitida' || i.status === 'cobrada');
  const toIssue = live.filter((i) => i.status === 'por_emitir');
  const collectedRows = live.filter((i) => i.status === 'cobrada');
  const uncollected = live.filter((i) => i.status === 'emitida');
  const overdueInvoices = uncollected.filter((i) => isDate(i.due_date) && i.due_date < now);
  const sales = { base: sum(live, 'base_cents'), total: sum(live, 'total_cents') };
  const invoiced = { base: sum(issued, 'base_cents'), total: sum(issued, 'total_cents') };
  const collected = sum(collectedRows, 'total_cents');
  const toCollect = sum(uncollected, 'total_cents');

  // PO: cuánto de cada una se ha llevado ya a facturas (no anuladas)
  const liveIds = new Set(live.map((i) => i.id));
  const usedByPo = new Map();
  for (const a of allocations) {
    if (!liveIds.has(a.invoice_id)) continue;
    usedByPo.set(a.po_id, (usedByPo.get(a.po_id) ?? 0) + a.amount_cents);
  }
  // left_cents: lo que falta por facturar; billable_cents: lo que aún se puede facturar
  // (una PO cerrada ya no espera más facturas: su resto no cuenta como pendiente)
  const poRows = pos.map((po) => {
    const used = usedByPo.get(po.id) ?? 0;
    const left = po.amount_cents - used;
    const closed = !!po.closed_at;
    return { ...po, used_cents: used, left_cents: left, closed, billable_cents: closed ? 0 : left };
  });
  const poTotal = sum(pos, 'amount_cents');
  const poLeft = poRows.reduce((acc, p) => acc + Math.max(0, p.billable_cents), 0);
  const poClosedLeft = poRows.reduce((acc, p) => acc + (p.closed ? Math.max(0, p.left_cents) : 0), 0);
  // Presupuesto que aún no está respaldado por ninguna PO
  const poMissing = Math.max(0, sale.base - poTotal);

  // Margen: previsto (presupuesto − costes) y real (lo facturado − costes)
  const expectedMargin = sale.base - cost.base;
  const margin = sales.base - cost.base;

  return {
    sale, cost, paid, toPay, pending: pendingRows, overdue, soon, withoutInvoice, paidWithoutInvoice, toReview,
    sales, invoiced, collected, toCollect, toIssue, uncollected, overdueInvoices,
    poRows, poTotal, poLeft, poClosedLeft, poMissing,
    expectedMargin, margin,
    // Venta del cierre: lo facturado (o pedido) si ya hay facturas; si no, el presupuesto
    closingSales: live.length ? sales : sale,
  };
}

/**
 * Próximos pasos de un expediente abierto, de lo más urgente a lo menos.
 * @returns {{ tone: string, text: string, tab: string }[]}
 */
export function nextSteps(e, s, now) {
  if (e.status !== 'abierto') return [];
  const steps = [];
  if (s.overdue.length) steps.push({ tone: 'danger', tab: 'pagos', text: `${plural(s.overdue.length, 'pago vencido', 'pagos vencidos')} a proveedores (${eur(sum(s.overdue, 'total_cents'))})` });
  if (s.overdueInvoices.length) steps.push({ tone: 'danger', tab: 'cobros', text: `${plural(s.overdueInvoices.length, 'factura', 'facturas')} con el cobro vencido (${eur(sum(s.overdueInvoices, 'total_cents'))})` });
  if (s.soon.length) steps.push({ tone: 'warn', tab: 'pagos', text: `${plural(s.soon.length, 'pago vence', 'pagos vencen')} en los próximos ${SOON_DAYS} días (${eur(sum(s.soon, 'total_cents'))})` });
  if (s.toIssue.length) steps.push({ tone: 'warn', tab: 'cobros', text: `${plural(s.toIssue.length, 'factura', 'facturas')} al cliente por emitir (${eur(sum(s.toIssue, 'total_cents'))})` });
  if (s.poLeft > 0) steps.push({ tone: 'warn', tab: 'cobros', text: `Hay ${eur(s.poLeft)} en PO sin facturar` });
  if (s.poMissing > 0 && s.sale.base > 0) steps.push({ tone: 'info', tab: 'cobros', text: `Faltan PO del cliente por ${eur(s.poMissing)} para cubrir el presupuesto` });
  if (s.toReview.length) steps.push({ tone: 'warn', tab: 'pagos', text: `${plural(s.toReview.length, 'factura de proveedor', 'facturas de proveedor')} por revisar` });
  if (s.paidWithoutInvoice.length) steps.push({ tone: 'info', tab: 'pagos', text: `${plural(s.paidWithoutInvoice.length, 'pago hecho', 'pagos hechos')} sin la factura del proveedor` });
  if (!s.sale.base) steps.push({ tone: 'info', tab: 'presupuesto', text: 'Falta el presupuesto aprobado por el cliente' });
  return steps;
}

/**
 * Comprobaciones antes de cerrar (lo que antes se cuadraba a mano en el Excel de cierre).
 * @returns {{ ok: boolean, text: string }[]}
 */
export function closingChecks(s) {
  return [
    { ok: !s.pending.length, text: s.pending.length ? `Quedan ${eur(s.toPay)} por pagar a proveedores` : 'Todos los proveedores están pagados' },
    { ok: s.withoutInvoice.length === 0, text: s.withoutInvoice.length ? `${s.withoutInvoice.length} ${s.withoutInvoice.length === 1 ? 'coste' : 'costes'} sin factura del proveedor` : 'Todos los costes tienen factura' },
    { ok: s.toReview.length === 0, text: s.toReview.length ? `${s.toReview.length} ${s.toReview.length === 1 ? 'factura de proveedor' : 'facturas de proveedor'} sin revisar` : 'Las facturas de proveedor están revisadas' },
    { ok: s.toIssue.length === 0, text: s.toIssue.length ? `${s.toIssue.length} ${s.toIssue.length === 1 ? 'factura' : 'facturas'} al cliente por emitir` : 'Todas las facturas al cliente están emitidas' },
    { ok: s.toCollect === 0, text: s.toCollect ? `Quedan ${eur(s.toCollect)} por cobrar` : 'Todo está cobrado' },
    {
      ok: s.poLeft === 0,
      text: s.poLeft ? `Hay ${eur(s.poLeft)} en PO sin facturar`
        : s.poClosedLeft ? `Las PO están facturadas o cerradas (${eur(s.poClosedLeft)} de PO cerradas no se facturan)` : 'Las PO están facturadas',
    },
  ];
}

/** Siguiente número de expediente: el mayor + 1 (o el primero configurado) */
export function nextNumber(maxNumber, firstNumber) {
  const first = Number(firstNumber) || 1;
  return Math.max(first, (Number(maxNumber) || 0) + 1);
}

/** 'EXP 1287' (o 'Solicitud' si aún no tiene número) */
export const expLabel = (e) => (e.number ? `EXP ${e.number}` : 'Solicitud');
