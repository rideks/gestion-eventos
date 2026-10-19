// Servicio de clientes contra una base SQLite en memoria con las migraciones y los datos de ejemplo:
// lo que ve cada rol (y lo que no llega), alta con parecidos, historial de condiciones, fusión, entidades
// y el cliente de una solicitud.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, EMAILS } from './helpers/context.mjs';
import * as clients from '../src/services/clients.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const NOW = '2026-10-19';
const setup = async () => {
  const db = await testDb({ demo: true });
  const as = (role, { without = [] } = {}) => {
    const ctx = contextFor(db, EMAILS[role], { now: NOW });
    for (const p of without) ctx.user.permissions.delete(p);
    return ctx;
  };
  const id = (name) => db.one('SELECT id FROM clients WHERE name = ?', name).id;
  return { db, as, id };
};
const ECONOMY = ['legal_name', 'tax_id', 'fiscal_address', 'billing_email', 'payment_terms', 'fee_bp'];

test('directorio: Eventos sin importes ni fee; sin «cobros», sin lo facturado; Técnico no entra', { skip }, async () => {
  const { db, as } = await setup();
  const ev = await clients.directory(as('eventos'), { order: 'volumen' });
  assert.ok(ev.ok);
  assert.deepEqual([ev.value.economy, ev.value.billing, ev.value.order], [false, false, 'name']);
  assert.ok(!('volumen' in ev.value.orders));
  assert.ok(ev.value.rows.every((r) => !('fee_bp' in r) && !('budget' in r) && !('invoiced' in r) && !('pending' in r)));
  const adm = await clients.directory(as('administracion'), { order: 'volumen' });
  assert.deepEqual([adm.value.economy, adm.value.billing, adm.value.order], [true, true, 'volumen']);
  assert.ok(adm.value.rows[0].budget >= adm.value.rows[1].budget);
  const total = db.one(`SELECT SUM((SELECT b.base_cents FROM budgets b WHERE b.expediente_id = e.id ORDER BY b.version DESC LIMIT 1)) AS n
                          FROM expedientes e WHERE e.status <> 'cancelado' AND e.client_id IS NOT NULL`).n;
  assert.equal(adm.value.rows.reduce((a, r) => a + r.budget, 0), total);
  const noBilling = await clients.directory(as('administracion', { without: ['cobros'] }));
  assert.deepEqual([noBilling.value.economy, noBilling.value.billing], [true, false]);
  assert.ok(noBilling.value.rows.every((r) => 'budget' in r && !('invoiced' in r) && !('pending' in r)));
  assert.equal((await clients.directory(as('tecnico'))).code, 'forbidden');
});

test('directorio y buscador: por nombre fiscal, NIF o una de sus entidades', { skip }, async () => {
  const { as } = await setup();
  const names = async (q) => (await clients.directory(as('eventos'), { q })).value.rows.map((r) => r.name);
  assert.deepEqual(await names('Grunblau'), ['BMW Ibérica']);
  assert.deepEqual(await names('A00000002'), ['ELECNOR']);
  assert.deepEqual(await names('Roche Farma, S.A.'), ['ROCHE FARMA']);
  assert.deepEqual((await clients.directory(as('eventos'), { status: 'inactivo' })).value.rows, []);
  assert.deepEqual((await clients.search(as('eventos'), 'celtamotor')).value.map((r) => r.name), ['BMW Ibérica']);
  assert.deepEqual((await clients.search(as('eventos'), 'b')).value, []); // menos de dos letras
  assert.equal((await clients.search(as('tecnico'), 'BMW')).code, 'forbidden');
});

