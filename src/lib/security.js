// Cabeceras de seguridad, comprobación de origen (CSRF), rate limiting y Turnstile.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** IP del visitante. En Cloudflare la cabecera cf-connecting-ip no se puede falsificar. */
export function getClientIp(request) {
  return request.headers.get('cf-connecting-ip') ?? '127.0.0.1';
}

/**
 * Protección CSRF para cualquier petición que modifique datos.
 * Usa Fetch Metadata (Sec-Fetch-Site), que envían todos los navegadores modernos,
 * y el Origin como respaldo. Si no hay ninguna de las dos, se rechaza
 * (sin ellas no se acepta).
 */
export function isTrustedMutation(request, url) {
  if (SAFE_METHODS.has(request.method)) return true;
  // Sec-Fetch-Site lo pone el navegador y ninguna web puede falsificarlo
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  // Navegadores antiguos: comparamos el Origin
  const origin = request.headers.get('origin');
  return origin === url.origin;
}

/** Añade las cabeceras de seguridad comunes (la CSP la pone Astro). */
export function applySecurityHeaders(response, { url }) {
  const h = response.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'same-origin');
  h.set('X-Frame-Options', 'DENY');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()');
  if (url.protocol === 'https:') {
    // Sin includeSubDomains/preload: no controlamos otros subdominios.
    h.set('Strict-Transport-Security', 'max-age=31536000');
  }
  // La aplicación es privada (datos económicos): nunca en caché compartida ni en buscadores
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
  h.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

/**
 * Rate limiting nativo de Workers. Devuelve true si se permite la petición.
 * Si el binding no existe (p. ej. alguien olvidó configurarlo) no bloquea, pero avisa.
 */
export async function rateLimit(binding, key) {
  if (!binding?.limit) {
    console.warn('[rate-limit] binding no configurado');
    return true;
  }
  try {
    const { success } = await binding.limit({ key });
    return success;
  } catch (err) {
    console.error('[rate-limit]', err);
    return true;
  }
}

// ── Turnstile ──────────────────────────────────────────────────────────────
const TURNSTILE_TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA', // siempre pasa
  '2x0000000000000000000000000000000AA', // siempre falla
]);

/**
 * Verifica el token de Turnstile en el servidor.
 * Comprueba además la acción y el dominio (evita reutilizar tokens de otra web).
 * Si falta el secreto en producción, falla en cerrado.
 */
export async function verifyTurnstile({ token, secret, ip, action, hostname }) {
  if (!secret) {
    console.error('[turnstile] Falta TURNSTILE_SECRET_KEY (wrangler secret put TURNSTILE_SECRET_KEY)');
    return false;
  }
  // Claves de PRUEBA: sólo valen en local (así se puede desarrollar sin conexión).
  // Si alguien despliega con ellas por error, el acceso queda bloqueado en vez de desprotegido.
  if (TURNSTILE_TEST_SECRETS.has(secret)) {
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (!isLocal) console.error('[turnstile] Clave de PRUEBA en producción: wrangler secret put TURNSTILE_SECRET_KEY');
    return isLocal && secret.startsWith('1x');
  }
  if (!token || typeof token !== 'string' || token.length > 2048) return false;

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip, idempotency_key: crypto.randomUUID() }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (!data.success) return false;
    if (action && data.action !== action) return false;
    if (hostname && data.hostname !== hostname) return false;
    return true;
  } catch (err) {
    console.error('[turnstile]', err);
    return false;
  }
}

// ── Contraseñas filtradas (Have I Been Pwned, k-anonimato) ─────────────────
// Sólo se envían los 5 primeros caracteres del SHA-1: la contraseña nunca sale del servidor.
// Si el servicio no responde, no bloquea el alta.
export async function isPasswordPwned(password) {
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const suffix = hex.slice(5);
    const text = await res.text();
    return text.split('\n').some((line) => {
      const [hash, count] = line.trim().split(':');
      return hash === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
