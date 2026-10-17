import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, eur, num, amountInput, resolveAmounts, totalFromBase, baseFromTotal, pct, csvAmount } from '../src/lib/money.js';

test('parseAmount: formatos españoles', () => {
  assert.equal(parseAmount('21.400'), 2140000);
  assert.equal(parseAmount('21.400,50'), 2140050);
  assert.equal(parseAmount('1.983,47'), 198347);
  assert.equal(parseAmount('2.620,00 €'), 262000);
  assert.equal(parseAmount('130.000€'), 13000000);
  assert.equal(parseAmount('1.250.000'), 125000000);
  assert.equal(parseAmount('79410,22'), 7941022);
  assert.equal(parseAmount('0,5'), 50);
});

test('parseAmount: formatos ingleses y sin separadores', () => {
  assert.equal(parseAmount('1983.47'), 198347);
  assert.equal(parseAmount('1,983.47'), 198347);
  assert.equal(parseAmount('21,400'), 2140000);
  assert.equal(parseAmount('28600'), 2860000);
  assert.equal(parseAmount(' 2 381,82 '), 238182);
});

test('parseAmount: negativos (abonos y comisiones)', () => {
  assert.equal(parseAmount('-232,55'), -23255);
  assert.equal(parseAmount('−391,50'), -39150);
});

test('parseAmount: vacío y no válidos', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(null), null);
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount('1.2.3')));
  assert.ok(Number.isNaN(parseAmount('21.40.0')));
  assert.ok(Number.isNaN(parseAmount('1,234,5')));
  assert.ok(Number.isNaN(parseAmount('12,345.6.7')));
  assert.ok(Number.isNaN(parseAmount('1e5')));
  assert.ok(Number.isNaN(parseAmount('9999999999999')));
});

test('formatos de salida', () => {
  assert.equal(eur(238182).replace(/\s/g, ' '), '2.381,82 €');
  assert.equal(eur(-23255).replace(/\s/g, ' '), '-232,55 €');
  assert.equal(num(6460411), '64.604,11');
  assert.equal(amountInput(238182), '2381,82');
  assert.equal(amountInput(240000), '2400');
  assert.equal(amountInput(-23255), '-232,55');
  assert.equal(amountInput(null), '');
  assert.equal(csvAmount(238182), '2381,82');
  assert.equal(pct(4100523, 6460411), '63,5 %');
  assert.equal(pct(1, 0), '—');
});

test('IVA: de base a total y al revés', () => {
  assert.equal(totalFromBase(82145, '10'), 90360);
  assert.equal(totalFromBase(198347, '21'), 240000);
  assert.equal(baseFromTotal(240000, '21'), 198347);
  assert.equal(baseFromTotal(2140000, '10'), 1945455);
  assert.equal(totalFromBase(1000, '0'), 1000);
});

test('resolveAmounts', () => {
  assert.deepEqual(resolveAmounts({ base: 100000, total: null, vat: '21' }), { ok: true, base: 100000, total: 121000 });
  assert.deepEqual(resolveAmounts({ base: null, total: 121000, vat: '21' }), { ok: true, base: 100000, total: 121000 });
  // Los dos escritos: se respetan (redondeos de la factura)
  assert.deepEqual(resolveAmounts({ base: 14515, total: 16000, vat: '10' }), { ok: true, base: 14515, total: 16000 });
  assert.equal(resolveAmounts({ base: 100, total: null, vat: 'mixto' }).ok, false);
  assert.deepEqual(resolveAmounts({ base: 1281095, total: 1453134, vat: 'mixto' }), { ok: true, base: 1281095, total: 1453134 });
  assert.equal(resolveAmounts({ base: null, total: null, vat: '21' }).ok, false);
  assert.equal(resolveAmounts({ base: Number.NaN, total: null, vat: '21' }).ok, false);
  assert.equal(resolveAmounts({ base: -100, total: 121, vat: '21' }).ok, false);
  assert.deepEqual(resolveAmounts({ base: -23255, total: null, vat: '21' }), { ok: true, base: -23255, total: -28139 });
});