test('ficha: Eventos ve contactos y expedientes, pero ni datos fiscales, ni fee, ni importes, ni historial', { skip }, async () => {
  const { as, id } = await setup();
  const bmw = id('BMW Ibérica');
  const ev = (await clients.ficha(as('eventos'), bmw)).value;
  for (const f of ECONOMY) assert.ok(!(f in ev.client), f);
  assert.equal(ev.client.phone !== undefined, true);
  assert.ok(ev.expedientes.length && ev.expedientes.every((e) => !('fee_bp' in e) && !('budget_base' in e) && !('invoiced_base' in e)));
  assert.deepEqual([ev.entities, ev.history, ev.others, ev.editable], [[], [], [], false]);
  assert.ok(!('budget' in ev.volume) && !('invoiced' in ev.volume) && ev.volume.byCity.every((c) => !('budget' in c)));
  assert.ok(ev.suppliers.length && ev.suppliers.every((s) => !('contracted' in s)));
  assert.ok(ev.contacts.length > 0);
  // Administración: todo, con el historial de condiciones y la antigüedad desde el inicio de la relación
  const adm = (await clients.ficha(as('administracion'), bmw)).value;
  assert.equal(adm.client.fee_bp, 1000);
  assert.equal(adm.entities.length, 9);
  assert.ok(adm.history.some((h) => h.action === 'condiciones' && h.summary === 'Fee: 8 % → 10 %'));
  assert.deepEqual([adm.seniority.from, adm.seniority.verified, adm.seniority.label], ['2023-03-01', true, '3 años y 7 meses']);
  assert.equal(adm.volume.budget, adm.expedientes.filter((e) => e.status !== 'cancelado').reduce((a, e) => a + (e.budget_base ?? 0), 0));
  assert.ok('invoiced' in adm.volume && adm.suppliers.every((s) => 'contracted' in s));
  assert.ok(adm.editable && adm.others.length === 3);
  assert.equal(adm.expedientes[0].fee_bp, 800); // el fee de cada expediente, el que se le aplicó
  assert.equal((await clients.ficha(as('administracion'), 999999)).code, 'not_found');
  assert.equal((await clients.ficha(as('tecnico'), bmw)).code, 'forbidden');
});

test('alta: avisa de los parecidos, confirma con el mismo nombre y no deja repetir', { skip }, async () => {
  const { db, as } = await setup();
  const ctx = as('administracion');
  const input = { name: 'BMW Iberica S.A.', status: 'activo', fee: '9', tax_id: 'a 1111.1111' };
  const similar = await clients.create(ctx, input);
  assert.equal(similar.code, 'similar');
  assert.equal(similar.similar[0].name, 'BMW Ibérica');
  assert.equal((await clients.create(ctx, { ...input, confirm_similar: 'Otro' })).code, 'similar');
  const done = await clients.create(ctx, { ...input, name: ' BMW  Iberica S.A. ', confirm_similar: 'BMW Iberica S.A.' });
  assert.ok(done.ok);
  const row = db.one('SELECT * FROM clients WHERE id = ?', done.value.id);
  assert.deepEqual([row.name, row.fee_bp, row.tax_id, row.created_by], ['BMW Iberica S.A.', 900, 'A11111111', ctx.user.id]);
  assert.equal(db.one("SELECT summary FROM change_log WHERE entity = 'client' AND entity_id = ? AND action = 'alta'", done.value.id).summary, 'Alta del cliente · fee 9 %');
  assert.equal(db.one("SELECT COUNT(*) n FROM activity WHERE action = 'client.create'").n, 1);
  const taken = await clients.create(ctx, { name: 'bmw ibérica', status: 'activo' });
  assert.equal(taken.code, 'conflict');
  assert.match(taken.fields.name, /Ya existe: BMW Ibérica/);
  assert.equal((await clients.create(ctx, { name: 'X', status: 'activo' })).code, 'invalid');
  assert.equal((await clients.create(ctx, { name: 'Nuevo', status: 'activo', fee: '200' })).code, 'invalid');
  assert.equal((await clients.create(as('tecnico'), { name: 'Nuevo', status: 'activo' })).code, 'forbidden');
});

test('alta por Eventos: sin permiso económico no se guardan ni el fee ni los datos fiscales', { skip }, async () => {
  const { db, as } = await setup();
  const r = await clients.create(as('eventos'), { name: 'Sanofi', status: 'activo', city: 'Barcelona', fee: '15', tax_id: 'A22222222', payment_terms: 'A 30 días' });
  assert.ok(r.ok);
  const row = db.one('SELECT * FROM clients WHERE id = ?', r.value.id);
  assert.equal(row.city, 'Barcelona');
  for (const f of ECONOMY) assert.equal(row[f], null, f);
});

