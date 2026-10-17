import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, eur, num, amountInput, pct, csvAmount } from '../src/lib/money.js';

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
