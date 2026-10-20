// Bandejas de Pagos y Cobros en tabla (src/services/payments.js y src/services/invoices.js) contra la base en
// memoria con los datos de ejemplo: filtros, orden por columnas, páginas, sumas y cobrar una factura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, EMAILS } from './helpers/context.mjs';
import * as payments from '../src/services/payments.js';
import * as invoices from '../src/services/invoices.js';
import { LOCKED_MSG } from '../src/lib/actions.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const NOW = '2026-10-19';
const setup = async () => {
  const db = await testDb({ demo: true });
  const as = (role) => contextFor(db, EMAILS[role], { now: NOW });
  return { db, as };
};
const sum = (rows) => rows.reduce((a, r) => a + r.total_cents, 0);

test('pagos pendientes en tabla: plazos, tipo, buscador, orden y páginas', { skip }, async () => {
  const { db, as } = await setup();
  const ctx = as('administracion');
  const all = await payments.pendingTable(ctx, { limit: 1000 });
  assert.ok(all.ok);
  const expected = db.one("SELECT COUNT(*) AS n FROM payments p JOIN expedientes e ON e.id = p.expediente_id WHERE p.status = 'pendiente' AND e.status != 'cancelado'").n;
  assert.equal(all.value.total, expected);
  assert.equal(all.value.sum, sum(all.value.rows));
  // Los plazos reparten todos los pendientes
  const groups = Object.values(all.value.groups);
  assert.equal(groups.reduce((a, g) => a + g.n, 0), expected);
  assert.equal(groups.reduce((a, g) => a + g.sum, 0), all.value.sum);
  const overdue = await payments.pendingTable(ctx, { plazo: 'vencidos' });
  assert.ok(overdue.value.rows.length > 0 && overdue.value.rows.every((p) => p.due_date < NOW));
  assert.equal(overdue.value.total, all.value.groups.vencidos.n);
  const liq = await payments.pendingTable(ctx, { kind: 'liquidacion' });
  assert.ok(liq.value.total === 1 && liq.value.rows[0].kind === 'liquidacion');
  assert.deepEqual((await payments.pendingTable(ctx, { plazo: 'reembolsos' })).value.rows.map((p) => p.id), liq.value.rows.map((p) => p.id));
  // Un plazo o un tipo que no existen no filtran
  assert.equal((await payments.pendingTable(ctx, { plazo: 'x', kind: 'y' })).value.total, expected);
  // Buscador y orden (por importe, de más a menos: su sentido natural)
  assert.ok((await payments.pendingTable(ctx, { q: 'Alfonso' })).value.rows.every((p) => p.supplier === 'Hotel Alfonso XIII'));
  const byAmount = await payments.pendingTable(ctx, { order: 'total', limit: 1000 });
  assert.equal(byAmount.value.dir, 'desc');
  assert.deepEqual(byAmount.value.rows.map((p) => p.total_cents), [...byAmount.value.rows.map((p) => p.total_cents)].sort((a, b) => b - a));
  // Por fecha límite: los que no tienen, al final
  const byDue = (await payments.pendingTable(ctx, { limit: 1000 })).value.rows;
  assert.ok(byDue.findIndex((p) => !p.due_date) > byDue.findLastIndex((p) => p.due_date));
  // Páginas sin repetir ni saltar
  const p1 = await payments.pendingTable(ctx, { order: 'total', limit: 3 });
  const p2 = await payments.pendingTable(ctx, { order: 'total', limit: 3, offset: 3 });
  assert.deepEqual([...p1.value.rows, ...p2.value.rows].map((p) => p.id), byAmount.value.rows.slice(0, 6).map((p) => p.id));
  assert.equal((await payments.pendingTable(as('tecnico'))).code, 'forbidden');
});

