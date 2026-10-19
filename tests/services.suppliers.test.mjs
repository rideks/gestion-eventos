// Servicio de proveedores contra una base SQLite en memoria con las migraciones y los datos de ejemplo:
// permisos (también los datos que se devuelven), validación, nombres parecidos y cambios en la base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, EMAILS } from './helpers/context.mjs';
import * as suppliers from '../src/services/suppliers.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const setup = async () => {
  const db = await testDb({ demo: true });
  const as = (role) => contextFor(db, EMAILS[role]);
  const id = (name) => db.one('SELECT id FROM suppliers WHERE name = ?', name).id;
  return { db, as, id };
};

test('directorio: sin permiso de gasto no llegan importes ni se puede ordenar por ellos', { skip }, async () => {
  const { as } = await setup();
  const ev = await suppliers.directory(as('eventos'), { order: 'gasto' });
  assert.ok(ev.ok);
  assert.equal(ev.value.money, false);
  assert.equal(ev.value.order, 'name');
  assert.ok(!('gasto' in ev.value.orders));
  assert.ok(ev.value.rows.every((r) => !('contracted' in r) && !('this_year' in r)));
  const adm = await suppliers.directory(as('administracion'), { order: 'gasto' });
  assert.equal(adm.value.order, 'gasto');
  assert.ok(adm.value.rows[0].contracted >= adm.value.rows[1].contracted);
  assert.equal((await suppliers.directory(as('tecnico'))).code, 'forbidden');
});

test('ficha: Eventos ve contacto e historial, pero ni condiciones económicas ni importes', { skip }, async () => {
  const { as, id } = await setup();
  const hb = id('Hotel Barceló Valladolid');
  const ev = (await suppliers.ficha(as('eventos'), hb)).value;
  assert.equal(ev.supplier.contact_name, 'Departamento de grupos');
  assert.ok(!('economic_terms' in ev.supplier) && !('payment_terms' in ev.supplier));
  assert.ok(ev.expedientes.length > 0 && ev.expedientes.every((e) => !('contracted' in e) && !('paid' in e)));
  assert.deepEqual(Object.keys(ev.volume).sort(), ['exps', 'first', 'last', 'lines']);
  assert.deepEqual([ev.editable, ev.types, ev.others], [false, [], []]);
  const adm = (await suppliers.ficha(as('administracion'), hb)).value;
  assert.match(adm.supplier.economic_terms, /Tarifa de grupos/);
  assert.equal(adm.volume.contracted, adm.expedientes.filter((e) => e.status !== 'cancelado').reduce((a, e) => a + e.contracted, 0));
  assert.ok(adm.editable && adm.types.length && adm.others.length);
  assert.equal((await suppliers.ficha(as('administracion'), 999999)).code, 'not_found');
});

test('alta: avisa de los parecidos, confirma con el mismo nombre y no deja repetir', { skip }, async () => {
  const { db, as } = await setup();
  const ctx = as('eventos'); // Eventos también da de alta
  const similar = await suppliers.create(ctx, { name: 'Hotel Barcelo Valladolid', status: 'activo' });
  assert.equal(similar.code, 'similar');
  assert.equal(similar.similar[0].name, 'Hotel Barceló Valladolid');
  assert.equal(db.one("SELECT COUNT(*) n FROM suppliers WHERE name = 'Hotel Barcelo Valladolid'").n, 0);
  // Confirmar un nombre distinto del que se avisó no vale: se vuelve a comprobar
  assert.equal((await suppliers.create(ctx, { name: 'Hotel Barcelo Valladolid', status: 'activo', confirm_similar: 'Otro' })).code, 'similar');
  const done = await suppliers.create(ctx, { name: '  Hotel  Barcelo Valladolid ', status: 'activo', confirm_similar: 'Hotel Barcelo Valladolid' });
  assert.ok(done.ok);
  assert.equal(done.value.name, 'Hotel Barcelo Valladolid');
  assert.equal(db.one('SELECT created_by FROM suppliers WHERE id = ?', done.value.id).created_by, ctx.user.id);
  assert.equal(db.one("SELECT COUNT(*) n FROM activity WHERE action = 'supplier.create'").n, 1);
  const taken = await suppliers.create(ctx, { name: 'hotel alfonso xiii', status: 'activo' });
  assert.equal(taken.code, 'conflict');
  assert.match(taken.fields.name, /Ya existe: Hotel Alfonso XIII/);
  assert.equal((await suppliers.create(ctx, { name: 'X', status: 'activo' })).code, 'invalid');
  assert.equal((await suppliers.create(as('tecnico'), { name: 'Nuevo', status: 'activo' })).code, 'forbidden');
});

test('alta rápida (selector de un pago): nombre, tipo y ciudad; confirm=1 para dar de alta un parecido', { skip }, async () => {
  const { as } = await setup();
  const ctx = as('eventos');
  assert.equal((await suppliers.create(ctx, { name: 'Alfonso XIII Catering' }, { quick: true })).code, 'similar');
  const r = await suppliers.create(ctx, { name: 'Alfonso XIII Catering', city: 'Sevilla', confirm: '1' }, { quick: true });
  assert.deepEqual([r.ok, r.value.city, r.value.status, r.value.aliases], [true, 'Sevilla', 'activo', []]);
});

