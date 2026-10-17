import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  totalFromBaseBp, baseFromTotalBp, resolveLine, parseRate, parseVatLines, rawVatLines, linesOf, defaultLine,
  invoiceAmounts, vatColumn, pctText, rateLabel, MANUAL,
} from '../src/lib/vat.js';

const RATES = [
  { label: 'IVA 21 %', rate_bp: 2100, is_default: 1 },
  { label: 'IVA 10 %', rate_bp: 1000, is_default: 0 },
  { label: 'IGIC 7 %', rate_bp: 700, is_default: 0 },
  { label: 'Exento 0 %', rate_bp: 0, is_default: 0 },
];

/** FormData con las líneas del formulario (vl_base, vl_rate, vl_total) */
function form(lines, extra = {}) {
  const f = new FormData();
  for (const l of lines) {
    f.append('vl_base', l.base ?? '');
    f.append('vl_rate', l.rate ?? '');
    f.append('vl_total', l.total ?? '');
  }
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
}

test('cálculo con puntos básicos (admite decimales: 9,5 %)', () => {
  assert.equal(totalFromBaseBp(82145, 1000), 90360);
  assert.equal(totalFromBaseBp(198347, 2100), 240000);
  assert.equal(baseFromTotalBp(240000, 2100), 198347);
  assert.equal(baseFromTotalBp(2140000, 1000), 1945455);
  assert.equal(totalFromBaseBp(1000000, 700), 1070000);
  assert.equal(totalFromBaseBp(10000, 950), 10950);
  assert.equal(totalFromBaseBp(1000, 0), 1000);
  assert.equal(pctText(950), '9,5');
  assert.equal(rateLabel(700, RATES), 'IGIC 7 %');
  assert.equal(rateLabel(300, RATES), '3 %');
});

test('resolveLine', () => {
  assert.deepEqual(resolveLine({ base: 100000, total: null, rate: 2100 }), { ok: true, base: 100000, total: 121000 });
  assert.deepEqual(resolveLine({ base: null, total: 121000, rate: 2100 }), { ok: true, base: 100000, total: 121000 });
  // Los dos escritos: se respetan (redondeos de la factura)
  assert.deepEqual(resolveLine({ base: 14515, total: 16000, rate: 1000 }), { ok: true, base: 14515, total: 16000 });
  assert.equal(resolveLine({ base: 100, total: null, rate: null }).ok, false);
  assert.equal(resolveLine({ base: null, total: null, rate: 2100 }).ok, false);
  assert.equal(resolveLine({ base: Number.NaN, total: null, rate: 2100 }).ok, false);
  assert.equal(resolveLine({ base: -100, total: 121, rate: 2100 }).ok, false);
  assert.deepEqual(resolveLine({ base: -23255, total: null, rate: 2100 }), { ok: true, base: -23255, total: -28139 });
});

test('parseRate', () => {
  assert.equal(parseRate('2100'), 2100);
  assert.equal(parseRate(MANUAL), null);
  assert.equal(parseRate(''), undefined);
  assert.equal(parseRate('abc'), undefined);
  assert.equal(parseRate('20000'), undefined);
});

test('parseVatLines: presupuesto con hotel al 10 % y servicios al 21 %', () => {
  const r = parseVatLines(form([{ base: '6.572', rate: '1000' }, { base: '6.238,95', rate: '2100' }, { base: '', rate: '2100', total: '' }]), RATES);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, [
    { rate: 1000, label: 'IVA 10 %', base: 657200, total: 722920 },
    { rate: 2100, label: 'IVA 21 %', base: 623895, total: 754913 },
  ]);
  assert.equal(r.base, 657200 + 623895);
  assert.equal(r.total, 722920 + 754913);
  assert.equal(r.vat, 'mixto');
});

test('parseVatLines: una línea, a mano, errores y vacío', () => {
  assert.equal(parseVatLines(form([{ base: '1.000', rate: '700' }]), RATES).vat, '7');
  const manual = parseVatLines(form([{ base: '145,15', rate: MANUAL, total: '160' }]), RATES);
  assert.deepEqual(manual.lines, [{ rate: null, label: 'Otro tipo', base: 14515, total: 16000 }]);
  assert.match(parseVatLines(form([{ base: '100', rate: MANUAL }]), RATES).message, /Otro tipo/);
  assert.match(parseVatLines(form([{ base: 'mucho', rate: '2100' }]), RATES).message, /^Importe:/);
  assert.match(parseVatLines(form([{ base: '1', rate: '2100' }, { base: 'x', rate: '1000' }]), RATES).message, /línea 2/);
  assert.equal(parseVatLines(form([]), RATES).ok, false);
  assert.deepEqual(parseVatLines(form([]), RATES, { required: false }), { ok: true, lines: [], base: 0, total: 0, vat: '21' });
});

test('rawVatLines conserva lo escrito', () => {
  assert.deepEqual(rawVatLines(form([{ base: '12,5', rate: '1000' }, { base: '', rate: '2100', total: '' }])), [{ base: '12,5', rate: '1000', total: '' }]);
});

test('linesOf: desglose guardado y filas antiguas', () => {
  const lines = [{ rate: 1000, label: 'IVA 10 %', base: 100, total: 110 }];
  assert.deepEqual(linesOf({ vat_lines: JSON.stringify(lines) }), lines);
  assert.deepEqual(linesOf({ vat: '21', base_cents: 100, total_cents: 121 }), [{ rate: 2100, label: 'IVA 21 %', base: 100, total: 121 }]);
  assert.equal(linesOf({ vat: 'mixto', base_cents: 100, total_cents: 115 })[0].rate, null);
  assert.equal(vatColumn([{ rate: 950 }]), '9.5');
});

test('factura al cliente sin importe: la suma de las PO con el tipo por defecto', () => {
  const r = invoiceAmounts(form([]), RATES, [{ po_id: 1, amount: 1000000 }, { po_id: 2, amount: 392220 }]);
  assert.equal(r.ok, true);
  assert.equal(r.base, 1392220);
  assert.equal(r.total, 1684586);
  assert.deepEqual(defaultLine(100, RATES).lines[0].label, 'IVA 21 %');
  assert.equal(invoiceAmounts(form([]), RATES, []).ok, false);
  assert.equal(invoiceAmounts(form([{ base: '50', rate: '1000' }]), RATES, [{ po_id: 1, amount: 1 }]).base, 5000);
});
