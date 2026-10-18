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

/** Formas de pago que necesitan el justificante bancario para marcarse como pagadas */
export const RECEIPT_METHODS = ['transferencia'];
export const needsReceipt = (method) => RECEIPT_METHODS.includes(method);
export const RECEIPT_MISSING = 'Falta el justificante bancario de la transferencia: súbelo antes de marcar el pago como pagado.';

/** Documentos del proveedor: facturas (Administración las revisa) y proformas (no avisan a nadie) */
export const DOC_KINDS = { factura: 'Factura', proforma: 'Proforma' };

// ── El orden de un pago: ① justificante → ② pagado → ③ factura conforme ──────
export const WAITING_PAYMENT = 'Primero hay que hacer el pago (con su justificante): la factura se da por conforme después.';
export const PAID_LOCKED = 'El pago ya está hecho y no se puede modificar. Si hay un error, Administración puede «Deshacer pagado».';

/**
 * ¿Se puede dar por conforme una factura? Sólo cuando están hechos todos los pagos que cubre.
 * @param payments los pagos que cubre la factura ({ status })
 * @returns {string | null} por qué no, o null si se puede
 */
export function conformBlocker(payments) {
  if (!payments.length) return 'La factura no está en ningún pago.';
  return payments.every((p) => p.status === 'pagado') ? null : WAITING_PAYMENT;
}

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
  if (!p.invoice_count && p.planned) return { key: 'previsto', label: 'Previsto', tone: 'muted' };
  return { key: 'pendiente', label: 'Por pagar', tone: 'info' };
}

/**
 * Factura del proveedor de un pago (p.invoice_count, p.invoice_pending, p.proforma_count):
 *  · alguna factura sin revisar por Administración (naranja), aunque ya hubiera otra conforme
 *  · todas revisadas y conformes (verde)
 *  · sin factura: en rojo si ya está pagado (hay que reclamarla); si hay proforma, se indica
 */
export function supplierInvoiceState(p) {
  if (p.invoice_count > 0) {
    if (!p.invoice_pending) return { key: 'conforme', label: 'Con factura', tone: 'ok' };
    // Se revisa cuando el pago está hecho: hasta entonces la factura sólo está recibida
    return p.status === 'pagado'
      ? { key: 'revisar', label: 'Factura por revisar', tone: 'orange' }
      : { key: 'recibida', label: 'Factura recibida', tone: 'info' };
  }
  if (p.total_cents === 0 && !p.proforma_count) return null;
  if (p.status === 'pagado') return { key: 'falta', label: 'Falta factura', tone: 'danger' };
  if (p.proforma_count > 0) return { key: 'proforma', label: 'Con proforma', tone: 'info' };
  return { key: 'sin', label: 'Sin factura', tone: 'muted' };
}

/**
 * Estado de un documento del proveedor: proforma (sin revisión), factura conforme, por revisar
 * (el pago ya está hecho) o recibida (esperando al pago para revisarla).
 * @param paid ¿están hechos los pagos que cubre?
 */
export function documentState(d, paid = true) {
  if (d.kind === 'proforma') return { key: 'proforma', label: 'Proforma', tone: 'info' };
  if (d.review === 'conforme') return { key: 'conforme', label: 'Factura conforme', tone: 'ok' };
  return paid
    ? { key: 'revisar', label: 'Factura por revisar', tone: 'orange' }
    : { key: 'recibida', label: 'Factura recibida · espera al pago', tone: 'info' };
}

/** Envío al cliente de una factura emitida (y aún sin cobrar): enviada o sin enviar */
export function sentState(i) {
  if (i.status !== 'emitida') return null;
  return i.sent_at ? { key: 'enviada', label: 'Enviada', tone: 'ok' } : { key: 'sin_enviar', label: 'Sin enviar al cliente', tone: 'warn' };
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
export function summarize({ budget = null, payments = [], pos = [], invoices = [], allocations = [], documents = [] }, now) {
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
  // Una proforma no es una factura: el pago sigue «sin factura»
  const withoutInvoice = payments.filter((p) => !p.invoice_count && p.total_cents !== 0);
  const paidWithoutInvoice = withoutInvoice.filter((p) => p.status === 'pagado');
  // Facturas subidas que Administración aún no ha revisado (una factura puede cubrir varios pagos)
  const toReview = documents.filter((d) => d.kind === 'factura' && d.review !== 'conforme');

  // Facturas al cliente (las anuladas no cuentan)
  const live = invoices.filter((i) => i.status !== 'anulada');
  const issued = live.filter((i) => i.status === 'emitida' || i.status === 'cobrada');
  const toIssue = live.filter((i) => i.status === 'por_emitir');
  const collectedRows = live.filter((i) => i.status === 'cobrada');
  const uncollected = live.filter((i) => i.status === 'emitida');
  const unsent = uncollected.filter((i) => !i.sent_at);
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
    payments, sale, cost, paid, toPay, pending: pendingRows, overdue, soon, withoutInvoice, paidWithoutInvoice, toReview,
    sales, invoiced, collected, toCollect, toIssue, uncollected, unsent, overdueInvoices,
    poRows, poTotal, poLeft, poClosedLeft, poMissing,
    expectedMargin, margin,
    // Venta del cierre: lo facturado (o pedido) si ya hay facturas; si no, el presupuesto
    closingSales: live.length ? sales : sale,
  };
}

