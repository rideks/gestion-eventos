// Número de expediente: se da al crearlo, del contador, en la misma transacción que el alta (src/repos/expedientes.js),
// y la migración 0015 abre con número las solicitudes que quedaban. Contra una base SQLite en memoria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { nextNumberStmt, NUMBER, upcomingNumber } from '../src/repos/expedientes.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const MIGRATION = readFileSync(new URL('../migrations/0015_expedientes_en_curso.sql', import.meta.url), 'utf8');

/** Alta como en src/pages/expedientes/nuevo.astro: el número y el expediente en el mismo batch */
async function create(db, name, at = '2026-10-20T10:00:00Z') {
  const [, r] = await db.batch([
    nextNumberStmt(db),
    db.prepare(`INSERT INTO expedientes (number, name, company, start_date, status, requested_at) VALUES (${NUMBER}, ?, 'ACME', '2027-01-10', 'abierto', ?) RETURNING id, number`)
      .bind(name, at),
  ]);
  return r.results[0];
}

test('cada alta recibe el siguiente número, desde el mayor que ya exista', { skip }, async () => {
  const db = await testDb({ demo: true }); // la demo llega hasta el EXP 1290
  assert.equal(await upcomingNumber(db), 1291);
  assert.equal((await create(db, 'Uno')).number, 1291);
  assert.equal((await create(db, 'Dos')).number, 1292);
  assert.equal(await upcomingNumber(db), 1293);
});

test('si Administración pone a mano un número mayor, se sigue desde él; el «primer número» de Ajustes es el mínimo', { skip }, async () => {
  const db = await testDb();
  assert.equal((await create(db, 'Primero')).number, 1001); // sin expedientes: el primer número de Ajustes
  db.raw.exec("UPDATE expedientes SET number = 2000 WHERE name = 'Primero'"); // cambiado en «Editar»
  assert.equal((await create(db, 'Segundo')).number, 2001);
  db.raw.exec("UPDATE settings SET value = '3000' WHERE key = 'first_number'");
  assert.equal(await upcomingNumber(db), 3000);
  assert.equal((await create(db, 'Tercero')).number, 3000);
});

test('un número dado no se vuelve a dar aunque se borre el expediente; dos altas seguidas nunca repiten', { skip }, async () => {
  const db = await testDb();
  const a = await create(db, 'A');
  db.raw.exec(`DELETE FROM expedientes WHERE id = ${a.id}`);
  const numbers = [];
  for (const n of ['B', 'C', 'D']) numbers.push((await create(db, n)).number);
  assert.deepEqual(numbers, [a.number + 1, a.number + 2, a.number + 3]);
  assert.equal(new Set(db.rows('SELECT number FROM expedientes').map((r) => r.number)).size, 3);
});

test('migración 0015: las solicitudes sin abrir se abren con número correlativo por orden de petición', { skip }, async () => {
  const db = await testDb();
  db.raw.exec("INSERT INTO users (id, name, email, password_hash, role_id) VALUES (1, 'Marta', 'm@example.com', 'x', (SELECT id FROM roles WHERE key = 'eventos'))");
  db.raw.exec(`INSERT INTO expedientes (number, name, company, start_date, status, requested_by, requested_at) VALUES
    (1500, 'Abierto', 'ACME', '2027-01-10', 'abierto', NULL, '2026-09-01T10:00:00Z'),
    (NULL, 'Segunda', 'ACME', '2027-02-10', 'solicitado', 1, '2026-10-02T10:00:00Z'),
    (NULL, 'Primera', 'ACME', '2027-03-10', 'solicitado', 1, '2026-10-01T10:00:00Z'),
    (NULL, 'Cancelada', 'ACME', '2027-04-10', 'cancelado', 1, '2026-09-15T10:00:00Z')`);
  db.raw.exec(MIGRATION);
  const by = (name) => db.one('SELECT number, status, opened_at, opened_by FROM expedientes WHERE name = ?', name);
  assert.deepEqual([by('Primera').number, by('Segunda').number], [1501, 1502]);
  assert.deepEqual([by('Primera').status, by('Primera').opened_at, by('Primera').opened_by], ['abierto', '2026-10-01T10:00:00Z', 1]);
  assert.deepEqual([by('Cancelada').number, by('Cancelada').status], [null, 'cancelado']); // las canceladas no se tocan
  assert.equal(db.one("SELECT COUNT(*) AS n FROM expedientes WHERE status = 'solicitado'").n, 0);
  assert.match(db.one(`SELECT text FROM activity WHERE expediente_id = (SELECT id FROM expedientes WHERE name = 'Segunda')`).text, /número 1502/);
  assert.equal((await create(db, 'Nueva')).number, 1503); // el contador sigue desde el último
  db.raw.exec(MIGRATION); // volver a aplicarla no cambia nada
  assert.equal(by('Primera').number, 1501);
  assert.equal((await create(db, 'Otra')).number, 1504);
});
