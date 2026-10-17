import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, nextSteps, closingChecks, paymentState, invoiceState, expedienteState, supplierInvoiceState, nextNumber } from '../src/lib/finance.js';
import { PaymentSchema, forecastRowSchema, PoSchema, ExpedienteSchema, VatRateSchema, SupplierInvoiceSchema, ConformSchema, parseAllocations, validate } from '../src/lib/validate.js';
import { formatRange, dueText, addDays, isDate } from '../src/lib/dates.js';

const NOW = '2026-08-20';

// Cierre del EXP 1287 (Workshop BMW) del Excel de ejemplo, simplificado
// supplier_invoice_id: la factura del proveedor (una factura puede cubrir varios pagos)
const payments = [
  { id: 1, supplier: 'Hotel Barceló Valladolid', supplier_invoice_id: 101, invoice_review: 'conforme', invoice_number: '10000001225', base_cents: 238182, total_cents: 262000, status: 'pagado', planned: 1 },
  { id: 2, supplier: 'Hotel Barceló Valladolid', supplier_invoice_id: 102, invoice_review: 'conforme', invoice_number: 'NT/000086/26', base_cents: -23255, total_cents: -39150, status: 'pagado', planned: 0 },
  { id: 3, supplier: 'AV Sistemas', supplier_invoice_id: 103, invoice_review: 'pendiente', invoice_number: '238', base_cents: 277406, total_cents: 335661, status: 'pendiente', due_date: '2026-08-10', planned: 1 },
  { id: 4, supplier: 'Gráficas Mercurio', supplier_invoice_id: null, base_cents: 39100, total_cents: 47311, status: 'pendiente', due_date: '2026-08-25', planned: 1 },
  { id: 5, supplier: 'Mentimeter', supplier_invoice_id: null, base_cents: 16800, total_cents: 20328, status: 'pagado', planned: 0 },
];
const pos = [
  { id: 10, number: 'PO-4500123', amount_cents: 1452046 },
  { id: 11, number: 'PO-4500200', amount_cents: 3390220 },
];
const invoices = [
  { id: 20, number: 'G/000808/26/01', base_cents: 1452046, total_cents: 1667777, status: 'cobrada' },
  { id: 21, number: 'G/000852/26/01', base_cents: 1998000, total_cents: 2292198, status: 'emitida', due_date: '2026-08-01' },
  { id: 22, number: null, base_cents: 1392220, total_cents: 1600000, status: 'por_emitir' },
  { id: 23, number: 'G/000800/26/01', base_cents: 50000, total_cents: 60500, status: 'anulada' },
];
const allocations = [
  { invoice_id: 20, po_id: 10, amount_cents: 1452046 },
  { invoice_id: 21, po_id: 11, amount_cents: 1998000 },
  { invoice_id: 23, po_id: 11, amount_cents: 50000 }, // anulada: no cuenta
];
const budget = { base_cents: 5000000, total_cents: 6000000 };

test('summarize: costes, ventas, PO y margen', () => {
  const s = summarize({ budget, payments, pos, invoices, allocations }, NOW);
  assert.equal(s.cost.base, 238182 - 23255 + 277406 + 39100 + 16800);
  assert.equal(s.paid, 262000 - 39150 + 20328);
  assert.equal(s.toPay, 335661 + 47311);
  assert.deepEqual(s.overdue.map((p) => p.id), [3]);
  assert.deepEqual(s.soon.map((p) => p.id), [4]);
  assert.deepEqual(s.withoutInvoice.map((p) => p.id), [4, 5]);
  assert.deepEqual(s.paidWithoutInvoice.map((p) => p.id), [5]);
  assert.deepEqual(s.toReview, [103]);
  // Ventas: sin la anulada, con la que está por emitir
  assert.equal(s.sales.base, 1452046 + 1998000 + 1392220);
  assert.equal(s.invoiced.base, 1452046 + 1998000);
  assert.equal(s.collected, 1667777);
  assert.equal(s.toCollect, 2292198);
  assert.deepEqual(s.overdueInvoices.map((i) => i.id), [21]);
  // PO: la 11 tiene 33.902,20 y se han facturado 19.980,00 (la anulada no cuenta)
  assert.equal(s.poRows.find((p) => p.id === 11).left_cents, 3390220 - 1998000);
  assert.equal(s.poLeft, 3390220 - 1998000);
  assert.equal(s.poTotal, 1452046 + 3390220);
  assert.equal(s.poMissing, 5000000 - (1452046 + 3390220));
  assert.equal(s.margin, s.sales.base - s.cost.base);
  assert.equal(s.expectedMargin, 5000000 - s.cost.base);
});