/**
 * Próximos pasos de un expediente abierto, de lo más urgente a lo menos.
 * path: a dónde lleva dentro del expediente; si el paso es de una sola cosa (un pago, una factura,
 * una PO), directamente a su ficha.
 * po: si quien mira gestiona las PO (Administración); si no, no salen los pasos de las PO.
 * @returns {{ tone: string, text: string, tab: string, path: string }[]}
 */
export function nextSteps(e, s, now, { po = true } = {}) {
  if (e.status !== 'abierto') return [];
  const steps = [];
  const add = (tone, tab, text, rows = [], one = null) => steps.push({ tone, tab, text, path: rows.length === 1 && one ? one(rows[0]) : tab });
  const toPayment = (p) => `pagos/${p.id}`;
  const toInvoice = (i) => `facturas/${i.id}`;
  if (s.overdue.length) add('danger', 'pagos', `${plural(s.overdue.length, 'pago vencido', 'pagos vencidos')} a proveedores (${eur(sum(s.overdue, 'total_cents'))})`, s.overdue, toPayment);
  if (s.overdueInvoices.length) add('danger', 'cobros', `${plural(s.overdueInvoices.length, 'factura', 'facturas')} con el cobro vencido (${eur(sum(s.overdueInvoices, 'total_cents'))})`, s.overdueInvoices, toInvoice);
  if (s.soon.length) add('warn', 'pagos', `${plural(s.soon.length, 'pago vence', 'pagos vencen')} en los próximos ${SOON_DAYS} días (${eur(sum(s.soon, 'total_cents'))})`, s.soon, toPayment);
  if (s.toIssue.length) add('warn', 'cobros', `${plural(s.toIssue.length, 'factura', 'facturas')} al cliente por emitir (${eur(sum(s.toIssue, 'total_cents'))})`, s.toIssue, toInvoice);
  if (s.unsent.length) add('warn', 'cobros', `${plural(s.unsent.length, 'factura emitida', 'facturas emitidas')} sin enviar al cliente`, s.unsent, (i) => `facturas/${i.id}#envio`);
  if (po && s.poLeft > 0) {
    const open = s.poRows.filter((p) => p.billable_cents > 0);
    add('warn', 'cobros', `Hay ${eur(s.poLeft)} en PO sin facturar`, open, (p) => `facturas/nueva?po=${p.id}`);
  }
  if (po && s.poMissing > 0 && s.sale.base > 0) steps.push({ tone: 'info', tab: 'cobros', text: `Faltan PO del cliente por ${eur(s.poMissing)} para cubrir el presupuesto`, path: 'cobros?nuevo=po' });
  // Sólo las que ya se pueden conformar (el pago está hecho); las demás esperan a su pago
  const toConform = s.payments.filter((p) => p.invoice_pending > 0 && p.status === 'pagado');
  if (toConform.length) {
    add('warn', 'pagos', `${plural(toConform.length, 'pago hecho', 'pagos hechos')} con la factura por conformar`, toConform, (p) => `pagos/${p.id}#factura`);
  }
  if (s.paidWithoutInvoice.length) add('info', 'pagos', `${plural(s.paidWithoutInvoice.length, 'pago hecho', 'pagos hechos')} sin la factura del proveedor`, s.paidWithoutInvoice, (p) => `pagos/${p.id}#factura`);
  if (!s.sale.base) steps.push({ tone: 'info', tab: 'presupuesto', text: 'Falta el presupuesto aprobado por el cliente', path: 'presupuesto' });
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
