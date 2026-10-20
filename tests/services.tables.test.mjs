// Tablas de listado contra una base SQLite en memoria con los datos de ejemplo: páginas, totales de todo lo
// filtrado (no sólo de la página), orden por columna según los permisos, filtros y las columnas de cada persona.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, EMAILS } from './helpers/context.mjs';
import * as clients from '../src/services/clients.js';
import * as suppliers from '../src/services/suppliers.js';
import * as contracts from '../src/services/contracts.js';
import * as travel from '../src/services/travel.js';
import * as prefs from '../src/services/prefs.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const setup = async () => {
  const db = await testDb({ demo: true });
  const as = (role) => contextFor(db, EMAILS[role], { now: '2026-10-19' });
  return { db, as };
};

test('clientes: páginas con el total y los importes de todos, no sólo de la página', { skip }, async () => {
  const { as } = await setup();
  const ctx = as('administracion');
  const all = (await clients.directory(ctx, { order: 'volumen', limit: 100 })).value;
  const p1 = (await clients.directory(ctx, { order: 'volumen', limit: 2, offset: 0 })).value;
  const p2 = (await clients.directory(ctx, { order: 'volumen', limit: 2, offset: 2 })).value;
  assert.equal(all.total, 4);
  assert.deepEqual([p1.rows.length, p2.rows.length, p1.total, p2.total], [2, 2, 4, 4]);
  assert.deepEqual([...p1.rows, ...p2.rows].map((r) => r.id), all.rows.map((r) => r.id)); // sin repetir ni saltar
  assert.equal(p1.sums.budget, all.rows.reduce((a, r) => a + r.budget, 0));
  assert.ok(p1.rows[0].budget >= p1.rows[1].budget && p1.rows[1].budget >= p2.rows[0].budget);
  const asc = (await clients.directory(ctx, { order: 'volumen', dir: 'asc', limit: 100 })).value.rows.map((r) => r.id);
  assert.deepEqual(asc, [...all.rows.map((r) => r.id)].reverse());
});

test('clientes: filtros por ciudad y tipo; Eventos no ordena por importes ni le llegan NIF ni sumas', { skip }, async () => {
  const { as } = await setup();
  const adm = as('administracion');
  assert.deepEqual((await clients.directory(adm, { city: 'madrid', limit: 100 })).value.rows.map((r) => r.name).sort(), ['BMW Ibérica', 'ELECNOR', 'ROCHE FARMA']);
  assert.equal((await clients.directory(adm, { kind: 'persona' })).value.total, 0);
  assert.deepEqual((await clients.directory(adm, {})).value.cities, ['Barcelona', 'Madrid']);
  const ev = (await clients.directory(as('eventos'), { order: 'volumen' })).value;
  assert.equal(ev.order, 'name');
  assert.ok(ev.rows.every((r) => !('tax_id' in r) && !('budget' in r)));
  assert.ok(!('budget' in ev.sums) && !('pending' in ev.sums));
  assert.equal((await clients.directory(as('eventos'), { order: 'viajes' })).value.order, 'viajes');
});

test('proveedores: páginas, filtro de ciudad y sumas sólo con permiso de gasto', { skip }, async () => {
  const { as } = await setup();
  const adm = as('administracion');
  const all = (await suppliers.directory(adm, { order: 'gasto', limit: 100 })).value;
  const p = (await suppliers.directory(adm, { order: 'gasto', limit: 5, offset: 5 })).value;
  assert.equal(all.total, 23);
  assert.deepEqual(p.rows.map((r) => r.id), all.rows.slice(5, 10).map((r) => r.id));
  assert.equal(p.sums.contracted, all.rows.reduce((a, r) => a + r.contracted, 0));
  assert.ok((await suppliers.directory(adm, { city: 'Sevilla', limit: 100 })).value.rows.every((r) => r.city === 'Sevilla'));
  const ev = (await suppliers.directory(as('eventos'), { order: 'gasto' })).value;
  assert.deepEqual([ev.order, ev.sums], ['name', null]);
});

