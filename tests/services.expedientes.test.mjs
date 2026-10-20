// Lista de expedientes (src/services/expedientes.js) contra la base en memoria con los datos de ejemplo: pestañas,
// buscador, filtros, orden por columnas, páginas, sumas y lo que se ve sin el permiso de cobros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, EMAILS } from './helpers/context.mjs';
import * as expedientes from '../src/services/expedientes.js';
import { saleOf, EXP_TABS } from '../src/lib/expedientes.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
// Hoy: 19/10/2026 → EXP 1287 (agosto) ya se celebró; 1289 (noviembre) y 1290 (2027) están en curso
const NOW = '2026-10-19';
const setup = async () => {
  const db = await testDb({ demo: true });
  const as = (role) => contextFor(db, EMAILS[role], { now: NOW });
  return { db, as };
};
const nums = (r) => r.value.rows.map((e) => e.number);

test('pestañas: en curso, por cerrar, míos, cerrados, cancelados y todos (con cuántos hay en cada una)', { skip }, async () => {
  const { as } = await setup();
  const ctx = as('administracion');
  const curso = await expedientes.list(ctx);
  assert.ok(curso.ok);
  assert.deepEqual(nums(curso), [1289, 1290], 'en curso, por fechas');
  assert.deepEqual(curso.value.counts, { curso: 2, cerrar: 1, mios: 0, cerrados: 1, cancelados: 1, todos: 5 });
  assert.deepEqual(nums(await expedientes.list(ctx, { view: 'cerrar' })), [1287]);
  assert.deepEqual(nums(await expedientes.list(ctx, { view: 'cerrados' })), [1285]);
  assert.deepEqual(nums(await expedientes.list(ctx, { view: 'cancelados' })), [1288]);
  assert.equal((await expedientes.list(ctx, { view: 'todos' })).value.total, 5);
  // Míos: los abiertos que lleva quien mira (Marta lleva todos los de ejemplo)
  assert.deepEqual(nums(await expedientes.list(as('eventos'), { view: 'mios' })).sort(), [1287, 1289, 1290]);
  // Una pestaña que no existe (enlaces antiguos): en curso
  assert.equal((await expedientes.list(ctx, { view: 'solicitudes' })).value.view, 'curso');
  assert.deepEqual(Object.keys(EXP_TABS), ['curso', 'cerrar', 'mios', 'cerrados', 'cancelados', 'todos']);
});

test('buscador y filtros (cliente, responsable y mes), con el número de cada pestaña', { skip }, async () => {
  const { db, as } = await setup();
  const ctx = as('administracion');
  const bmw = db.one("SELECT id FROM clients WHERE name = 'BMW Ibérica'").id;
  const byClient = await expedientes.list(ctx, { view: 'todos', clientId: bmw });
  assert.deepEqual(nums(byClient).sort(), [1287, 1288]);
  assert.equal(byClient.value.counts.cancelados, 1);
  assert.deepEqual(nums(await expedientes.list(ctx, { view: 'todos', q: 'sevilla' })), [1289], 'por destino');
  assert.deepEqual(nums(await expedientes.list(ctx, { view: 'todos', q: '1285' })), [1285], 'por número');
  assert.deepEqual(nums(await expedientes.list(ctx, { view: 'todos', month: '2026-11' })), [1289]);
  assert.equal((await expedientes.list(ctx, { view: 'todos', month: 'noviembre' })).value.total, 5, 'un mes mal escrito no filtra');
  assert.equal((await expedientes.list(ctx, { view: 'todos', managerId: 1 })).value.total, 0);
  assert.equal((await expedientes.list(ctx, { view: 'todos', managerId: 2 })).value.total, 5);
  // Opciones de los filtros
  const { clients, managers } = byClient.value;
  assert.ok(clients.some((c) => c.name === 'GLENMARK') && managers.some((u) => u.name === 'Marta López'));
});

test('orden por columnas (sólo las que se pueden ver) y páginas', { skip }, async () => {
  const { as } = await setup();
  const ctx = as('administracion');
  assert.deepEqual(nums(await expedientes.list(ctx, { view: 'todos', order: 'numero', dir: 'asc' })), [1285, 1287, 1288, 1289, 1290]);
  const byBudget = await expedientes.list(ctx, { view: 'todos', order: 'presupuesto' });
  assert.equal(byBudget.value.dir, 'desc', 'su sentido natural');
  assert.deepEqual(nums(byBudget).slice(0, 2), [1290, 1289]);
  // Beneficio: sólo de los cerrados; los demás, al final
  assert.equal(nums(await expedientes.list(ctx, { view: 'todos', order: 'beneficio' }))[0], 1285);
  // Una columna que no existe: el orden por defecto
  assert.equal((await expedientes.list(ctx, { view: 'todos', order: 'drop table' })).value.order, 'fechas');
  // Eventos no ve «Por cobrar»: no puede ordenar por ella
  assert.equal((await expedientes.list(as('eventos'), { view: 'todos', order: 'por_cobrar' })).value.order, 'fechas');
  const p1 = await expedientes.list(ctx, { view: 'todos', order: 'numero', dir: 'asc', limit: 2 });
  const p2 = await expedientes.list(ctx, { view: 'todos', order: 'numero', dir: 'asc', limit: 2, offset: 2 });
  assert.deepEqual([nums(p1), nums(p2), p1.value.total], [[1285, 1287], [1288, 1289], 5]);
});

test('importes: sumas de la pestaña sin los cancelados; sin «cobros», ni lo facturado ni lo pendiente de cobro', { skip }, async () => {
  const { db, as } = await setup();
  const adm = await expedientes.list(as('administracion'), { view: 'todos' });
  const live = db.one("SELECT SUM((SELECT b.base_cents FROM budgets b WHERE b.expediente_id = e.id ORDER BY b.version DESC LIMIT 1)) AS s FROM expedientes e WHERE status <> 'cancelado'").s;
  assert.equal(adm.value.sums.budget_base, live);
  assert.ok(adm.value.cobros && adm.value.sums.to_collect > 0 && adm.value.rows.some((e) => e.to_collect > 0));
  const ev = await expedientes.list(as('eventos'), { view: 'todos' });
  assert.equal(ev.value.cobros, false);
  assert.equal(ev.value.sums.to_collect, null);
  assert.ok(ev.value.rows.every((e) => e.to_collect === null));
  // De un cerrado sí se ve su venta (como en su Cierre); de los abiertos, no lo facturado
  assert.ok(ev.value.rows.filter((e) => e.status !== 'cerrado').every((e) => e.sales_base === null));
  assert.ok(ev.value.rows.find((e) => e.number === 1285).sales_base > 0);
  // Técnico no trabaja con expedientes
  assert.equal((await expedientes.list(as('tecnico'))).code, 'forbidden');
});

test('venta y beneficio de la lista: el beneficio, sólo de los cerrados', () => {
  assert.deepEqual(saleOf({ status: 'cerrado', sales_base: 1000, budget_base: 900, cost_base: 600 }, false), { sale: 1000, margin: 400 });
  assert.deepEqual(saleOf({ status: 'abierto', sales_base: 1000, budget_base: 900, cost_base: 600 }, false), { sale: 900, margin: null });
  assert.deepEqual(saleOf({ status: 'abierto', sales_base: 1000, budget_base: 900, cost_base: 600 }, true), { sale: 1000, margin: null });
  assert.deepEqual(saleOf({ status: 'cerrado', sales_base: 0, budget_base: 900, cost_base: 950 }, true), { sale: 900, margin: -50 });
});
