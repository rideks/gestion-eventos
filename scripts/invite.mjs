#!/usr/bin/env node
// Crea una invitación (por defecto de ADMINISTRACIÓN) y muestra el enlace de alta.
// Así la primera cuenta se crea sin que ninguna contraseña pase por la terminal.
//
//   npm run invite -- --local                                (desarrollo)
//   npm run invite -- --url https://gestion.tudominio.com    (producción)
//   npm run invite -- --role eventos --days 3 --url https://…
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const local = args.includes('--local');
const role = opt('role', 'admin');
const days = Number(opt('days', '7'));
const url = (opt('url') ?? (local ? 'http://localhost:4321' : '')).replace(/\/$/, '');

if (!['admin', 'eventos'].includes(role)) throw new Error('--role debe ser admin o eventos');
if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('--days entre 1 y 30');

const token = `inv_${randomBytes(24).toString('base64url')}`;
const hash = createHash('sha256').update(token).digest('hex');
const now = Math.floor(Date.now() / 1000);
const sql = `INSERT INTO invites (token_hash, role, note, created_at, expires_at) VALUES ('${hash}', '${role}', 'Creada desde la terminal', ${now}, ${now + days * 86400});`;

execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', local ? '--local' : '--remote', '--command', sql], { stdio: 'inherit' });

console.log(`\n✅ Invitación (${role}) creada; el enlace caduca en ${days} días. Ábrelo para crear la cuenta:\n`);
console.log(`   ${url || 'https://TU-DOMINIO'}/registro#token=${token}\n`);
