#!/usr/bin/env node
// Crea una invitación y muestra el enlace de alta. Por defecto con el rol TÉCNICO: la primera cuenta
// es la de quien gestiona usuarios y permisos, y desde la aplicación invita a los demás.
// Así ninguna contraseña pasa por la terminal.
//
//   npm run invite -- --local                                (desarrollo)
//   npm run invite -- --url https://gestion.tudominio.com    (producción)
//   npm run invite -- --role eventos --days 3 --url https://…
//
// Roles iniciales: jefes, administracion, tesoreria, eventos, tecnico (o la clave de uno creado después).
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const local = args.includes('--local');
const role = opt('role', 'tecnico');
const days = Number(opt('days', '7'));
const url = (opt('url') ?? (local ? 'http://localhost:4321' : '')).replace(/\/$/, '');

// La clave va dentro del SQL: sólo letras, números y guiones bajos
if (!/^[a-z0-9_]{2,40}$/.test(role)) throw new Error('--role: clave del rol (jefes, administracion, tesoreria, eventos, tecnico…)');
if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('--days entre 1 y 30');

const token = `inv_${randomBytes(24).toString('base64url')}`;
const hash = createHash('sha256').update(token).digest('hex');
const now = Math.floor(Date.now() / 1000);
// Si la clave no existe no se inserta nada (el SELECT no devuelve filas) y se avisa abajo
const sql = `INSERT INTO invites (token_hash, role_id, note, created_at, expires_at)
  SELECT '${hash}', id, 'Creada desde la terminal', ${now}, ${now + days * 86400} FROM roles WHERE key = '${role}';
  SELECT changes() AS creadas;`;

const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', local ? '--local' : '--remote', '--json', '--command', sql], { encoding: 'utf8' });
const created = JSON.parse(out.slice(out.indexOf('['))).at(-1)?.results?.[0]?.creadas;
if (!created) {
  console.error(`\n✘ No existe el rol «${role}». Roles iniciales: jefes, administracion, tesoreria, eventos, tecnico.\n`);
  process.exit(1);
}

console.log(`\n✅ Invitación (${role}) creada; el enlace caduca en ${days} días. Ábrelo para crear la cuenta:\n`);
console.log(`   ${url || 'https://TU-DOMINIO'}/registro#token=${token}\n`);
