import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatInvoiceNumber, seqOf, nextSeq, patternProblem, yearly, counterKey, invoiceEmail, readInvoiceForm } from '../src/lib/invoicing.js';
import { sentState, summarize, nextSteps } from '../src/lib/finance.js';

const P = 'G/{n}/{yy}/01';

test('número de factura: formato G/000904/26/01', () => {
  assert.equal(formatInvoiceNumber(P, 904, 2026), 'G/000904/26/01');
  assert.equal(formatInvoiceNumber(P, 1, 2027), 'G/000001/27/01');
  assert.equal(formatInvoiceNumber('F{yyyy}-{n}', 12, 2026), 'F2026-000012');
  assert.equal(formatInvoiceNumber('{n}', 1234567, 2026), '1234567');
});

test('número de orden de un nº de factura (sólo de esa serie y ese año)', () => {
  assert.equal(seqOf(P, 'G/000903/26/01', 2026), 903);
  assert.equal(seqOf(P, 'G/000903/25/01', 2026), null);
  assert.equal(seqOf(P, 'G/000903/26/02', 2026), null);
  assert.equal(seqOf(P, 'FRA-2026-1', 2026), null);
  assert.equal(seqOf('F{yyyy}.{n}', 'F2026.000007', 2026), 7);
  assert.equal(seqOf('F{yyyy}.{n}', 'F2026X000007', 2026), null, 'el punto es literal, no comodín');
  assert.equal(seqOf(P, null, 2026), null);
});

test('siguiente número: el de Ajustes o el siguiente al mayor ya usado', () => {
  const numbers = ['G/000808/26/01', 'G/000903/26/01', 'G/000412/26/01', 'G/000999/25/01', 'otra-cosa'];
  assert.equal(nextSeq({ pattern: P, year: 2026, numbers }), 904);
  assert.equal(nextSeq({ pattern: P, year: 2026, stored: '950', numbers }), 950, 'si en Ajustes se ha subido, manda');
  assert.equal(nextSeq({ pattern: P, year: 2026, stored: '100', numbers }), 904, 'nunca por debajo de uno ya usado');
  assert.equal(nextSeq({ pattern: P, year: 2027, numbers }), 1, 'cada año empieza en 1');
  assert.equal(nextSeq({ pattern: '{n}', year: 2026, numbers: ['000041'] }), 42);
});

test('formato: con año → contador por año; sin año → uno solo', () => {
  assert.equal(yearly(P), true);
  assert.equal(yearly('F{yyyy}-{n}'), true);
  assert.equal(yearly('F-{n}'), false);
  assert.equal(counterKey(P, 2026), 'invoice_next:2026');
  assert.equal(counterKey('F-{n}', 2026), 'invoice_next');
});

test('formato: tiene que llevar {n} una vez y sólo {n}, {yy}, {yyyy}', () => {
  assert.equal(patternProblem(P), null);
  assert.equal(patternProblem('F{yyyy}-{n}'), null);
  assert.match(patternProblem(''), /escríbelo/);
  assert.match(patternProblem('G/{yy}/01'), /\{n\}/);
  assert.match(patternProblem('{n}-{n}'), /\{n\}/);
  assert.match(patternProblem('G/{n}/{mm}'), /sólo/);
  assert.match(patternProblem(`G/{n}/${'x'.repeat(40)}`), /40/);
});

test('correo de la factura: número, importe, concepto, PO y forma de pago', () => {
  const inv = { number: 'G/000904/26/01', issued_on: '2026-10-18', due_date: '2026-11-17', total_cents: 24200, concept: 'Workshop BMW · Valladolid\nSegunda línea' };
  const m = invoiceEmail(inv, { name: 'Seven Worlds Events & Congresses, S.L.', iban: 'ES00 1' }, '4500890045');
  assert.equal(m.subject, 'Factura G/000904/26/01 · Seven Worlds Events & Congresses, S.L.');
  assert.match(m.body, /factura G\/000904\/26\/01 del 18\/10\/2026 por 242,00\s€/);
  assert.match(m.body, /«Workshop BMW · Valladolid»/);
  assert.doesNotMatch(m.body, /Segunda línea/);
  assert.match(m.body, /\(PO 4500890045\)/);
  assert.match(m.body, /Vencimiento: 17\/11\/2026\. Forma de pago: transferencia a ES00 1\./);
  assert.doesNotMatch(m.body, /\n\n\n/);
});

