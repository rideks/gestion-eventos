import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLineAmounts, pvpOf, bookingSummary, bookingDates, bookingReference, personName, LINE_KINDS } from '../src/lib/travel.js';
import { btLineSchema, BtPassengerSchema, ClientSchema, validate } from '../src/lib/validate.js';
import { sectionPermission, normalizePermissions } from '../src/lib/permissions.js';

test('importes: el ejemplo del encargo (100 + 21 % = 121; fee 15; PVP 136)', () => {
  const r = parseLineAmounts({ base: '100', total: '', vat: '2100', fee: '15' });
  assert.deepEqual(r, { ok: true, base: 10000, total: 12100, vat_bp: 2100, fee: 1500 });
  assert.equal(pvpOf(r.total, r.fee), 13600);
});

test('importes: con IVA → sin IVA, y si se escriben los dos se respetan', () => {
  assert.equal(parseLineAmounts({ base: '', total: '121', vat: '2100', fee: '' }).base, 10000);
  assert.equal(parseLineAmounts({ base: '', total: '246', vat: '1000', fee: '' }).base, 22364); // 246 / 1,10 = 223,636…
  const both = parseLineAmounts({ base: '223,63', total: '246', vat: '1000', fee: '0' });
  assert.deepEqual([both.base, both.total], [22363, 24600]);
  assert.equal(parseLineAmounts({ base: '1.234,56', total: '', vat: '0', fee: '' }).total, 123456); // vuelo internacional, sin IVA
});

test('importes: errores y fee', () => {
  assert.equal(parseLineAmounts({ base: '', total: '', vat: '2100', fee: '' }).field, 'amount');
  assert.equal(parseLineAmounts({ base: 'cien', total: '', vat: '2100', fee: '' }).field, 'amount');
  assert.equal(parseLineAmounts({ base: '100', total: '', vat: '', fee: '' }).field, 'vat');
  assert.equal(parseLineAmounts({ base: '100', total: '', vat: '2100', fee: '-5' }).field, 'fee');
  assert.equal(parseLineAmounts({ base: '100', total: '', vat: '2100', fee: 'x' }).field, 'fee');
  assert.equal(parseLineAmounts({ base: '100', total: '', vat: '2100', fee: '' }).fee, 0);
  // Sin permiso para el fee no se lee: null (el servicio conserva el que tenía)
  assert.equal(parseLineAmounts({ base: '100', total: '', vat: '2100', fee: null }).fee, null);
});

test('resumen de una reserva: suma sus servicios, por bloque, sin multiplicar por pasajeros', () => {
  const lines = [
    { kind: 'transporte', base_cents: 22364, total_cents: 24600, fee_cents: 1500, pvp_cents: 26100 },
    { kind: 'alojamiento', base_cents: 72000, total_cents: 79200, fee_cents: 4000, pvp_cents: 83200 },
    { kind: 'inscripcion', base_cents: 65000, total_cents: 78650, fee_cents: 1000, pvp_cents: 79650 },
    { kind: 'inscripcion', base_cents: 65000, total_cents: 78650, fee_cents: 1000, pvp_cents: 79650 },
  ];
  const s = bookingSummary(lines);
  assert.deepEqual([s.count, s.base, s.total, s.fee, s.pvp], [4, 224364, 261100, 7500, 268600]);
  assert.equal(s.pvp, s.total + s.fee);
  assert.deepEqual(s.byKind.inscripcion, { count: 2, base: 130000, total: 157300, fee: 2000, pvp: 159300 });
  assert.deepEqual(s.byKind.otros, { count: 0, base: 0, total: 0, fee: 0, pvp: 0 });
  assert.equal(bookingSummary([]).pvp, 0);
});