test('editar: renombrar deja el nombre anterior y actualiza los pagos; sin gasto se conservan las condiciones', { skip }, async () => {
  const { db, as, id } = await setup();
  const hb = id('Hotel Barceló Valladolid');
  const base = { name: 'Barceló Valladolid', status: 'activo', city: 'Valladolid' };
  assert.equal((await suppliers.update(as('eventos'), hb, base)).code, 'forbidden');
  const ctx = as('administracion');
  assert.equal((await suppliers.update(ctx, hb, { ...base, name: 'Hotel Alfonso XIII' })).code, 'conflict');
  // Un rol que edita fichas pero no ve el gasto: las condiciones económicas no se pierden
  ctx.user.permissions.delete('proveedores.gasto');
  assert.ok((await suppliers.update(ctx, hb, { ...base, economic_terms: '' })).ok);
  assert.match(db.one('SELECT economic_terms FROM suppliers WHERE id = ?', hb).economic_terms, /Tarifa de grupos/);
  assert.equal(db.one("SELECT supplier_id FROM supplier_aliases WHERE alias = 'Hotel Barceló Valladolid'").supplier_id, hb);
  assert.deepEqual(db.rows('SELECT DISTINCT supplier FROM payments WHERE supplier_id = ?', hb), [{ supplier: 'Barceló Valladolid' }]);
});

test('fusionar: pagos, contratos y nombres pasan al bueno; borrar sólo sin pagos ni contratos', { skip }, async () => {
  const { db, as, id } = await setup();
  const ctx = as('jefes');
  const dup = (await suppliers.create(ctx, { name: 'Fluge AV', status: 'activo', confirm_similar: 'Fluge AV' })).value.id;
  db.raw.exec(`INSERT INTO supplier_contracts (supplier_id, title, starts_on) VALUES (${dup}, 'Acuerdo del repetido', '2026-01-01')`);
  assert.equal((await suppliers.remove(ctx, dup)).code, 'conflict'); // tiene un contrato
  const fluge = id('Fluge Audiovisuales');
  assert.equal((await suppliers.merge(ctx, dup, dup)).code, 'invalid');
  const r = await suppliers.merge(ctx, dup, fluge);
  assert.ok(r.ok);
  assert.equal(db.one("SELECT supplier_id FROM supplier_contracts WHERE title = 'Acuerdo del repetido'").supplier_id, fluge);
  assert.equal(db.one("SELECT supplier_id FROM supplier_aliases WHERE alias = 'Fluge AV'").supplier_id, fluge);
  assert.equal(db.one('SELECT COUNT(*) n FROM suppliers WHERE id = ?', dup).n, 0);
  assert.match((await suppliers.remove(ctx, fluge)).message, /Tiene pagos/);
  const free = (await suppliers.create(ctx, { name: 'Imprenta Rápida', status: 'activo' })).value.id;
  assert.ok((await suppliers.remove(ctx, free)).ok);
  assert.equal((await suppliers.remove(as('eventos'), fluge)).code, 'forbidden');
});

test('tipos: no se repiten y sólo se quita uno que no tenga ningún proveedor', { skip }, async () => {
  const { db, as } = await setup();
  const ctx = as('tesoreria');
  assert.equal((await suppliers.addType(ctx, { type_name: 'hotel' })).code, 'conflict');
  const guias = await suppliers.addType(ctx, { type_name: 'Guías' });
  assert.ok(guias.ok);
  assert.ok((await suppliers.removeType(ctx, guias.value.id)).ok);
  const hotel = db.one("SELECT id FROM supplier_types WHERE name = 'Hotel'").id;
  assert.equal((await suppliers.removeType(ctx, hotel)).code, 'conflict');
  assert.equal((await suppliers.addType(as('eventos'), { type_name: 'Otro' })).code, 'forbidden');
});

test('proveedor de un pago: de la lista (id, nombre exacto o anterior); nunca se crea; «No contratar» no', { skip }, async () => {
  const { db, as, id } = await setup();
  const ctx = as('eventos');
  const alfonso = id('Hotel Alfonso XIII');
  assert.equal((await suppliers.resolveForPayment(ctx, { id: alfonso, name: 'lo que sea' })).value.id, alfonso);
  assert.equal((await suppliers.resolveForPayment(ctx, { name: ' hotel alfonso xiii ' })).value.name, 'Hotel Alfonso XIII');
  db.raw.exec(`INSERT INTO supplier_aliases (alias, supplier_id) VALUES ('Alfonso 13', ${alfonso})`);
  assert.equal((await suppliers.resolveForPayment(ctx, { name: 'alfonso 13' })).value.id, alfonso);
  const before = db.one('SELECT COUNT(*) n FROM suppliers').n;
  const unknown = await suppliers.resolveForPayment(ctx, { name: 'barcelo valladolid' });
  assert.equal(unknown.code, 'invalid');
  assert.match(unknown.fields.supplier, /no está dado de alta\. ¿Es «Hotel Barceló Valladolid»\?/);
  assert.equal(db.one('SELECT COUNT(*) n FROM suppliers').n, before);
  db.raw.exec(`UPDATE suppliers SET status = 'bloqueado' WHERE id = ${alfonso}`);
  assert.match((await suppliers.resolveForPayment(ctx, { id: alfonso })).message, /No contratar/);
  assert.ok((await suppliers.resolveForPayment(ctx, { id: alfonso }, { keepId: alfonso })).ok);
  const rows = await suppliers.resolveRowsForPayment(ctx, [{ supplier: 'Sonido Toledo' }, { supplier: 'Inventado' }]);
  assert.match(rows.message, /^Fila 2: Proveedor: «Inventado» no está dado de alta/);
  const ok = await suppliers.resolveRowsForPayment(ctx, [{ supplier: 'Sonido Toledo' }, { supplier: 'sonido toledo' }]);
  assert.equal(ok.value.of({ supplier: 'sonido toledo' }).name, 'Sonido Toledo');
  assert.equal((await suppliers.resolveForPayment(as('tecnico'), { id: alfonso })).code, 'forbidden');
});