test('alta rápida (selector de una solicitud): nombre y ciudad; confirm=1 para dar de alta un parecido', { skip }, async () => {
  const { as } = await setup();
  const ctx = as('eventos');
  assert.ok((await clients.create(ctx, { name: 'SEOM', city: 'Madrid' }, { quick: true })).ok);
  assert.equal((await clients.create(ctx, { name: 'Roche' }, { quick: true })).code, 'similar');
  const r = await clients.create(ctx, { name: 'Roche', confirm: '1' }, { quick: true });
  assert.deepEqual([r.ok, r.value.status, r.value.aliases], [true, 'activo', []]);
});

test('editar: el fee nuevo queda en el historial y no cambia el de los expedientes ya pedidos', { skip }, async () => {
  const { db, as, id } = await setup();
  const bmw = id('BMW Ibérica');
  const before = db.one('SELECT * FROM clients WHERE id = ?', bmw);
  const input = { ...before, fee: '12', payment_terms: 'A 60 días' };
  assert.equal((await clients.update(as('eventos'), bmw, input)).code, 'forbidden');
  const r = await clients.update(as('administracion'), bmw, input);
  assert.ok(r.ok);
  assert.equal(r.value.conditions, 'Fee: 10 % → 12 % · Acuerdo de pago');
  const last = db.one("SELECT * FROM change_log WHERE entity = 'client' AND entity_id = ? ORDER BY id DESC LIMIT 1", bmw);
  assert.equal(last.action, 'condiciones');
  assert.deepEqual(JSON.parse(last.changes).fee_bp, [1000, 1200]);
  assert.equal(db.one('SELECT fee_bp FROM clients WHERE id = ?', bmw).fee_bp, 1200);
  assert.deepEqual(db.rows('SELECT fee_bp FROM expedientes WHERE client_id = ?', bmw).map((e) => e.fee_bp), [800]);
  // Sin cambios de condiciones ni de datos fiscales: no se apunta nada en el historial
  const n = db.one('SELECT COUNT(*) n FROM change_log').n;
  assert.ok((await clients.update(as('administracion'), bmw, { ...input, phone: '910 000 000' })).ok);
  assert.equal(db.one('SELECT COUNT(*) n FROM change_log').n, n);
});

test('editar sin permiso económico: las condiciones y los datos fiscales se conservan', { skip }, async () => {
  const { db, as, id } = await setup();
  const bmw = id('BMW Ibérica');
  const before = db.one('SELECT * FROM clients WHERE id = ?', bmw);
  const ctx = as('administracion', { without: ['clientes.economia'] });
  const r = await clients.update(ctx, bmw, { name: 'BMW Ibérica', status: 'activo', city: 'Madrid', fee: '', tax_id: '', payment_terms: '' });
  assert.ok(r.ok);
  const after = db.one('SELECT * FROM clients WHERE id = ?', bmw);
  for (const f of ECONOMY) assert.equal(after[f], before[f], f);
});

test('renombrar: el nombre anterior sigue sirviendo y los expedientes muestran el nuevo', { skip }, async () => {
  const { db, as, id } = await setup();
  const roche = id('ROCHE FARMA');
  const c = db.one('SELECT * FROM clients WHERE id = ?', roche);
  const ctx = as('administracion');
  assert.ok((await clients.update(ctx, roche, { ...c, name: 'Roche Farma España', fee: '12' })).ok);
  assert.deepEqual(db.rows('SELECT alias FROM client_aliases WHERE client_id = ?', roche).map((a) => a.alias), ['ROCHE FARMA']);
  assert.deepEqual(db.rows('SELECT DISTINCT company FROM expedientes WHERE client_id = ?', roche).map((e) => e.company), ['Roche Farma España']);
  assert.match(db.one("SELECT summary FROM change_log WHERE entity_id = ? AND action = 'datos' ORDER BY id DESC LIMIT 1", roche).summary, /^Nombre: ROCHE FARMA → Roche Farma España/);
  assert.equal((await clients.resolveForExpediente(ctx, { name: 'roche farma' })).value.id, roche);
  // Un nombre que ya usa otro (también como nombre anterior) no se puede coger
  const elecnor = db.one('SELECT * FROM clients WHERE name = ?', 'ELECNOR');
  assert.equal((await clients.update(ctx, elecnor.id, { ...elecnor, name: 'Roche Farma', fee: '' })).code, 'conflict');
  assert.equal((await clients.create(ctx, { name: 'ROCHE FARMA', status: 'activo' })).code, 'conflict');
});

