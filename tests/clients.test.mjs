import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feeLabel, seniority, stageOf, clientVolume } from '../src/lib/clients.js';
import { diffFields } from '../src/lib/changes.js';
import { ClientSchema, ClientEntitySchema, ExpedienteFeeSchema, validate } from '../src/lib/validate.js';
import { sectionPermission, normalizePermissions } from '../src/lib/permissions.js';
import { similarNames } from '../src/lib/name-match.js';

test('feeLabel: puntos básicos → porcentaje', () => {
  assert.equal(feeLabel(1000), '10 %');
  assert.equal(feeLabel(750), '7,5 %');
  assert.equal(feeLabel(0), '0 %');
  assert.equal(feeLabel(null), null);
});

test('fee: se escribe como en el Excel y se guarda en puntos básicos', () => {
  const fee = (v) => validate(ExpedienteFeeSchema, { fee: v });
  assert.equal(fee('10').data.fee, 1000);
  assert.equal(fee('7,5').data.fee, 750);
  assert.equal(fee('12 %').data.fee, 1200);
  assert.equal(fee('').data.fee, null);
  assert.equal(fee('150').ok, false);
  assert.equal(fee('mucho').ok, false);
});

test('ficha del cliente: NIF limpio, nombre obligatorio, entidades con nombre fiscal', () => {
  const r = validate(ClientSchema, { name: 'BMW Ibérica', status: 'activo', tax_id: ' a-1234.5678 ' });
  assert.ok(r.ok);
  assert.equal(r.data.tax_id, 'A-12345678');
  assert.equal(validate(ClientSchema, { name: 'BMW', status: 'activo', tax_id: '12' }).ok, false);
  assert.equal(validate(ClientSchema, { name: '', status: 'activo' }).ok, false);
  assert.equal(validate(ClientSchema, { name: 'BMW', status: 'raro' }).ok, false);
  assert.equal(validate(ClientEntitySchema, { legal_name: '', tax_id: 'B12345678' }).ok, false);
  assert.ok(validate(ClientEntitySchema, { legal_name: 'Grunblau, S.L.', tax_id: '' }).ok);
});

test('seniority: desde el inicio de la relación o, si no se sabe, desde su primer evento', () => {
  const s = seniority('2023-03-01', '2024-05-01', '2026-10-19');
  assert.deepEqual([s.from, s.verified, s.years, s.months, s.label], ['2023-03-01', true, 3, 7, '3 años y 7 meses']);
  const e = seniority(null, '2026-05-06', '2026-10-19');
  assert.deepEqual([e.from, e.verified, e.label], ['2026-05-06', false, '5 meses']);
  assert.equal(seniority(null, '2026-10-10', '2026-10-19').label, 'menos de un mes');
  assert.equal(seniority('2025-10-19', null, '2026-10-19').label, '1 año');
  assert.equal(seniority(null, null, '2026-10-19'), null);
  assert.equal(seniority(null, '2027-04-20', '2026-10-19'), null); // su primer evento aún no ha llegado
});

test('stageOf: previsto, en curso, terminado o cancelado', () => {
  const now = '2026-10-19';
  assert.equal(stageOf({ status: 'solicitado', start_date: '2026-01-01' }, now), 'previsto');
  assert.equal(stageOf({ status: 'abierto', start_date: '2026-11-12', end_date: '2026-11-14' }, now), 'previsto');
  assert.equal(stageOf({ status: 'abierto', start_date: '2026-10-18', end_date: '2026-10-20' }, now), 'en_curso');
  assert.equal(stageOf({ status: 'abierto', start_date: '2026-10-19', end_date: null }, now), 'en_curso');
  assert.equal(stageOf({ status: 'abierto', start_date: '2026-08-26', end_date: '2026-08-27' }, now), 'terminado');
  assert.equal(stageOf({ status: 'cerrado', start_date: '2027-01-01' }, now), 'terminado');
  assert.equal(stageOf({ status: 'cancelado', start_date: '2027-01-01' }, now), 'cancelado');
});