test('contratos: pestañas con sus recuentos, filtro de tipo, orden y páginas', { skip }, async () => {
  const { as } = await setup();
  const ctx = as('administracion');
  const t = (await contracts.table(ctx, {})).value;
  assert.equal(t.view, 'atencion'); // por defecto, lo que requiere atención (si hay)
  assert.deepEqual([t.counts.atencion, t.counts.todos, t.all], [3, 8, 8]);
  assert.deepEqual(t.due, { caducado: 1, por_caducar: 1, pendiente: 1 });
  assert.equal(t.rows[0].state.key, 'caducado'); // por urgencia
  const hotels = (await contracts.table(ctx, { view: 'todos', type: 'Hotel' })).value;
  assert.ok(hotels.total > 0 && hotels.rows.every((c) => c.supplier_type === 'Hotel'));
  const byEnd = (await contracts.table(ctx, { view: 'todos', sort: 'fin', dir: 'asc' })).value.rows.map((c) => c.ends_on);
  assert.equal(byEnd.at(-1), null); // los indefinidos, al final
  assert.deepEqual(byEnd.filter(Boolean), [...byEnd.filter(Boolean)].sort());
  const page = (await contracts.table(ctx, { view: 'todos', limit: 3, offset: 6 })).value;
  assert.deepEqual([page.rows.length, page.total], [2, 8]);
  assert.equal((await contracts.table(as('eventos'), {})).code, 'forbidden');
});

test('Business Travel: páginas, filtro de cliente y totales sin las canceladas; sin fee para Eventos', { skip }, async () => {
  const { db, as } = await setup();
  const adm = as('administracion');
  const all = (await travel.list(adm, { limit: 100 })).value;
  assert.equal(all.total, 7);
  assert.deepEqual(all.rows.map((r) => r.reference), ['BT-2026-0007', 'BT-2026-0006', 'BT-2026-0005', 'BT-2026-0004', 'BT-2026-0003', 'BT-2026-0002', 'BT-2026-0001']);
  assert.equal(all.sums.pvp_cents, 274050 + 45240 + 146400 + 47600 + 4300 + 52400); // sin la cancelada (11300)
  const roche = (await travel.list(adm, { clientId: db.one("SELECT id FROM clients WHERE name = 'ROCHE FARMA'").id, order: 'pvp', limit: 2 })).value;
  assert.deepEqual([roche.total, roche.rows.length, roche.rows[0].reference], [3, 2, 'BT-2026-0001']);
  assert.deepEqual(all.clients.map((c) => c.name), ['BMW Ibérica', 'ELECNOR', 'GLENMARK', 'ROCHE FARMA']);
  const ev = (await travel.list(as('eventos'), { order: 'fee' })).value;
  assert.equal(ev.order, 'reserva');
  assert.ok(!('fee_cents' in ev.sums) && ev.rows.every((r) => !('fee_cents' in r)));
});

test('columnas de cada persona: se guardan (sólo las que puede ver) y se vuelve a las de siempre', { skip }, async () => {
  const { db, as } = await setup();
  const ev = as('eventos');
  assert.equal(await prefs.forTable(ev, 'clientes'), null);
  const r = await prefs.saveTable(ev, 'clientes', { columns: ['email', 'fee', 'pendiente', 'telefono', 'name'], per: '50' });
  assert.deepEqual(r.value, { columns: ['email', 'telefono'], per: 50 });
  assert.deepEqual(await prefs.forTable(ev, 'clientes'), { columns: ['email', 'telefono'], per: 50 });
  assert.equal(await prefs.forTable(as('administracion'), 'clientes'), null); // es de cada persona
  assert.equal((await prefs.saveTable(ev, 'clientes', { per: '7' })).value.per, null);
  assert.ok((await prefs.saveTable(ev, 'clientes', { reset: true })).ok);
  assert.equal(await prefs.forTable(ev, 'clientes'), null);
  assert.equal((await prefs.saveTable(ev, 'inventada', { columns: [] })).code, 'invalid');
  // La vista (tarjetas o tabla), sólo en las tablas que la tienen; se conserva al cambiar las columnas o volver a las de siempre
  assert.equal((await prefs.saveTable(ev, 'contratos', { view: 'tabla' })).code, 'invalid');
  assert.equal((await prefs.saveTable(ev, 'viajes', { view: 'otra' })).code, 'invalid');
  assert.deepEqual((await prefs.saveTable(ev, 'viajes', { view: 'tabla' })).value, { view: 'tabla' });
  assert.deepEqual((await prefs.saveTable(ev, 'viajes', { columns: ['estado', 'fee'], per: '50' })).value, { columns: ['estado'], per: 50, view: 'tabla' });
  assert.ok((await prefs.saveTable(ev, 'viajes', { reset: true })).ok);
  assert.deepEqual(await prefs.forTable(ev, 'viajes'), { view: 'tabla' });
  db.raw.exec('DELETE FROM user_prefs');
  assert.equal(db.one('SELECT COUNT(*) n FROM user_prefs').n, 0);
});