test('summarize: expediente vacío', () => {
  const s = summarize({}, NOW);
  assert.equal(s.cost.base, 0);
  assert.equal(s.sales.base, 0);
  assert.equal(s.poMissing, 0);
  assert.deepEqual(s.closingSales, { base: 0, total: 0 });
});

test('nextSteps y closingChecks', () => {
  const s = summarize({ budget, payments, pos, invoices, allocations }, NOW);
  const steps = nextSteps({ status: 'abierto' }, s, NOW);
  assert.equal(steps[0].tone, 'danger');
  assert.match(steps[0].text, /1 pago vencido/);
  assert.ok(steps.some((x) => /por emitir/.test(x.text)));
  assert.ok(steps.some((x) => /PO sin facturar/.test(x.text)));
  assert.ok(steps.some((x) => /1 factura de proveedor por revisar/.test(x.text)));
  assert.deepEqual(nextSteps({ status: 'cerrado' }, s, NOW), []);
  assert.ok(closingChecks(s).every((c) => !c.ok));

  const done = summarize({
    budget,
    payments: [{ id: 1, supplier_invoice_id: 1, invoice_review: 'conforme', invoice_number: 'F1', base_cents: 100, total_cents: 121, status: 'pagado' }],
    pos: [{ id: 1, amount_cents: 1000 }],
    invoices: [{ id: 1, base_cents: 1000, total_cents: 1210, status: 'cobrada' }],
    allocations: [{ invoice_id: 1, po_id: 1, amount_cents: 1000 }],
  }, NOW);
  assert.ok(closingChecks(done).every((c) => c.ok));
});

test('estados', () => {
  assert.equal(paymentState({ status: 'pagado' }, NOW).key, 'pagado');
  assert.equal(paymentState({ status: 'pendiente', due_date: '2026-08-19' }, NOW).key, 'vencido');
  assert.equal(paymentState({ status: 'pendiente', due_date: NOW }, NOW).label, 'Vence hoy');
  assert.equal(paymentState({ status: 'pendiente', due_date: '2026-08-27' }, NOW).key, 'pronto');
  assert.equal(paymentState({ status: 'pendiente', due_date: '2026-09-30', planned: 1 }, NOW).key, 'previsto');
  assert.equal(paymentState({ status: 'pendiente', supplier_invoice_id: 7 }, NOW).key, 'pendiente');
  assert.equal(invoiceState({ status: 'emitida', due_date: '2026-08-01' }, NOW).key, 'vencida');
  assert.equal(invoiceState({ status: 'emitida', due_date: '2026-09-01' }, NOW).key, 'emitida');
  assert.equal(expedienteState({ status: 'abierto', start_date: '2026-08-01', end_date: '2026-08-02' }, NOW).key, 'por_cerrar');
  assert.equal(expedienteState({ status: 'abierto', start_date: '2026-09-01' }, NOW).key, 'abierto');
  assert.equal(expedienteState({ status: 'solicitado' }, NOW).key, 'solicitado');
});

test('nextNumber', () => {
  assert.equal(nextNumber(null, '1001'), 1001);
  assert.equal(nextNumber(1287, '1001'), 1288);
  assert.equal(nextNumber(5, '1001'), 1001);
});