test('fusionar: expedientes, entidades (sin repetir NIF), nombres e historial pasan al bueno', { skip }, async () => {
  const { db, as, id } = await setup();
  const ctx = as('administracion');
  const bmw = id('BMW Ibérica');
  db.prepare('UPDATE clients SET since_on = NULL WHERE id = ?').bind(bmw).run();
  const dup = (await clients.create(ctx, { name: 'BMW Madrid', status: 'activo', phone: '600 000 000', since_on: '2020-01-01', confirm_similar: 'BMW Madrid' })).value.id;
  assert.ok((await clients.addEntity(ctx, dup, { legal_name: 'Grunblau (repetida)', tax_id: 'B00000005' })).ok);
  assert.ok((await clients.addEntity(ctx, dup, { legal_name: 'Concesionario Nuevo', tax_id: 'B99999999' })).ok);
  db.prepare('UPDATE expedientes SET client_id = ?, company = ? WHERE id = 4').bind(dup, 'BMW Madrid').run();
  assert.equal((await clients.merge(ctx, dup, dup)).code, 'invalid');
  assert.equal((await clients.merge(as('eventos'), dup, bmw)).code, 'forbidden');
  const r = await clients.merge(ctx, dup, bmw);
  assert.ok(r.ok);
  assert.equal(db.one('SELECT COUNT(*) n FROM clients WHERE id = ?', dup).n, 0);
  assert.deepEqual(db.one('SELECT client_id, company FROM expedientes WHERE id = 4'), { client_id: bmw, company: 'BMW Ibérica' });
  assert.equal(db.one('SELECT COUNT(*) n FROM client_entities WHERE client_id = ?', bmw).n, 10);
  assert.equal(db.one("SELECT legal_name FROM client_entities WHERE tax_id = 'B00000005'").legal_name, 'Grunblau');
  assert.equal(db.one("SELECT client_id FROM client_aliases WHERE alias = 'BMW Madrid'").client_id, bmw);
  assert.equal(db.one("SELECT COUNT(*) n FROM change_log WHERE entity = 'client' AND entity_id = ?", dup).n, 0);
  assert.ok(db.one("SELECT COUNT(*) n FROM change_log WHERE entity_id = ? AND action = 'fusion'", bmw).n === 1);
  // Lo que le faltaba al bueno se completa con lo del repetido; lo que tenía, se queda
  assert.deepEqual(db.one('SELECT phone, since_on, fee_bp FROM clients WHERE id = ?', bmw), { phone: '+34 910 000 001', since_on: '2020-01-01', fee_bp: 1000 });
  assert.equal((await clients.resolveForExpediente(ctx, { name: 'BMW Madrid' })).value.id, bmw);
});

test('borrar: sólo un cliente sin expedientes', { skip }, async () => {
  const { db, as, id } = await setup();
  const ctx = as('administracion');
  assert.equal((await clients.remove(ctx, id('BMW Ibérica'))).code, 'conflict');
  const tmp = (await clients.create(ctx, { name: 'Prueba Borrar', status: 'activo' })).value.id;
  assert.equal((await clients.remove(as('eventos'), tmp)).code, 'forbidden');
  assert.ok((await clients.remove(ctx, tmp)).ok);
  assert.equal(db.one('SELECT COUNT(*) n FROM clients WHERE id = ?', tmp).n, 0);
  assert.equal((await clients.remove(ctx, tmp)).code, 'not_found');
});

