// Liquidaciones de gastos (src/services/payments.js): lo que alguien adelantó de su bolsillo, sin factura. Se apunta
// como un pago del expediente a nombre de esa persona, con su hoja; cuenta como coste y se le reembolsa como un pago.
// No es un proveedor del directorio, no admite facturas ni proformas y no sale en «pagados sin factura».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, memoryBucket, EMAILS } from './helpers/context.mjs';
import * as payments from '../src/services/payments.js';
import { loadFinance } from '../src/lib/data.js';
import { RECEIPT_MISSING, PAID_LOCKED } from '../src/lib/finance.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const PDF = (name = 'hoja.pdf') => new File([new TextEncoder().encode('%PDF-1.4\n%prueba\n')], name, { type: 'application/pdf' });
const FAKE = () => new File([new TextEncoder().encode('esto no es un pdf')], 'falso.pdf', { type: 'application/pdf' });

function form(fields, files = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) f.append(k, x);
  for (const [k, file] of Object.entries(files)) f.append(k, file);
  return f;
}

const setup = async () => {
  const db = await testDb({ demo: true });
  const bucket = memoryBucket();
  const as = (role) => contextFor(db, EMAILS[role], { bucket, now: '2026-10-19' });
  const pay = (id) => db.one('SELECT * FROM payments WHERE id = ?', id);
  const count = (sql, ...p) => db.one(`SELECT COUNT(*) AS n FROM ${sql}`, ...p).n;
  return { db, bucket, as, pay, count };
};
// Taxis y material que adelantó Marta en el EXP 1289: 110 € con el 10 % de IVA
const LIQ = { advanced_by: 'Marta López', concept: 'Taxis y material de montaje', spent_on: '2026-10-15', status: 'pendiente', vl_total: '110', vl_rate: '1000', vl_base: '' };

test('alta: a nombre de quien adelantó el dinero, con su hoja; cuenta como coste y no es un proveedor', { skip }, async () => {
  const { db, bucket, as, pay, count } = await setup();
  const ctx = as('eventos');
  const suppliers = count('suppliers');
  const before = await loadFinance(db, 3, '2026-10-19');
  const r = await payments.createLiquidation(ctx, 3, form(LIQ, { sheet: PDF() }));
  assert.ok(r.ok, r.message);
  const p = pay(r.value.id);
  assert.deepEqual([p.kind, p.supplier, p.supplier_id, p.concept, p.spent_on, p.status, p.base_cents, p.total_cents, p.due_date],
    ['liquidacion', 'Marta López', null, 'Taxis y material de montaje', '2026-10-15', 'pendiente', 10000, 11000, null]);
  assert.equal(db.one('SELECT name FROM files WHERE id = ?', p.sheet_file_id).name, 'hoja.pdf');
  assert.equal(bucket.files.size, 1);
  assert.equal(count('suppliers'), suppliers, 'no se da de alta ningún proveedor');
  assert.match(db.one("SELECT text FROM activity WHERE action = 'payment.add' ORDER BY id DESC LIMIT 1").text, /añadió una liquidación de gastos de Marta López \(110,00\s€: Taxis y material de montaje\)/);
  const after = await loadFinance(db, 3, '2026-10-19');
  assert.equal(after.summary.cost.base, before.summary.cost.base + 10000);
  assert.equal(after.summary.withoutInvoice.length, before.summary.withoutInvoice.length, 'no cuenta como «sin factura»');
  assert.equal(after.summary.toReimburse, before.summary.toReimburse + 11000);
});

test('alta: quién, concepto, fecha e importe obligatorios; la hoja también (y tiene que ser válida)', { skip }, async () => {
  const { as, count } = await setup();
  const ctx = as('eventos');
  const before = count('payments');
  const empty = await payments.createLiquidation(ctx, 3, form({ status: 'pendiente' }, { sheet: PDF() }));
  assert.ok(empty.fields.advanced_by && empty.fields.concept && empty.fields.spent_on);
  assert.equal((await payments.createLiquidation(ctx, 3, form({ ...LIQ, vl_total: '' }, { sheet: PDF() }))).fields.amount, 'Importe: escribe el importe sin IVA o con IVA');
  assert.match((await payments.createLiquidation(ctx, 3, form(LIQ))).fields.sheet, /^Adjunta la hoja de liquidación/);
  assert.match((await payments.createLiquidation(ctx, 3, form(LIQ, { sheet: FAKE() }))).fields.sheet, /^Hoja de liquidación · «falso\.pdf» no parece un PDF/);
  assert.equal(count('payments'), before);
  // Un expediente cerrado es de sólo lectura; Técnico no trabaja en expedientes
  assert.equal((await payments.createLiquidation(as('administracion'), 2, form(LIQ, { sheet: PDF() }))).code, 'conflict');
  assert.equal((await payments.createLiquidation(as('tecnico'), 3, form(LIQ, { sheet: PDF() }))).code, 'forbidden');
});

