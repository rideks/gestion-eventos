// Autenticación: contraseñas, sesiones e invitaciones (mismo esquema que el panel de club-futsal).
//
//  · El hash guarda algoritmo e iteraciones → se puede endurecer en el futuro sin romper cuentas.
//  · Las sesiones caducan por inactividad (7 días) Y de forma absoluta (30 días).
//  · Cambiar la contraseña cierra el resto de sesiones.

import { randomBytes, randomToken, sha256Hex, toBase64Url, fromBase64Url, timingSafeEqual } from './crypto.js';

// ── Contraseñas (PBKDF2-SHA256) ────────────────────────────────────────────
// 100 000 es el máximo de iteraciones que permite PBKDF2 en Cloudflare Workers.
const PBKDF2_ITERATIONS = 100_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Devuelve 'pbkdf2_sha256$<iteraciones>$<sal>$<hash>' */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [algo, iterStr, saltStr, hashStr] = String(stored || '').split('$');
  const iterations = Number(iterStr);
  const salt = fromBase64Url(saltStr || '');
  if (algo !== 'pbkdf2_sha256' || !Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS || !salt) {
    return false;
  }
  const candidate = toBase64Url(await pbkdf2(password, salt, iterations));
  return timingSafeEqual(candidate, hashStr || '');
}

/**
 * Hash señuelo: cuando el email no existe verificamos igualmente contra esto
 * para que la respuesta tarde lo mismo (no se puede adivinar qué emails existen).
 */
export const DUMMY_HASH = `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${'A'.repeat(22)}$${'A'.repeat(43)}`;

// ── Sesiones ───────────────────────────────────────────────────────────────
export const SESSION_COOKIE = '__Host-sid';
const IDLE_TTL = 7 * 24 * 3600;      // sin usar la aplicación 7 días → caduca
const ABSOLUTE_TTL = 30 * 24 * 3600; // como mucho 30 días aunque se use a diario
const TOUCH_EVERY = 3600;            // sólo escribimos en D1 una vez por hora y sesión

const now = () => Math.floor(Date.now() / 1000);

export function sessionCookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    secure: true,
    // 'lax': al abrir un enlace a un expediente desde el correo se mantiene la sesión.
    // Los POST desde otros sitios se bloquean igualmente (middleware + Astro checkOrigin).
    sameSite: 'lax',
    maxAge: IDLE_TTL,
  };
}

/** Crea la sesión y devuelve el token EN CLARO (sólo va a la cookie). */
export async function createSession(db, userId, { ip = null, userAgent = null } = {}) {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const t = now();
  await db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, userId, t, t, t + ABSOLUTE_TTL, ip, userAgent ? userAgent.slice(0, 200) : null).run();
  return token;
}

/**
 * Valida el token de la cookie.
 * @returns {Promise<null | { user: object, sessionId: string, touched: boolean }>}
 */
export async function getSession(db, token) {
  if (!token || token.length < 40 || token.length > 64) return null;
  const id = await sha256Hex(token);
  const t = now();
  const row = await db.prepare(
    `SELECT s.last_seen_at, u.id, u.name, u.email, u.role_id, r.name AS role_name,
            (SELECT GROUP_CONCAT(rp.permission) FROM role_permissions rp WHERE rp.role_id = u.role_id) AS perms
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN roles r ON r.id = u.role_id
      WHERE s.id = ? AND s.expires_at > ? AND s.last_seen_at > ? AND u.active = 1`,
  ).bind(id, t, t - IDLE_TTL).first();
  if (!row) return null;

  let touched = false;
  if (t - row.last_seen_at > TOUCH_EVERY) {
    await db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(t, id).run();
    touched = true;
  }
  const { last_seen_at, perms, ...user } = row;
  // Los permisos del rol se leen en cada petición: un cambio de rol o de permisos vale al momento
  user.permissions = new Set(perms ? perms.split(',') : []);
  return { user, sessionId: id, touched };
}

export async function deleteSession(db, token) {
  if (!token) return;
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
}

/** Cierra todas las sesiones de un usuario salvo (opcionalmente) la actual. */
export async function deleteUserSessions(db, userId, exceptSessionId = null) {
  if (exceptSessionId) {
    await db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(userId, exceptSessionId).run();
  } else {
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  }
}

// ── Invitaciones ───────────────────────────────────────────────────────────
export function generateInviteToken() {
  return `inv_${toBase64Url(randomBytes(24))}`;
}

export const hashInviteToken = (token) => sha256Hex(token);

// ── Bloqueo por cuenta ─────────────────────────────────────────────────────
// El limitador nativo frena por IP; esto frena ataques repartidos entre muchas IPs.
const LOCK_WINDOW = 15 * 60;
const LOCK_MAX_FAILS = 8;

export async function isAccountLocked(db, email) {
  const row = await db.prepare(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND ok = 0 AND created_at > ?',
  ).bind(email, now() - LOCK_WINDOW).first();
  return (row?.n ?? 0) >= LOCK_MAX_FAILS;
}

export async function recordLoginAttempt(db, email, ip, ok) {
  await db.prepare('INSERT INTO login_attempts (email, ip, ok, created_at) VALUES (?, ?, ?, ?)')
    .bind(email, ip, ok ? 1 : 0, now()).run();
  if (ok) {
    // Tras entrar bien, se olvidan los fallos anteriores de esa cuenta.
    await db.prepare('DELETE FROM login_attempts WHERE email = ? AND ok = 0').bind(email).run();
  }
}

export const nowSeconds = now;
