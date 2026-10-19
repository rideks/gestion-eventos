import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableState, pageInfo, hrefWith, sortHref, cleanColumns, sortRows, orderBy, shows, isFiltered } from '../src/lib/table.js';
import { TABLES } from '../src/lib/tables.js';

const def = TABLES.clientes;
const P = (s) => new URLSearchParams(s);
const all = () => true;
const noEconomy = (p) => p !== 'clientes.economia' && p !== 'cobros';

test('columnas: las de por defecto, las elegidas y nunca las que piden un permiso que no tiene', () => {
  const s = tableState(def, P(''), { can: all });
  assert.deepEqual(s.visible, ['name', 'ciudad', 'expedientes', 'proximo', 'uso', 'fee', 'volumen', 'facturado', 'pendiente']);
  const e = tableState(def, P(''), { can: noEconomy });
  assert.deepEqual(e.visible, ['name', 'ciudad', 'expedientes', 'proximo', 'uso']);
  assert.ok(!e.columns.some((c) => c.key === 'nif' || c.key === 'fee'));
  // Lo guardado: sólo lo que sigue permitido, y la fija siempre
  const saved = tableState(def, P(''), { prefs: { columns: ['email', 'fee', 'inventada'] }, can: noEconomy });
  assert.deepEqual(saved.visible, ['name', 'email']);
  assert.ok(shows(saved, 'email') && !shows(saved, 'ciudad'));
});

test('orden: una columna que se pueda ordenar (aunque esté oculta), con su sentido natural o el pedido', () => {
  assert.deepEqual([tableState(def, P('')).sort, tableState(def, P('')).dir], ['name', 'asc']);
  assert.deepEqual([tableState(def, P('orden=volumen')).sort, tableState(def, P('orden=volumen')).dir], ['volumen', 'desc']);
  assert.equal(tableState(def, P('orden=volumen&dir=asc')).dir, 'asc');
  assert.equal(tableState(def, P('orden=telefono')).sort, 'name'); // no se ordena por teléfono
  assert.equal(tableState(def, P('orden=volumen'), { can: noEconomy }).sort, 'name'); // sin permiso, no
  const altas = tableState(def, P('orden=altas'));
  assert.equal(altas.sort, 'altas'); // oculta, pero se puede ordenar: se ve mientras se ordena por ella
  assert.ok(shows(altas, 'altas') && !altas.chosen.includes('altas'));
  assert.equal(tableState(def, P('dir=lado')).dir, 'asc');
});

test('filtros, buscador y página', () => {
  const s = tableState(def, P('q=  bmw &estado=activo&ciudad=Madrid&inventado=1&pagina=3&por=50'));
  assert.deepEqual([s.q, s.filters, s.page, s.per, s.offset, s.limit], ['bmw', { estado: 'activo', ciudad: 'Madrid' }, 3, 50, 100, 50]);
  assert.ok(isFiltered(s));
  assert.equal(isFiltered(tableState(def, P(''))), false);
  assert.equal(tableState(def, P('por=7')).per, 25);
  assert.equal(tableState(def, P(''), { prefs: { per: 100 } }).per, 100);
  assert.equal(tableState(def, P('por=25'), { prefs: { per: 100 } }).per, 25);
  assert.equal(tableState(def, P('pagina=-4')).page, 1);
  assert.equal(tableState(def, P('pagina=abc')).page, 1);
});

test('páginas: «26–50 de 143» y los números con huecos', () => {
  const i = pageInfo(143, { page: 2, per: 25 });
  assert.deepEqual([i.from, i.to, i.last, i.prev, i.next], [26, 50, 6, 1, 3]);
  assert.deepEqual(i.items, [1, 2, 3, 4, '…', 6]);
  assert.deepEqual(pageInfo(1000, { page: 20, per: 25 }).items, [1, '…', 18, 19, 20, 21, 22, '…', 40]);
  assert.deepEqual(pageInfo(0, { page: 1, per: 25 }), { total: 0, page: 1, last: 1, items: [1], from: 0, to: 0, prev: null, next: null });
  assert.equal(pageInfo(30, { page: 9, per: 25 }).page, 2); // una página que ya no existe → la última
});

test('enlaces: conservan los filtros, vuelven a la página 1 y no arrastran los avisos', () => {
  const url = new URL('http://x/clientes?q=bmw&estado=activo&pagina=3&ok=guardado');
  assert.equal(hrefWith(url, { pagina: 4 }), '/clientes?q=bmw&estado=activo&pagina=4');
  assert.equal(hrefWith(url, { estado: null }), '/clientes?q=bmw');
  assert.equal(hrefWith(url, { pagina: 1 }), '/clientes?q=bmw&estado=activo');
  const s = tableState(def, url.searchParams);
  const name = def.columns[0];
  const vol = def.columns.find((c) => c.key === 'volumen');
  assert.equal(sortHref(url, s, name), '/clientes?q=bmw&estado=activo&orden=name&dir=desc'); // la misma: al revés
  assert.equal(sortHref(url, s, vol), '/clientes?q=bmw&estado=activo&orden=volumen&dir=desc'); // otra: su sentido natural
});

test('guardar columnas: sólo las que existen y puede ver, sin las fijas', () => {
  assert.deepEqual(cleanColumns(def, ['name', 'email', 'fee', 'x'], all), ['email', 'fee']);
  assert.deepEqual(cleanColumns(def, ['email', 'fee', 'pendiente'], noEconomy), ['email']);
});

test('ordenar en memoria (vacíos al final) y ORDER BY seguro', () => {
  const rows = [{ n: 'b', v: 2 }, { n: 'á', v: null }, { n: 'c', v: 10 }];
  assert.deepEqual(sortRows(rows, { n: (r) => r.n, v: (r) => r.v }, 'v', 'desc').map((r) => r.n), ['c', 'b', 'á']);
  assert.deepEqual(sortRows(rows, { n: (r) => r.n }, 'n', 'asc').map((r) => r.n), ['á', 'b', 'c']);
  assert.equal(orderBy({ a: 'x.a' }, 'a', 'desc', 'a', 'x.id'), '(x.a) IS NULL, x.a DESC, x.id DESC');
  assert.equal(orderBy({ a: 'x.a' }, "a; DROP TABLE x", 'asc', 'a', 'x.id'), '(x.a) IS NULL, x.a ASC, x.id ASC');
});

test('las cuatro tablas: claves únicas, una columna fija y el orden por defecto existe', () => {
  for (const t of Object.values(TABLES)) {
    const keys = t.columns.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length, t.key);
    assert.ok(t.columns.some((c) => c.fixed), t.key);
    assert.ok(t.columns.find((c) => c.key === t.sort)?.sort, t.key);
  }
});

test('vista: tarjetas o tabla sólo en las tablas que la tienen (la elegida o la de por defecto)', () => {
  const bt = TABLES.viajes;
  assert.equal(tableState(bt, P('')).view, 'tarjetas');
  assert.equal(tableState(bt, P(''), { prefs: { view: 'tabla' } }).view, 'tabla');
  assert.equal(tableState(bt, P(''), { prefs: { view: 'otra' } }).view, 'tarjetas');
  assert.equal(tableState(def, P(''), { prefs: { view: 'tarjetas' } }).view, 'tabla'); // Clientes no tiene tarjetas
});