// Una fila por expediente, como las devuelve la ficha del cliente (céntimos; base sin IVA, cobros con IVA)
const rows = [
  { status: 'cerrado', start_date: '2025-05-06', end_date: '2025-05-07', destination: 'Toledo', budget_base: 1000000, invoiced_base: 1000000, collected_total: 1210000, pending_total: 0, fee_bp: 800 },
  { status: 'abierto', start_date: '2026-08-26', end_date: '2026-08-27', destination: 'Valladolid', budget_base: 3000000, invoiced_base: 2000000, collected_total: 1210000, pending_total: 1210000, fee_bp: 1000 },
  { status: 'solicitado', start_date: '2026-11-12', end_date: '2026-11-14', destination: 'Toledo', budget_base: 1000000, invoiced_base: 0, collected_total: 0, pending_total: 0, fee_bp: null },
  // Cancelado: cuenta como etapa, pero en ningún importe
  { status: 'cancelado', start_date: '2026-03-01', end_date: '2026-03-02', destination: 'Sevilla', budget_base: 9999999, invoiced_base: 0, collected_total: 0, pending_total: 0, fee_bp: 1500 },
];

test('clientVolume: totales sin cancelados, cada importe con su IVA y el año del evento', () => {
  const v = clientVolume(rows, 2026, '2026-10-19');
  assert.equal(v.exps, 3);
  assert.deepEqual(v.stages, { previsto: 1, en_curso: 0, terminado: 2, cancelado: 1 });
  assert.equal(v.budget, 5000000);
  assert.equal(v.invoiced, 3000000);
  assert.equal(v.collected, 2420000);
  assert.equal(v.pending, 1210000);
  assert.equal(v.thisYear, 4000000);
  assert.equal(v.average, Math.round(5000000 / 3));
  // Fee medio ponderado por presupuesto, sólo de los que lo tienen: (800·1M + 1000·3M) / 4M
  assert.equal(v.averageFeeBp, 950);
  assert.deepEqual([v.first, v.last], ['2025-05-06', '2026-11-12']);
  assert.deepEqual(v.byYear.map((y) => [y.key, y.exps, y.budget, y.change]), [['2026', 2, 4000000, 3], ['2025', 1, 1000000, null]]);
  assert.deepEqual(v.byCity.map((c) => [c.key, c.exps]), [['Valladolid', 1], ['Toledo', 2]]);
});

test('clientVolume: un cliente sin expedientes', () => {
  const v = clientVolume([], 2026, '2026-10-19');
  assert.deepEqual([v.exps, v.budget, v.average, v.averageFeeBp, v.first, v.byYear.length], [0, 0, 0, null, null, 0]);
});

test('diffFields: sólo lo que cambia, con su formato; los textos largos sin valores', () => {
  const fields = { fee_bp: { label: 'Fee', format: feeLabel }, payment_terms: { label: 'Acuerdo de pago', show: false }, tax_id: { label: 'NIF' } };
  const d = diffFields({ fee_bp: 800, payment_terms: 'A 30 días', tax_id: null }, { fee_bp: 1000, payment_terms: 'A 60 días', tax_id: 'A1' }, fields);
  assert.equal(d.summary, 'Fee: 8 % → 10 % · Acuerdo de pago · NIF: sin dato → A1');
  assert.deepEqual(d.changes.fee_bp, [800, 1000]);
  assert.equal(diffFields({ fee_bp: 800 }, { fee_bp: 800 }, fields).summary, '');
});

test('nombres parecidos de clientes: sin la forma jurídica ni el país', () => {
  const options = [{ id: 1, name: 'BMW Ibérica' }, { id: 2, name: 'ROCHE FARMA' }, { id: 3, name: 'ELECNOR' }];
  assert.deepEqual(similarNames('BMW Group España', options).map((x) => x.name), ['BMW Ibérica']);
  assert.deepEqual(similarNames('Roche Farma S.A.', options).map((x) => x.name), ['ROCHE FARMA']);
  assert.deepEqual(similarNames('Sanofi', options), []);
});

test('permisos de clientes: dependen de ver clientes, y ver clientes de ver expedientes', () => {
  assert.equal(sectionPermission('/clientes'), 'clientes');
  assert.equal(sectionPermission('/clientes/4'), 'clientes');
  assert.equal(sectionPermission('/clientes/alta'), 'clientes');
  assert.equal(sectionPermission('/clientesX'), null);
  assert.deepEqual(normalizePermissions(['clientes', 'clientes.economia']).permissions, []);
  assert.deepEqual(normalizePermissions(['expedientes', 'clientes.economia']).permissions, ['expedientes']);
  assert.deepEqual(normalizePermissions(['expedientes', 'clientes', 'clientes.create', 'clientes.edit', 'clientes.economia']).permissions,
    ['expedientes', 'clientes', 'clientes.create', 'clientes.edit', 'clientes.economia']);
});