const RATES = [{ label: 'IVA 21 %', rate_bp: 2100, is_default: 1 }, { label: 'IVA 10 %', rate_bp: 1000 }, { label: 'IGIC 7 %', rate_bp: 700 }];

test('validación: pagos previstos (importe con IVA y tipo de la lista)', () => {
  const r = validate(forecastRowSchema(RATES), { supplier: 'Hotel Marbella', concept: '1er pago', due_date: '2026-01-29', total: '21.400', rate: '1000' });
  assert.equal(r.ok, true);
  assert.equal(r.data.total, 2140000);
  assert.equal(r.data.base, 1945455);
  assert.deepEqual(r.data.lines, [{ rate: 1000, label: 'IVA 10 %', base: 1945455, total: 2140000 }]);
  assert.equal(r.data.vat, '10');
  const igic = validate(forecastRowSchema(RATES), { supplier: 'Hotel Tenerife', total: '10.700', rate: '700' });
  assert.equal(igic.data.base, 1000000);
  assert.equal(validate(forecastRowSchema(RATES), { supplier: 'Hotel', total: 'mucho', rate: '1000' }).ok, false);
  assert.equal(validate(forecastRowSchema(RATES), { supplier: 'Hotel', total: '100', rate: 'manual' }).ok, false);
});

test('validación: pago a proveedor', () => {
  assert.equal(validate(PaymentSchema, { supplier: 'AV Sistemas', status: 'pendiente' }).ok, true);
  const paidNoDate = validate(PaymentSchema, { supplier: 'AV Sistemas', status: 'pagado' });
  assert.equal(paidNoDate.ok, false);
  assert.ok(paidNoDate.errors.paid_on);
});

test('validación: tipo de IVA nuevo', () => {
  assert.deepEqual(validate(VatRateSchema, { label: 'IGIC 9,5 %', rate: '9,5' }).data, { label: 'IGIC 9,5 %', rate: 950 });
  assert.equal(validate(VatRateSchema, { label: 'IVA', rate: '21 %' }).data.rate, 2100);
  assert.equal(validate(VatRateSchema, { label: 'Raro', rate: '150' }).ok, false);
  assert.equal(validate(VatRateSchema, { label: 'Raro', rate: 'abc' }).ok, false);
});

test('validación: PO y expediente', () => {
  assert.equal(validate(PoSchema, { number: '4500123', billed_to: 'BMW', amount: '13.922,20' }).data.amount, 1392220);
  assert.equal(validate(PoSchema, { number: '4500123', billed_to: 'BMW', amount: '' }).ok, false);
  const e = validate(ExpedienteSchema, { name: 'Lanzamiento Winlevi', company: 'GLENMARK', start_date: '2026-04-22', end_date: '2026-04-20' });
  assert.equal(e.ok, false);
  assert.ok(e.errors.end_date);
});

test('fechas', () => {
  assert.equal(formatRange('2026-04-20', '2026-04-22'), '20–22 abr 2026');
  assert.equal(formatRange('2026-04-30', '2026-05-02'), '30 abr – 2 may 2026');
  assert.equal(formatRange('2026-05-06', null), '6 may 2026');
  assert.equal(dueText('2026-08-23', NOW), 'vence en 3 días');
  assert.equal(dueText('2026-08-15', NOW), 'venció hace 5 días');
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(isDate('2026-02-30'), false);
});

test('factura del proveedor: sin factura, por revisar (naranja) y con factura (verde)', () => {
  assert.equal(supplierInvoiceState({ status: 'pendiente', total_cents: 100 }).key, 'sin');
  assert.deepEqual(supplierInvoiceState({ status: 'pagado', total_cents: 100 }), { key: 'falta', label: 'Falta factura', tone: 'danger' });
  assert.deepEqual(supplierInvoiceState({ supplier_invoice_id: 3, invoice_review: 'pendiente', total_cents: 100 }), { key: 'revisar', label: 'Factura por revisar', tone: 'orange' });
  assert.deepEqual(supplierInvoiceState({ supplier_invoice_id: 3, invoice_review: 'conforme', total_cents: 100 }), { key: 'conforme', label: 'Con factura', tone: 'ok' });
  assert.equal(supplierInvoiceState({ status: 'pagado', total_cents: 0 }), null);
});

