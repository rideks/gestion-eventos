// Servicio de contratos contra una base SQLite en memoria con las migraciones y los datos de ejemplo:
// permisos, estados, la regla de «requiere atención» igual en SQL y en JS, renovaciones, historial y documentos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, EMAILS, memoryBucket } from './helpers/context.mjs';
import * as contracts from '../src/services/contracts.js';
import * as repo from '../src/repos/contracts.js';
import { contractState } from '../src/lib/contracts.js';
import { addDays, today } from '../src/lib/dates.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const setup = async () => {
  const db = await testDb({ demo: true });
  const bucket = memoryBucket();
  const as = (role) => contextFor(db, EMAILS[role], { bucket });
  const id = (name) => db.one('SELECT id FROM suppliers WHERE name = ?', name).id;
  return { db, bucket, as, id };
};
const pdf = (name = 'contrato.pdf') => new File([new TextEncoder().encode('%PDF-1.4 contrato de prueba')], name, { type: 'application/pdf' });
const NOW = today();
const base = (o = {}) => ({ title: 'Tarifa 2027', starts_on: NOW, ends_on: addDays(NOW, 365), alert_days: '60', rates: 'Doble 120 €', ...o });

test('ver contratos: Jefes, Administración y Tesorería; Eventos y Técnico no', { skip }, async () => {
  const { as, id } = await setup();
  for (const role of ['jefes', 'administracion', 'tesoreria']) assert.equal((await contracts.list(as(role))).value.length, 8, role);
  for (const role of ['eventos', 'tecnico']) {
    assert.equal((await contracts.list(as(role))).code, 'forbidden', role);
    assert.equal((await contracts.due(as(role))).code, 'forbidden', role);
    assert.equal((await contracts.detail(as(role), id('Hotel Barceló Valladolid'), 9002)).code, 'forbidden', role);
  }
  const list = (await contracts.list(as('jefes'))).value;
  assert.deepEqual(list.slice(0, 3).map((c) => c.state.key), ['caducado', 'por_caducar', 'pendiente']);
});

test('«requiere atención»: la regla en SQL (menú e inicio) da lo mismo que contractState, sea el día que sea', { skip }, async () => {
  const { db } = await setup();
  const all = db.rows('SELECT c.*, (SELECT r.id FROM supplier_contracts r WHERE r.replaces_id = c.id) AS renewed_by FROM supplier_contracts c');
  for (const shift of [-800, -400, -60, -11, -10, 0, 30, 44, 45, 46, 150, 400, 900]) {
    const day = addDays(NOW, shift);
    const js = all.filter((c) => contractState(c, day).attention).map((c) => c.id).sort();
    const sql = (await repo.due(db, day)).map((c) => c.id).sort();
    assert.deepEqual(sql, js, `día ${day}`);
    assert.equal(await repo.dueCount(db, day), js.length);
  }
});

test('un contrato: expedientes en los que se aplicó, sin importes si no hay permiso de gasto; de otro proveedor, no existe', { skip }, async () => {
  const { as, id } = await setup();
  const hb = id('Hotel Barceló Valladolid');
  const d = (await contracts.detail(as('jefes'), hb, 9002)).value;
  assert.equal(d.contract.state.key, 'por_caducar');
  assert.deepEqual(d.applied.map((e) => e.name), ['Workshop BMW']);
  assert.ok(d.applied[0].contracted > 0);
  const ctx = as('tesoreria');
  ctx.user.permissions.delete('proveedores.gasto');
  assert.ok(!('contracted' in (await contracts.detail(ctx, hb, 9002)).value.applied[0]));
  assert.equal((await contracts.detail(as('jefes'), id('Catering Lazo'), 9002)).code, 'not_found');
});

test('alta con documento: valida, guarda el archivo en prov/<proveedor>/ y apunta historial y actividad', { skip }, async () => {
  const { db, bucket, as, id } = await setup();
  const sonido = id('Sonido Toledo');
  assert.equal((await contracts.create(as('eventos'), sonido, base())).code, 'forbidden');
  const viewer = as('tesoreria');
  viewer.user.permissions.delete('contratos.edit');
  assert.equal((await contracts.create(viewer, sonido, base())).code, 'forbidden');
  const ctx = as('tesoreria');
  const bad = await contracts.create(ctx, sonido, base({ ends_on: addDays(NOW, -1) }));
  assert.deepEqual([bad.code, Object.keys(bad.fields)], ['invalid', ['ends_on']]);
  const fake = await contracts.create(ctx, sonido, base(), { file: new File(['no soy un pdf'], 'x.pdf') });
  assert.deepEqual([fake.code, Object.keys(fake.fields)], ['invalid', ['file']]);
  const r = await contracts.create(ctx, sonido, base(), { file: pdf() });
  assert.ok(r.ok);
  const c = db.one('SELECT c.*, f.key FROM supplier_contracts c JOIN files f ON f.id = c.file_id WHERE c.id = ?', r.value.id);
  assert.ok(c.key.startsWith(`prov/${sonido}/`) && bucket.files.has(c.key));
  assert.equal(c.alert_days, 60);
  assert.match(db.one('SELECT summary FROM supplier_contract_changes WHERE contract_id = ?', r.value.id).summary, /^Alta del contrato · .* · con documento$/);
  assert.equal(db.one("SELECT COUNT(*) n FROM activity WHERE action = 'contract.create'").n, 1);
  // Sin fecha de fin no hay nada de lo que avisar
  const open = await contracts.create(ctx, sonido, base({ ends_on: '' }));
  assert.equal(db.one('SELECT alert_days FROM supplier_contracts WHERE id = ?', open.value.id).alert_days, null);
});

