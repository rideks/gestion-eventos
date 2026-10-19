import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractState, contractOn, contractDiff, renewalDraft, byUrgency } from '../src/lib/contracts.js';
import { addDays } from '../src/lib/dates.js';
import { normalizePermissions, sectionPermission } from '../src/lib/permissions.js';

const NOW = '2026-10-19';
const c = (o) => ({ starts_on: '2026-01-01', ends_on: '2026-12-31', alert_days: 60, renewal: null, renewed_by: null, ...o });

test('estado: vigente, próximo a caducar según el aviso de cada contrato, sin fin', () => {
  assert.equal(contractState(c({ ends_on: '2027-06-30' }), NOW).key, 'vigente');
  const soon = contractState(c({ ends_on: '2026-12-03' }), NOW); // faltan 45 días, aviso 60
  assert.deepEqual([soon.key, soon.days, soon.text, soon.attention], ['por_caducar', 45, 'Caduca en 45 días', true]);
  // El mismo contrato con un aviso de 30 días todavía no avisa
  assert.equal(contractState(c({ ends_on: '2026-12-03', alert_days: 30 }), NOW).key, 'vigente');
  assert.equal(contractState(c({ ends_on: '2026-12-03', alert_days: null }), NOW).key, 'vigente');
  assert.equal(contractState(c({ ends_on: NOW }), NOW).text, 'Caduca hoy');
  const open = contractState(c({ ends_on: null, alert_days: null }), NOW);
  assert.deepEqual([open.key, open.days, open.text], ['vigente', null, 'Sin fecha de fin']);
});

test('estado: caducado, renovado, finalizado, pendiente y aún no vigente', () => {
  const expired = contractState(c({ ends_on: '2026-10-09' }), NOW);
  assert.deepEqual([expired.key, expired.text, expired.attention], ['caducado', 'Caducó hace 10 días', true]);
  assert.equal(contractState(c({ ends_on: '2026-10-09', renewed_by: 7 }), NOW).key, 'renovado');
  assert.equal(contractState(c({ ends_on: '2026-10-09', renewal: 'no' }), NOW).key, 'finalizado');
  assert.equal(contractState(c({ ends_on: '2026-10-09', renewal: 'pendiente' }), NOW).text, 'Caducó hace 10 días · pendiente de renovación');
  const pending = contractState(c({ ends_on: '2027-03-18', renewal: 'pendiente' }), NOW);
  assert.deepEqual([pending.key, pending.attention], ['pendiente', true]);
  // Ya renovado o decidido no renovar: no avisa aunque esté dentro del aviso
  assert.equal(contractState(c({ ends_on: '2026-11-01', renewed_by: 3 }), NOW).attention, false);
  assert.equal(contractState(c({ ends_on: '2026-11-01', renewal: 'no' }), NOW).text, 'Caduca en 13 días · no se renovará');
  const future = contractState(c({ starts_on: '2027-01-01', ends_on: '2027-12-31' }), NOW);
  assert.deepEqual([future.key, future.attention], ['futuro', false]);
});

test('contrato aplicado a un expediente: el que estaba en vigor en la fecha del evento', () => {
  const list = [
    { id: 1, starts_on: '2024-02-01', ends_on: '2025-01-31' },
    { id: 2, starts_on: '2025-02-01', ends_on: '2026-12-03' },
    { id: 3, starts_on: '2026-06-01', ends_on: null }, // se solapa: manda el que empezó más tarde
  ];
  assert.equal(contractOn(list, '2024-06-10').id, 1);
  assert.equal(contractOn(list, '2025-02-01').id, 2);
  assert.equal(contractOn(list, '2026-08-26').id, 3);
  assert.equal(contractOn(list, '2023-12-31'), null);
  assert.equal(contractOn(list, null), null);
});

test('historial: qué ha cambiado, con las fechas y el aviso legibles', () => {
  const before = { title: 'Tarifa 2026', starts_on: '2026-01-01', ends_on: '2026-12-31', rates: 'A', alert_days: 30, notes: null };
  const after = { ...before, ends_on: '2027-06-30', rates: 'B', alert_days: 60, notes: null };
  const d = contractDiff(before, after);
  assert.equal(d.summary, 'Fin: 31/12/2026 → 30/06/2027 · Tarifas · Aviso: 30 días → 60 días');
  assert.deepEqual(d.changes.rates, ['A', 'B']);
  assert.equal(contractDiff(before, { ...before }).summary, '');
});

test('renovación: mismas condiciones, empieza al día siguiente y dura lo mismo', () => {
  const draft = renewalDraft({ title: 'Tarifa 2026', starts_on: '2026-01-01', ends_on: '2026-12-31', rates: 'A', alert_days: 60 }, addDays);
  assert.deepEqual([draft.starts_on, draft.ends_on, draft.rates, draft.alert_days], ['2027-01-01', '2027-12-31', 'A', 60]);
  assert.equal(renewalDraft({ title: 'Marco', starts_on: '2026-03-01', ends_on: null }, addDays).starts_on, '');
});

test('orden: primero lo que requiere atención (lo que antes caduca), luego lo vigente y al final el historial', () => {
  const rows = [
    { id: 1, ends_on: '2025-01-31', state: { key: 'renovado', attention: false } },
    { id: 2, ends_on: '2027-12-31', state: { key: 'vigente', attention: false } },
    { id: 3, ends_on: '2026-12-03', state: { key: 'por_caducar', attention: true } },
    { id: 4, ends_on: '2026-10-09', state: { key: 'caducado', attention: true } },
  ];
  assert.deepEqual(rows.sort(byUrgency).map((r) => r.id), [4, 3, 2, 1]);
});

test('permisos de contratos: dependen de ver proveedores; las páginas de contratos piden el suyo', () => {
  assert.deepEqual(normalizePermissions(['expedientes', 'contratos', 'contratos.edit']).permissions, ['expedientes']);
  assert.deepEqual(normalizePermissions(['expedientes', 'proveedores', 'contratos.edit']).permissions, ['expedientes', 'proveedores']);
  assert.deepEqual(normalizePermissions(['expedientes', 'proveedores', 'contratos', 'contratos.edit']).permissions, ['expedientes', 'proveedores', 'contratos', 'contratos.edit']);
  assert.equal(sectionPermission('/proveedores/contratos'), 'contratos');
  assert.equal(sectionPermission('/proveedores/12/contratos/nuevo'), 'contratos');
  assert.equal(sectionPermission('/proveedores/12/contratos/3'), 'contratos');
  assert.equal(sectionPermission('/proveedores/12'), 'proveedores');
});