// Formulario de la factura: un FormData como el del navegador
const RATES = [{ id: 1, label: 'IVA 21 %', rate_bp: 2100, is_default: 1 }];
const PO_ROWS = [{ id: 7, number: '4500890045', billed_to: 'BMW Ibérica', amount_cents: 20000, billable_cents: 20000, closed: 0 }];
function invoiceForm(fields) {
  const f = new FormData();
  const all = { billed_to: 'BMW Ibérica', vl_rate: '2100', vl_base: '200,00', vl_total: '242,00', ...fields };
  for (const [k, v] of Object.entries(all)) for (const one of [v].flat()) f.append(k, one);
  return f;
}
const read = (fields, mode) => {
  const form = invoiceForm(fields);
  return readInvoiceForm({ form, input: Object.fromEntries(form), poRows: PO_ROWS, rates: RATES, mode, today: '2026-10-18' });
};

test('pedir / guardar el borrador: basta el cliente y el importe', () => {
  const r = read({}, 'draft');
  assert.equal(r.ok, true, r.message);
  assert.equal(r.data.total, 24200);
  assert.equal(r.data.base, 20000);
});

test('emitir: exige NIF, dirección y concepto; pone la fecha de hoy y el vencimiento a 30 días', () => {
  const r = read({}, 'emit');
  assert.equal(r.ok, false);
  assert.ok(r.errors.billed_tax_id && r.errors.billed_address && r.errors.concept, JSON.stringify(r.errors));
  const ok = read({ billed_tax_id: 'A00000001', billed_address: 'Avenida de Ejemplo 1', concept: 'Workshop BMW' }, 'emit');
  assert.equal(ok.ok, true, ok.message);
  assert.equal(ok.data.issued_on, '2026-10-18');
  assert.equal(ok.data.due_date, '2026-11-17');
});

test('emitir y enviar: además, el email de facturación', () => {
  const fiscal = { billed_tax_id: 'A00000001', billed_address: 'Avenida de Ejemplo 1', concept: 'Workshop BMW' };
  const r = read(fiscal, 'send');
  assert.equal(r.ok, false);
  assert.ok(r.errors.billed_email);
  assert.equal(read({ ...fiscal, billed_email: 'facturas@example.com' }, 'send').ok, true);
});

test('factura con PO: no puede pasar de lo que queda sin facturar de la PO', () => {
  const r = read({ po_ids: '7', po_amount_7: '300,00', vl_base: '300,00', vl_total: '363,00' }, 'draft');
  assert.equal(r.ok, false);
});

test('envío al cliente: sólo cuenta en las emitidas sin cobrar, y avisa en los pasos', () => {
  assert.equal(sentState({ status: 'por_emitir' }), null);
  assert.equal(sentState({ status: 'cobrada', sent_at: null }), null);
  assert.equal(sentState({ status: 'emitida', sent_at: null }).key, 'sin_enviar');
  assert.equal(sentState({ status: 'emitida', sent_at: '2026-10-18T10:00:00Z' }).key, 'enviada');

  const invoices = [
    { id: 1, status: 'emitida', number: 'G/000904/26/01', billed_to: 'BMW', base_cents: 100, total_cents: 121, due_date: '2026-11-17', sent_at: null },
    { id: 2, status: 'emitida', number: 'G/000905/26/01', billed_to: 'BMW', base_cents: 100, total_cents: 121, due_date: '2026-11-17', sent_at: '2026-10-18T10:00:00Z' },
  ];
  const s = summarize({ payments: [], invoices, pos: [], allocations: [], budgets: [], documents: [] }, '2026-10-18');
  assert.deepEqual(s.unsent.map((i) => i.id), [1]);
  const step = nextSteps({ status: 'abierto' }, s, '2026-10-18').find((x) => /sin enviar/.test(x.text));
  assert.equal(step.path, 'facturas/1#envio');
});
