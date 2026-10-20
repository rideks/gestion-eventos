// Contexto de servicio para las pruebas: una persona de los datos de ejemplo (con los permisos de su
// rol, leídos de la base como en la aplicación), un almacenamiento de archivos en memoria y la fecha de hoy.
import { today } from '../../src/lib/dates.js';

export function memoryBucket() {
  const files = new Map();
  return {
    files,
    async put(key, value) { files.set(key, value); },
    // Como R2: el objeto, con su contenido en arrayBuffer()
    async get(key) {
      const bytes = files.get(key);
      return bytes ? { size: bytes.length, async arrayBuffer() { return bytes.slice().buffer; } } : null;
    },
    async delete(keys) { for (const k of [].concat(keys)) files.delete(k); },
  };
}

/** ctx como lo crea serviceContext(Astro), para el usuario con ese email */
export function contextFor(db, email, { bucket = memoryBucket(), now = today() } = {}) {
  const u = db.one('SELECT u.id, u.name, u.email, r.name AS role_name, u.role_id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?', email);
  if (!u) throw new Error(`No hay usuario ${email}`);
  const permissions = new Set(db.rows('SELECT permission FROM role_permissions WHERE role_id = ?', u.role_id).map((r) => r.permission));
  const user = { ...u, permissions };
  return { db, bucket, user, actor: { user, ip: '127.0.0.1' }, now };
}

export const EMAILS = {
  jefes: 'direccion@example.com',
  administracion: 'tania@example.com',
  tesoreria: 'tesoreria@example.com',
  eventos: 'marta@example.com',
  tecnico: 'tecnico@example.com',
};