test('renovar: contrato nuevo con las condiciones del anterior; el anterior se conserva y no se renueva dos veces', { skip }, async () => {
  const { db, as, id } = await setup();
  const lazo = id('Catering Lazo');
  const ctx = as('jefes');
  const dr = (await contracts.draft(ctx, lazo, 9004)).value;
  assert.equal(dr.values.starts_on, addDays(db.one('SELECT ends_on FROM supplier_contracts WHERE id = 9004').ends_on, 1));
  assert.equal(dr.values.rates, db.one('SELECT rates FROM supplier_contracts WHERE id = 9004').rates);
  db.raw.exec("UPDATE supplier_contracts SET renewal = 'pendiente' WHERE id = 9004");
  const r = await contracts.create(ctx, lazo, { ...dr.values, title: 'Catering 2027', rates: 'Nuevas tarifas' }, { renewsId: 9004 });
  assert.deepEqual([r.ok, r.value.renewed], [true, true]);
  const prev = db.one('SELECT rates, renewal FROM supplier_contracts WHERE id = 9004');
  assert.deepEqual(prev, { rates: 'Coffee break 9,50 € · cóctel 32 € · cena de gala 68 € por persona', renewal: null });
  assert.equal((await contracts.detail(ctx, lazo, 9004)).value.contract.state.key, 'renovado');
  const again = await contracts.draft(ctx, lazo, 9004);
  assert.deepEqual([again.code, again.renewedBy], ['renewed', r.value.id]);
  assert.equal((await contracts.create(ctx, lazo, dr.values, { renewsId: 9004 })).code, 'renewed');
  // El contrato renovado no se borra; si se borra la renovación, el anterior vuelve a estar sin renovar
  assert.equal((await contracts.remove(ctx, lazo, 9004)).code, 'conflict');
  assert.ok((await contracts.remove(ctx, lazo, r.value.id)).ok);
  assert.equal((await contracts.detail(ctx, lazo, 9004)).value.contract.state.key, 'caducado');
  assert.match(db.one("SELECT summary FROM supplier_contract_changes WHERE contract_id = 9004 ORDER BY id DESC LIMIT 1").summary, /Se borró su renovación/);
});

test('modificar: el historial guarda qué cambió (antes y después); sin cambios no se apunta nada', { skip }, async () => {
  const { db, as, id } = await setup();
  const hb = id('Hotel Barceló Valladolid');
  const ctx = as('administracion');
  const c = db.one('SELECT * FROM supplier_contracts WHERE id = 9002');
  const same = { ...c, alert_days: String(c.alert_days) };
  const count = () => db.one('SELECT COUNT(*) n FROM supplier_contract_changes WHERE contract_id = 9002').n;
  const before = count();
  assert.equal((await contracts.update(ctx, hb, 9002, same)).value.changed, false);
  assert.equal(count(), before);
  const r = await contracts.update(ctx, hb, 9002, { ...same, ends_on: addDays(c.ends_on, 90), rates: 'Doble 125 €' });
  assert.match(r.value.summary, /^Fin: .* → .* · Tarifas$/);
  const h = db.one("SELECT changes FROM supplier_contract_changes WHERE contract_id = 9002 AND action = 'cambio' ORDER BY id DESC LIMIT 1");
  assert.deepEqual(JSON.parse(h.changes).rates, [c.rates, 'Doble 125 €']);
  assert.equal((await contracts.update(as('eventos'), hb, 9002, same)).code, 'forbidden');
});

test('renovación: pendiente, no se renueva y quitar la marca; documento sustituido y borrado', { skip }, async () => {
  const { db, bucket, as, id } = await setup();
  const fluge = id('Fluge Audiovisuales');
  const ctx = as('tesoreria');
  assert.equal((await contracts.setRenewal(ctx, fluge, 9005, { renewal: 'quizá' })).code, 'invalid');
  await contracts.setRenewal(ctx, fluge, 9005, { renewal: 'no' });
  assert.equal((await contracts.detail(ctx, fluge, 9005)).value.contract.state.attention, false);
  await contracts.setRenewal(ctx, fluge, 9005, { renewal: '' });
  assert.equal(db.one('SELECT renewal FROM supplier_contracts WHERE id = 9005').renewal, null);
  assert.equal((await contracts.setRenewal(ctx, id('Hotel Barceló Valladolid'), 9001, { renewal: 'no' })).code, 'conflict'); // ya renovado
  assert.equal((await contracts.replaceDocument(ctx, fluge, 9005, null)).code, 'invalid');
  await contracts.replaceDocument(ctx, fluge, 9005, pdf('v1.pdf'));
  const first = db.one('SELECT f.id, f.key FROM supplier_contracts c JOIN files f ON f.id = c.file_id WHERE c.id = 9005');
  await contracts.replaceDocument(ctx, fluge, 9005, pdf('v2.pdf'));
  assert.ok(!bucket.files.has(first.key) && !db.one('SELECT id FROM files WHERE id = ?', first.id), 'el documento anterior se borra');
  const second = db.one('SELECT f.id, f.key FROM supplier_contracts c JOIN files f ON f.id = c.file_id WHERE c.id = 9005');
  assert.ok((await contracts.remove(ctx, fluge, 9005)).ok);
  assert.ok(!bucket.files.has(second.key) && !db.one('SELECT id FROM files WHERE id = ?', second.id), 'al borrar el contrato se borra su documento');
  assert.equal(db.one('SELECT COUNT(*) n FROM supplier_contract_changes WHERE contract_id = 9005').n, 0);
});
