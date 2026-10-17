// Utilidades criptográficas sobre WebCrypto (disponible en Workers y navegadores).

const encoder = new TextEncoder();

/** Bytes → hexadecimal */
export function toHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** Bytes → base64url (sin relleno) */
export function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → bytes. Devuelve null si el texto no es válido. */
export function fromBase64Url(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Bytes aleatorios criptográficamente seguros */
export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Token aleatorio en base64url (32 bytes = 256 bits por defecto) */
export function randomToken(n = 32) {
  return toBase64Url(randomBytes(n));
}

/** SHA-256 de un texto, en hexadecimal */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return toHex(new Uint8Array(digest));
}

/** SHA-256 de un texto, en base64 estándar (formato de los hashes CSP) */
export async function sha256Base64(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  let bin = '';
  for (let i = 0; i < digest.length; i++) bin += String.fromCharCode(digest[i]);
  return btoa(bin);
}

/** Compara dos cadenas en tiempo constante (evita ataques de temporización). */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