test('entidades de facturación: alta, cambio con historial, NIF sin repetir y baja', { skip }, async () => {
  const { db, as, id } = await setup();
  const ctx = as('administracion');
  const elecnor = id('ELECNOR');
  const bmw = id('BMW Ibérica');
  assert.equal((await clients.addEntity(as('eventos'), elecnor, { legal_name: 'Elecnor Servicios' })).code, 'forbidden');
  assert.equal((await clients.addEntity(as('administracion', { without: ['clientes.economia'] }), elecnor, { legal_name: 'Elecnor Servicios' })).code, 'forbidden');
  const add = await clients.addEntity(ctx, elecnor, { legal_name: 'Elecnor Servicios, S.L.', tax_id: 'b-3333 3333', email: 'facturas@example.com' });
  assert.ok(add.ok);
  assert.equal(db.one('SELECT tax_id FROM client_entities WHERE id = ?', add.value.id).tax_id, 'B-33333333');
  assert.equal((await clients.addEntity(ctx, elecnor, { legal_name: 'Otra', tax_id: 'B-33333333' })).code, 'conflict');
  const second = (await clients.addEntity(ctx, elecnor, { legal_name: 'Elecnor Medio Ambiente' })).value.id;
  assert.equal((await clients.updateEntity(ctx, elecnor, second, { legal_name: 'Elecnor Medio Ambiente', tax_id: 'B-33333333' })).code, 'conflict');
  const same = await clients.updateEntity(ctx, elecnor, add.value.id, { legal_name: 'Elecnor Servicios, S.L.', tax_id: 'B-33333333', email: 'facturas@example.com' });
  assert.deepEqual(same.value, { id: add.value.id, changed: false });
  const changed = await clients.updateEntity(ctx, elecnor, add.value.id, { legal_name: 'Elecnor Servicios, S.L.', tax_id: 'B-33333333', email: 'admin@example.com' });
  assert.ok(changed.value.changed);
  assert.equal(db.one("SELECT summary FROM change_log WHERE entity_id = ? AND action = 'entidad' ORDER BY id DESC LIMIT 1", elecnor).summary,
    'Entidad Elecnor Servicios, S.L.: Email: facturas@example.com → admin@example.com');
  // La entidad de otro cliente no se toca desde esta ficha
  assert.equal((await clients.updateEntity(ctx, bmw, add.value.id, { legal_name: 'X1' })).code, 'not_found');
  assert.equal((await clients.removeEntity(ctx, bmw, add.value.id)).code, 'not_found');
  assert.ok((await clients.removeEntity(ctx, elecnor, add.value.id)).ok);
  assert.equal(db.one('SELECT COUNT(*) n FROM client_entities WHERE client_id = ?', elecnor).n, 1);
});

test('cliente de una solicitud: de la lista (id), por su nombre exacto o anterior; nunca se crea aquí', { skip }, async () => {
  const { db, as, id } = await setup();
  const ctx = as('eventos');
  const bmw = id('BMW Ibérica');
  const byId = await clients.resolveForExpediente(ctx, { id: String(bmw), name: 'lo que sea' });
  assert.deepEqual([byId.value.id, byId.value.name, byId.value.fee_bp], [bmw, 'BMW Ibérica', 1000]);
  assert.equal((await clients.resolveForExpediente(ctx, { name: '  bmw   ibérica ' })).value.id, bmw);
  const n = db.one('SELECT COUNT(*) n FROM clients').n;
  const unknown = await clients.resolveForExpediente(ctx, { name: 'Roche' });
  assert.equal(unknown.code, 'invalid');
  assert.match(unknown.fields.company, /«Roche» no está dado de alta\. ¿Es «ROCHE FARMA»\?/);
  assert.equal(db.one('SELECT COUNT(*) n FROM clients').n, n);
  assert.match((await clients.resolveForExpediente(ctx, { id: '', name: '' })).fields.company, /elígela de la lista/);
  assert.equal((await clients.resolveForExpediente(ctx, { id: '999999', name: '' })).code, 'invalid');
  assert.equal((await clients.resolveForExpediente(as('tecnico'), { id: String(bmw) })).code, 'forbidden');
});