test('reembolso: como un pago (por transferencia, con justificante); Eventos no lo marca', { skip }, async () => {
  const { db, as, pay, bucket } = await setup();
  const id = (await payments.createLiquidation(as('eventos'), 3, form(LIQ, { sheet: PDF() }))).value.id;
  // Eventos sólo marca pagos con tarjeta: un reembolso, ni así (ni al darla de alta)
  for (const method of ['transferencia', 'tarjeta']) {
    const ev = await payments.markPaid(as('eventos'), { payment_id: String(id), paid_on: '2026-10-20', method });
    assert.deepEqual([ev.code, ev.message], ['forbidden', 'El reembolso de una liquidación de gastos lo marca Administración.'], method);
  }
  const paidByEv = await payments.createLiquidation(as('eventos'), 3, form({ ...LIQ, status: 'pagado', paid_on: '2026-10-20', method: 'tarjeta' }, { sheet: PDF() }));
  assert.equal(paidByEv.fields.method, 'El reembolso de una liquidación de gastos lo marca Administración.');
  const ctx = as('administracion');
  const noReceipt = await payments.markPaid(ctx, { payment_id: String(id), paid_on: '2026-10-20', method: 'transferencia' });
  assert.equal(noReceipt.message, RECEIPT_MISSING);
  const r = await payments.markPaid(ctx, { payment_id: String(id), paid_on: '2026-10-20', method: 'transferencia' }, { receipt: PDF('justificante.pdf') });
  assert.deepEqual(r.value, { expedienteId: 3, kind: 'liquidacion' });
  assert.deepEqual([pay(id).status, pay(id).method], ['pagado', 'transferencia']);
  assert.equal(bucket.files.size, 2);
  assert.match(db.one("SELECT text FROM activity WHERE action = 'payment.paid' ORDER BY id DESC LIMIT 1").text, /marcó como reembolsada la liquidación de gastos de Marta López/);
  // Reembolsada: no sale entre los pagos hechos sin factura, no se modifica y su hoja ya no se cambia
  assert.ok(!(await payments.inbox(ctx, 'pendientes')).value.noInvoice.some((p) => p.id === id));
  assert.equal((await payments.update(ctx, 3, id, form(LIQ))).message, PAID_LOCKED);
  assert.equal((await payments.replaceSheet(ctx, 3, id, PDF('otra.pdf'))).message, PAID_LOCKED);
  // Deshacer el reembolso (para corregir un error)
  const undo = await payments.unpay(ctx, 3, id);
  assert.deepEqual([undo.value.kind, pay(id).status], ['liquidacion', 'pendiente']);
});

test('ficha: cambiar los datos y la hoja; sin facturas ni proformas; al borrarla se va su hoja', { skip }, async () => {
  const { db, as, pay, bucket } = await setup();
  const ctx = as('eventos');
  const id = (await payments.createLiquidation(ctx, 3, form(LIQ, { sheet: PDF() }))).value.id;
  const first = pay(id).sheet_file_id;
  const up = await payments.update(ctx, 3, id, form({ ...LIQ, advanced_by: 'Elena Martín', spent_on: '2026-10-16', vl_total: '220' }));
  assert.ok(up.ok, up.message);
  assert.deepEqual([pay(id).supplier, pay(id).supplier_id, pay(id).spent_on, pay(id).total_cents], ['Elena Martín', null, '2026-10-16', 22000]);
  assert.equal((await payments.update(ctx, 3, id, form({ ...LIQ, advanced_by: '' }))).code, 'invalid');
  // La hoja se sustituye (la anterior se borra)
  assert.ok((await payments.replaceSheet(ctx, 3, id, PDF('hoja-buena.pdf'))).ok);
  assert.notEqual(pay(id).sheet_file_id, first);
  assert.equal(db.one('SELECT id FROM files WHERE id = ?', first), null);
  assert.equal(bucket.files.size, 1);
  assert.equal((await payments.replaceSheet(ctx, 3, id, null)).code, 'invalid');
  // No lleva factura
  assert.match((await payments.addDocument(ctx, 3, id, { doc_kind: 'factura', invoice_number: 'F-1' }, PDF())).message, /no lleva factura/);
  // Un pago a un proveedor no tiene hoja
  assert.equal((await payments.replaceSheet(ctx, 3, 20, PDF())).code, 'invalid');
  // Borrar: se va con su hoja
  assert.ok((await payments.remove(ctx, 3, id)).ok);
  assert.equal(pay(id), null);
  assert.equal(bucket.files.size, 0);
  assert.match(db.one("SELECT text FROM activity WHERE action = 'payment.delete' ORDER BY id DESC LIMIT 1").text, /borró la liquidación de gastos de Elena Martín/);
});

test('pestaña: los nombres del equipo para «quién adelantó el dinero»', { skip }, async () => {
  const { as } = await setup();
  const t = await payments.tab(as('eventos'), 3);
  assert.ok(t.value.people.includes('Marta López') && t.value.people.includes('Tania Ruiz'));
  assert.deepEqual((await payments.tab(as('eventos'), 2)).value.people, [], 'un expediente cerrado no se edita');
});