test('una factura que cubre dos pagos cuenta una sola vez para revisar', () => {
  const s = summarize({
    payments: [
      { id: 1, supplier_invoice_id: 9, invoice_review: 'pendiente', base_cents: 1945455, total_cents: 2140000, status: 'pagado' },
      { id: 2, supplier_invoice_id: 9, invoice_review: 'pendiente', base_cents: 2600000, total_cents: 2860000, status: 'pagado' },
    ],
  }, NOW);
  assert.deepEqual(s.toReview, [9]);
  assert.equal(s.withoutInvoice.length, 0);
  assert.equal(closingChecks(s).find((c) => /revisa/.test(c.text)).ok, false);
});

test('validación: datos de la factura del proveedor', () => {
  assert.deepEqual(validate(SupplierInvoiceSchema, { invoice_number: ' F-12 ', invoice_date: '2026-10-01', invoice_total: '50.000' }).data,
    { number: 'F-12', issued_on: '2026-10-01', total: 5000000 });
  assert.deepEqual(validate(SupplierInvoiceSchema, {}).data, { number: null, issued_on: null, total: null });
  assert.equal(validate(SupplierInvoiceSchema, { invoice_total: 'mucho' }).ok, false);
  assert.equal(validate(ConformSchema, { invoice_number: '' }).ok, false);
  assert.deepEqual(validate(ConformSchema, { invoice_number: '238' }).data, { number: '238', issued_on: null });
});

test('PO cerrada: su resto deja de contar como pendiente y no se puede facturar', () => {
  // La PO 11 tiene 13.922,20 € sin facturar; se cierra porque el evento costó menos
  const closedPos = [pos[0], { ...pos[1], closed_at: '2026-08-19T10:00:00Z' }];
  const s = summarize({ budget, payments, pos: closedPos, invoices, allocations }, NOW);
  const po11 = s.poRows.find((p) => p.id === 11);
  assert.equal(po11.closed, true);
  assert.equal(po11.left_cents, 3390220 - 1998000);
  assert.equal(po11.billable_cents, 0);
  assert.equal(s.poLeft, 0);
  assert.equal(s.poClosedLeft, 3390220 - 1998000);
  assert.ok(!nextSteps({ status: 'abierto' }, s, NOW).some((x) => /PO sin facturar/.test(x.text)));
  const check = closingChecks(s).find((c) => /PO/.test(c.text));
  assert.equal(check.ok, true);
  assert.match(check.text, /cerradas/);

  // Facturar de una PO cerrada: no (salvo lo que ya tenía la factura que se está editando)
  const form = (entries) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };
  const bad = parseAllocations(form([['po_ids', '11']]), s.poRows);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /cerrada/);
  const keep = parseAllocations(form([['po_ids', '11'], ['po_amount_11', '19.980']]), s.poRows, new Map([[11, 1998000]]));
  assert.deepEqual(keep, { ok: true, rows: [{ po_id: 11, amount: 1998000 }] });
  assert.equal(parseAllocations(form([['po_ids', '11'], ['po_amount_11', '20.000']]), s.poRows, new Map([[11, 1998000]])).ok, false);
  // Una PO abierta se sigue facturando por su saldo
  const open = summarize({ budget, payments, pos, invoices, allocations }, NOW);
  assert.deepEqual(parseAllocations(form([['po_ids', '11']]), open.poRows), { ok: true, rows: [{ po_id: 11, amount: 3390220 - 1998000 }] });
});
