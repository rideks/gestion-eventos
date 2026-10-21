// Roles y permisos (Usuarios y permisos) contra una base SQLite en memoria con los datos de ejemplo: guardar sólo
// lo que se ha cambiado, sin quitar nada a escondidas, que quede quien gestione usuarios y quién puede hacerlo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, EMAILS } from './helpers/context.mjs';
import * as roles from '../src/services/roles.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const setup = async () => {
  const db = await testDb({ demo: true });
  const tecnico = contextFor(db, EMAILS.tecnico);
  const id = (key) => db.one('SELECT id FROM roles WHERE key = ?', key).id;
  const perms = (roleId) => db.rows('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission', roleId).map((r) => r.permission);
  return { db, tecnico, id, perms };
};
const TESORERIA = { name: 'Tesorería', description: 'Cobros, pagos y seguimiento financiero' };

test('guardar: sólo cambia lo marcado y lo desmarcado; lo demás se queda como estaba', { skip }, async () => {
  const { db, tecnico, id, perms } = await setup();
  const t = id('tesoreria');
  const before = perms(t);
  const wanted = [...before.filter((p) => p !== 'contratos.edit'), 'viajes.close'];
  const r = await roles.save(tecnico, t, TESORERIA, { wanted, original: before });
  assert.ok(r.ok, r.message);
  assert.deepEqual(r.value, { changed: true, added: ['viajes.close'], removed: ['contratos.edit'] });
  assert.deepEqual(perms(t), [...before.filter((p) => p !== 'contratos.edit'), 'viajes.close'].sort());
  assert.match(db.one("SELECT text FROM activity WHERE action = 'role.update' ORDER BY id DESC").text,
    /le dio «Cerrar y reabrir reservas de Business Travel»; le quitó «Crear, renovar y modificar contratos»/);
  // Sin cambios: no se escribe nada
  const n = db.one('SELECT COUNT(*) n FROM activity').n;
  assert.deepEqual((await roles.save(tecnico, t, TESORERIA, { wanted: perms(t), original: perms(t) })).value, { changed: false, added: [], removed: [] });
  assert.equal(db.one('SELECT COUNT(*) n FROM activity').n, n);
});

test('dos personas con el mismo rol abierto: cada una sólo cambia lo suyo', { skip }, async () => {
  const { tecnico, id, perms } = await setup();
  const t = id('tesoreria');
  const opened = perms(t);
  // La primera quita «Ver los contratos» (y lo que depende de él)
  assert.ok((await roles.save(tecnico, t, TESORERIA, { wanted: opened.filter((p) => !p.startsWith('contratos')), original: opened })).ok);
  // La segunda, con la pantalla de antes, sólo añade «Cerrar y reabrir reservas»: no vuelve a poner los contratos
  assert.ok((await roles.save(tecnico, t, TESORERIA, { wanted: [...opened, 'viajes.close'], original: opened })).ok);
  const now = perms(t);
  assert.ok(now.includes('viajes.close'));
  assert.ok(!now.includes('contratos') && !now.includes('contratos.edit'));
  assert.equal(now.length, opened.length - 2 + 1);
});

test('nada se quita a escondidas: si uno se queda sin su base, no se guarda y se explica', { skip }, async () => {
  const { tecnico, id, perms } = await setup();
  const t = id('tesoreria');
  const before = perms(t);
  const r = await roles.save(tecnico, t, TESORERIA, { wanted: before.filter((p) => p !== 'cobros'), original: before });
  assert.equal(r.code, 'invalid');
  assert.match(r.message, /«Emitir, cobrar y anular facturas al cliente» necesita «Ver los cobros»/);
  assert.deepEqual(perms(t), before, 'no ha cambiado nada');
  // Quitando también los que dependen, sí
  const without = before.filter((p) => !['cobros', 'invoice.issue', 'po.manage', 'viajes.albaran'].includes(p));
  const ok = await roles.save(tecnico, t, TESORERIA, { wanted: without, original: before });
  assert.ok(ok.ok, ok.message);
  assert.deepEqual(perms(t), without);
});

test('sin original (formulario antiguo), lo enviado sustituye a lo guardado', { skip }, async () => {
  const { tecnico, id, perms } = await setup();
  const e = id('eventos');
  assert.ok((await roles.save(tecnico, e, { name: 'Eventos' }, { wanted: ['expedientes', 'pagos'] })).ok);
  assert.deepEqual(perms(e), ['expedientes', 'pagos']);
});

test('siempre queda quien gestione usuarios; nombre único; sólo con «users»', { skip }, async () => {
  const { db, tecnico, id, perms } = await setup();
  const tec = id('tecnico');
  const last = await roles.save(tecnico, tec, { name: 'Técnico' }, { wanted: [], original: perms(tec) });
  assert.equal(last.code, 'conflict');
  assert.match(last.message, /al menos una persona activa/);
  assert.deepEqual(perms(tec), ['users']);
  const dup = await roles.save(tecnico, id('eventos'), { name: 'tesorería' }, { wanted: perms(id('eventos')), original: perms(id('eventos')) });
  assert.equal(dup.fields.name, 'Ya hay otro rol con ese nombre.');
  const admin = contextFor(db, EMAILS.administracion);
  assert.equal((await roles.save(admin, id('eventos'), { name: 'Eventos' }, { wanted: [] })).code, 'forbidden');
  assert.equal((await roles.detail(admin, id('eventos'))).code, 'forbidden');
  assert.equal((await roles.detail(tecnico, 999)).code, 'not_found');
});

test('borrar: sólo un rol creado a mano y sin nadie', { skip }, async () => {
  const { db, tecnico, id } = await setup();
  assert.match((await roles.remove(tecnico, id('eventos'))).message, /iniciales no se pueden borrar/);
  db.prepare("INSERT INTO roles (key, name, system) VALUES ('ventas', 'Ventas', 0)").run();
  const v = id('ventas');
  assert.ok((await roles.remove(tecnico, v)).ok);
  assert.equal(db.one('SELECT COUNT(*) n FROM roles WHERE id = ?', v).n, 0);
});