test('fechas, referencia y nombres', () => {
  assert.deepEqual(bookingDates([{ start_date: '2026-11-18', end_date: '2026-11-20' }, { start_date: '2026-11-17', end_date: null }]), { from: '2026-11-17', to: '2026-11-20' });
  assert.deepEqual(bookingDates([]), { from: null, to: null });
  assert.equal(bookingReference('2026', 7), 'BT-2026-0007');
  assert.equal(personName({ title: 'Dra.', first_name: 'María', last_name: 'López' }), 'Dra. María López');
  assert.equal(personName({ title: null, first_name: 'Javier', last_name: 'Martín' }), 'Javier Martín');
});

test('servicios: lo obligatorio de cada bloque y fechas en orden', () => {
  const t = LINE_KINDS.transporte;
  assert.equal(validate(btLineSchema(t.fields, t.required), {}).errors.start_date, 'Fecha de ida: elige una fecha');
  const back = validate(btLineSchema(t.fields, t.required), { start_date: '2026-11-20', end_date: '2026-11-18' });
  assert.match(back.errors.end_date, /Fecha de vuelta: no puede ser anterior a fecha de ida/);
  const a = LINE_KINDS.alojamiento;
  assert.ok(validate(btLineSchema(a.fields, a.required), { start_date: '2026-11-18' }).errors.end_date);
  const i = LINE_KINDS.inscripcion;
  assert.equal(validate(btLineSchema(i.fields, i.required), {}).errors.description, 'Inscripción, actividad o evento: escríbelo');
  assert.ok(validate(btLineSchema(i.fields, i.required), { description: 'Congreso SEOM' }).ok);
});

test('pasajeros y clientes: tratamiento Dr./Dra.; una empresa no lleva tratamiento', () => {
  assert.ok(validate(BtPassengerSchema, { title: 'Dra.', first_name: 'María', last_name: 'López', email: 'MARIA@example.com' }).ok);
  assert.ok(validate(BtPassengerSchema, { title: '', first_name: 'Javier', last_name: 'Martín' }).ok);
  assert.equal(validate(BtPassengerSchema, { title: 'Sr.', first_name: 'X', last_name: 'Y' }).ok, false);
  assert.equal(validate(BtPassengerSchema, { first_name: 'X', last_name: 'Y', email: 'no-es-un-email' }).ok, false);
  const persona = validate(ClientSchema, { name: 'Carlos García', status: 'activo', kind: 'persona', title: 'Dr.' });
  assert.deepEqual([persona.data.kind, persona.data.title], ['persona', 'Dr.']);
  const empresa = validate(ClientSchema, { name: 'BMW Ibérica', status: 'activo', kind: 'empresa', title: 'Dr.' });
  assert.deepEqual([empresa.data.kind, empresa.data.title], ['empresa', null]);
  assert.equal(validate(ClientSchema, { name: 'BMW', status: 'activo' }).data.kind, 'empresa');
});

test('permisos de Business Travel: su sección y el fee depende de ver los viajes', () => {
  assert.equal(sectionPermission('/viajes'), 'viajes');
  assert.equal(sectionPermission('/viajes/12'), 'viajes');
  assert.equal(sectionPermission('/viajesX'), null);
  assert.deepEqual(normalizePermissions(['viajes.fee']).permissions, []);
  assert.deepEqual(normalizePermissions(['viajes', 'viajes.fee']).permissions, ['viajes', 'viajes.fee']);
});

test('IVA propuesto por bloque (si está en la lista de Ajustes)', async () => {
  const { suggestedVat } = await import('../src/lib/travel.js');
  const rates = [{ rate_bp: 2100 }, { rate_bp: 1000 }, { rate_bp: 0 }];
  assert.equal(suggestedVat('alojamiento', rates, 2100), 1000);
  assert.equal(suggestedVat('inscripcion', rates, 2100), 2100);
  assert.equal(suggestedVat('otros', rates, 2100), 2100);
  assert.equal(suggestedVat('transporte', [{ rate_bp: 2100 }], 2100), 2100); // sin el 10 % en la lista
});