test('pagos hechos en tabla: mes, forma de pago, orden y la lista de «pagados sin factura»', { skip }, async () => {
  const { db, as } = await setup();
  const ctx = as('administracion');
  const all = await payments.paidTable(ctx, { limit: 1000 });
  assert.equal(all.value.total, db.one("SELECT COUNT(*) AS n FROM payments WHERE status = 'pagado'").n);
  assert.deepEqual(all.value.rows.map((p) => p.paid_on), [...all.value.rows.map((p) => p.paid_on)].sort().reverse(), 'los más recientes primero');
  const aug = await payments.paidTable(ctx, { month: '2026-08', limit: 1000 });
  assert.ok(aug.value.total > 0 && aug.value.rows.every((p) => p.paid_on.startsWith('2026-08')));
  const card = await payments.paidTable(ctx, { method: 'tarjeta', limit: 1000 });
  assert.ok(card.value.total > 0 && card.value.rows.every((p) => p.method === 'tarjeta'));
  assert.equal((await payments.paidTable(ctx, { method: 'bizum' })).value.total, all.value.total, 'una forma que no existe no filtra');
  const noInvoice = await payments.paidWithoutInvoice(ctx);
  assert.ok(noInvoice.value.some((p) => p.supplier === 'Catering Lazo'));
});

test('cobros en tabla: estado (por emitir, pendiente, vencida), orden y cobradas por mes', { skip }, async () => {
  const { as } = await setup();
  const ctx = as('administracion');
  const open = await invoices.openTable(ctx, { limit: 1000 });
  assert.ok(open.ok);
  assert.deepEqual(Object.fromEntries(Object.entries(open.value.groups).map(([k, g]) => [k, g.n])), { por_emitir: 2, emitida: 1, vencida: 1 });
  assert.equal(open.value.total, 4);
  assert.equal(open.value.rows[0].status, 'por_emitir', 'por defecto, primero las que hay que emitir');
  const late = await invoices.openTable(ctx, { state: 'vencida' });
  assert.deepEqual(late.value.rows.map((i) => i.number), ['G/000903/26/01']);
  assert.ok((await invoices.openTable(ctx, { q: 'Bymycar' })).value.rows.every((i) => i.billed_to === 'Bymycar'));
  const collected = await invoices.collectedTable(ctx, { limit: 1000 });
  assert.equal(collected.value.total, 11);
  assert.equal(collected.value.rows[0].collected_on, '2026-09-26');
  assert.equal((await invoices.collectedTable(ctx, { month: '2026-09' })).value.total, 9);
  // Por facturar: los expedientes con presupuesto sin facturar (o que piden revisar algo)
  const bill = await invoices.toBill(ctx);
  assert.ok(bill.value.some((e) => e.number === 1290 && e.left === 13000000));
  // Eventos no ve los cobros
  for (const r of [await invoices.openTable(as('eventos')), await invoices.collectedTable(as('eventos')), await invoices.toBill(as('eventos'))]) assert.equal(r.code, 'forbidden');
});

test('cobrar: sólo una emitida, de un expediente abierto, con fecha y con permiso', { skip }, async () => {
  const { db, as } = await setup();
  const ctx = as('administracion');
  const inv = (id) => db.one('SELECT status, collected_on FROM invoices WHERE id = ?', id);
  assert.equal((await invoices.collect(ctx, { invoice_id: '13', collected_on: '' })).code, 'invalid');
  assert.equal((await invoices.collect(ctx, { invoice_id: '13', collected_on: '2026-10-19' }, { expedienteId: 3 })).message, 'Esa factura ya no existe.');
  const r = await invoices.collect(ctx, { invoice_id: '13', collected_on: '2026-10-19' }, { expedienteId: 1 });
  assert.deepEqual(r.value, { expedienteId: 1 });
  assert.deepEqual(inv(13), { status: 'cobrada', collected_on: '2026-10-19' });
  assert.match(db.one("SELECT text FROM activity WHERE action = 'invoice.collected' ORDER BY id DESC LIMIT 1").text, /registró el cobro de la factura G\/000844\/26\/01 de Bymycar/);
  assert.equal((await invoices.collect(ctx, { invoice_id: '13', collected_on: '2026-10-19' })).message, 'Sólo se puede cobrar una factura emitida.');
  assert.equal((await invoices.collect(ctx, { invoice_id: '3', collected_on: '2026-10-19' })).message, 'Sólo se puede cobrar una factura emitida.', 'una por emitir, no');
  assert.equal((await invoices.collect(as('eventos'), { invoice_id: '4', collected_on: '2026-10-19' })).code, 'forbidden');
  // Un expediente cerrado es de sólo lectura
  db.raw.exec("UPDATE invoices SET status = 'emitida', collected_on = NULL WHERE id = 14");
  assert.equal((await invoices.collect(ctx, { invoice_id: '14', collected_on: '2026-10-19' })).message, LOCKED_MSG);
});
