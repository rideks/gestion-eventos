import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, nextSteps, closingChecks, paymentState, invoiceState, expedienteState, nextNumber } from '../src/lib/finance.js';
import { PaymentSchema, ForecastRowSchema, PoSchema, ExpedienteSchema, validate } from '../src/lib/validate.js';
import { formatRange, dueText, addDays, isDate } from '../src/lib/dates.js';

const NOW = '2026-08-20';

// Cierre del EXP 1287 (Workshop BMW) del Excel de ejemplo, simplificado
const payments = [
  { id: 1, supplier: 'Hotel Barceló Valladolid', invoice_number: '10000001225', base_cents: 238182, total_cents: 262000, status: 'pagado', planned: 1 },
  { id: 2, supplier: 'Hotel Barceló Valladolid', invoice_number: 'NT/000086/26', base_cents: -23255, total_cents: -39150, status: 'pagado', planned: 0 },
  { id: 3, supplier: 'AV Sistemas', invoice_number: '238', base_cents: 277406, total_cents: 335661, status: 'pendiente', due_date: '2026-08-10', planned: 1 },
  { id: 4, supplier: 'Gráficas Mercurio', invoice_number: null, base_cents: 39100, total_cents: 47311, status: 'pendiente', due_date: '2026-08-25', planned: 1 },
  { id: 5, supplier: 'Mentimeter', invoice_number: null, base_cents: 16800, total_cents: 20328, status: 'pagado', planned: 0 },
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
  assert.deepEqual(nextSteps({ status: 'cerrado' }, s, NOW), []);
  assert.ok(closingChecks(s).every((c) => !c.ok));

  const done = summarize({
    budget,
    payments: [{ id: 1, invoice_number: 'F1', base_cents: 100, total_cents: 121, status: 'pagado' }],
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
  assert.equal(paymentState({ status: 'pendiente', invoice_number: 'F1' }, NOW).key, 'pendiente');
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

test('validación: previsión de pagos (sólo importe con IVA)', () => {
  const r = validate(ForecastRowSchema, { supplier: 'Hotel Marbella', concept: '1er pago', due_date: '2026-01-29', total: '21.400', vat: '10' });
  assert.equal(r.ok, true);
  assert.equal(r.data.total, 2140000);
  assert.equal(r.data.base, 1945455);
  assert.equal(validate(ForecastRowSchema, { supplier: 'Hotel', total: 'mucho', vat: '10' }).ok, false);
});

test('validación: pago a proveedor', () => {
  const ok = validate(PaymentSchema, { supplier: 'AV Sistemas', base: '2.774,06', vat: '21', status: 'pendiente' });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.total, 335661);
  const paidNoDate = validate(PaymentSchema, { supplier: 'AV Sistemas', base: '10', vat: '21', status: 'pagado' });
  assert.equal(paidNoDate.ok, false);
  assert.ok(paidNoDate.errors.paid_on);
  const bad = validate(PaymentSchema, { supplier: 'AV Sistemas', base: 'x', vat: '21', status: 'pendiente' });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Importe/);
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
