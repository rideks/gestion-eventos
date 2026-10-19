import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, businessVolume } from '../src/lib/suppliers.js';
import { fold, nameSimilarity, similarNames, matchesQuery } from '../src/lib/name-match.js';
import { sectionPermission, normalizePermissions } from '../src/lib/permissions.js';

test('cleanName: sin espacios sobrantes', () => {
  assert.equal(cleanName('  Hotel   Plaza  Valladolid '), 'Hotel Plaza Valladolid');
  assert.equal(cleanName(null), '');
});

// Una fila por expediente, como las devuelve supplierFicha (importes sin IVA, en céntimos)
const rows = [
  { id: 1, status: 'abierto', company: 'BMW Ibérica', destination: 'Valladolid', start_date: '2026-08-26', lines: 4, contracted: 528419, invoiced: 528419, paid: 528419, pending: 0, credits: -23255 },
  { id: 2, status: 'cerrado', company: 'ELECNOR', destination: 'Toledo', start_date: '2025-05-06', lines: 3, contracted: 1076700, invoiced: 1076700, paid: 1076700, pending: 0, credits: 0 },
  { id: 3, status: 'abierto', company: 'BMW Ibérica', destination: 'Madrid', start_date: '2026-11-12', lines: 2, contracted: 300000, invoiced: 0, paid: 0, pending: 300000, credits: 0 },
  // Cancelado: sale en el historial pero no cuenta en ningún total
  { id: 4, status: 'cancelado', company: 'ROCHE', destination: 'Sevilla', start_date: '2026-03-01', lines: 1, contracted: 999999, invoiced: 0, paid: 0, pending: 999999, credits: 0 },
];

test('businessVolume: totales sin cancelados y cada importe en su sitio', () => {
  const v = businessVolume(rows, 2026);
  assert.equal(v.exps, 3);
  assert.equal(v.lines, 9);
  assert.equal(v.contracted, 528419 + 1076700 + 300000);
  assert.equal(v.paid + v.pending, v.contracted); // lo contratado es lo pagado más lo pendiente
  assert.equal(v.invoiced, 528419 + 1076700);
  assert.equal(v.credits, -23255); // los abonos van aparte, no restan de lo contratado
  assert.equal(v.thisYear, 528419 + 300000); // año del evento
  assert.equal(v.average, Math.round(v.contracted / 3));
  assert.equal(v.first, '2025-05-06');
  assert.equal(v.last, '2026-11-12');
});

test('businessVolume: por año (con el cambio respecto al anterior), por cliente y por ciudad', () => {
  const v = businessVolume(rows, 2026);
  assert.deepEqual(v.byYear.map((y) => [y.key, y.exps, y.contracted]), [['2026', 2, 828419], ['2025', 1, 1076700]]);
  assert.equal(v.byYear[0].change, (828419 - 1076700) / 1076700);
  assert.equal(v.byYear[1].change, null); // no hay 2024
  assert.deepEqual(v.byClient.map((c) => [c.key, c.exps]), [['ELECNOR', 1], ['BMW Ibérica', 2]]);
  assert.equal(v.byCity.length, 3);
  assert.deepEqual(businessVolume([], 2026).byYear, []);
});

test('permisos de proveedores: sección y dependencias', () => {
  assert.equal(sectionPermission('/proveedores'), 'proveedores');
  assert.equal(sectionPermission('/proveedores/12'), 'proveedores');
  // Ver el gasto o editar sin poder ver proveedores no se guarda; ver proveedores necesita expedientes
  assert.deepEqual(normalizePermissions(['expedientes', 'proveedores.gasto', 'proveedores.edit', 'proveedores.create']).permissions, ['expedientes']);
  assert.deepEqual(normalizePermissions(['expedientes', 'proveedores', 'proveedores.create']).permissions, ['expedientes', 'proveedores', 'proveedores.create']);
  assert.deepEqual(normalizePermissions(['proveedores']).permissions, []);
  assert.deepEqual(normalizePermissions(['expedientes', 'proveedores', 'proveedores.gasto']).permissions, ['expedientes', 'proveedores', 'proveedores.gasto']);
});

test('nombres parecidos: el mismo escrito de otra forma, erratas y nombres incompletos', () => {
  assert.equal(fold('  Hotel  Barceló, S.L. '), 'hotel barcelo s l');
  // 3: acentos, mayúsculas, «Hotel», «S.L.», orden de las palabras o espacios
  assert.equal(nameSimilarity('Barceló Valladolid', 'Hotel Barcelo Valladolid S.L.'), 3);
  assert.equal(nameSimilarity('Catering Pérez', 'Pérez Catering SL'), 3);
  assert.equal(nameSimilarity('Gran Via', 'Granvia'), 3);
  // 2: una errata
  assert.equal(nameSimilarity('Barceló Valladolid', 'Barcelo Valadolid'), 2);
  // 1: le falta o le sobra una palabra
  assert.equal(nameSimilarity('Barceló', 'Hotel Barceló Valladolid'), 1);
  assert.equal(nameSimilarity('Iberia', 'Iberia Express'), 1);
  // 0: distintos (otro hotel de la misma cadena, otra empresa del mismo sector)
  assert.equal(nameSimilarity('Barceló Málaga', 'Barceló Valladolid'), 0);
  assert.equal(nameSimilarity('Autocares Pérez', 'Autocares García'), 0);
  assert.equal(nameSimilarity('Hotel', 'Hotel Plaza'), 0);
});

test('similarNames: también por los nombres anteriores, los más parecidos primero', () => {
  const list = [
    { id: 1, name: 'Hotel Barceló Valladolid', aliases: [] },
    { id: 2, name: 'Barceló Málaga', aliases: [] },
    { id: 3, name: 'Autocares Pérez', aliases: ['Autocares Perez Hnos'] },
    { id: 4, name: 'Barcelo Valladolid Centro', aliases: [] },
  ];
  assert.deepEqual(similarNames('barcelo valladolid', list).map((x) => [x.id, x.score]), [[1, 3], [4, 1]]);
  const viaAlias = similarNames('autocares pérez hnos.', list);
  assert.deepEqual(viaAlias.map((x) => [x.id, x.via]), [[3, 'Autocares Perez Hnos']]);
  assert.deepEqual(similarNames('Restaurante El Paseo', list), []);
});

test('matchesQuery: busca sin acentos en nombre, nombres anteriores, tipo y ciudad', () => {
  const o = { name: 'Hotel Barceló Valladolid', aliases: ['Barceló VLL'], type: 'Hotel', city: 'Valladolid' };
  assert.equal(matchesQuery(o, 'barcelo'), true);
  assert.equal(matchesQuery(o, 'hotel valla'), true);
  assert.equal(matchesQuery(o, 'vll'), true);
  assert.equal(matchesQuery(o, 'madrid'), false);
  assert.equal(matchesQuery(o, ''), true);
});
