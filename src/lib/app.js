// Ayudantes comunes de las páginas: permisos, formularios y registro de actividad.
import { getClientIp } from './security.js';

// ── Permisos ───────────────────────────────────────────────────────────────
// Lo que no aparece aquí lo pueden hacer los dos roles (subir facturas, PO, presupuestos…).
// Para cambiar quién hace qué, basta con tocar esta tabla.
const ONLY = {
  'expediente.open': ['admin'],      // dar número al expediente
  'expediente.close': ['admin'],     // cerrar, reabrir y cancelar
  'invoice.issue': ['admin'],        // poner nº a una factura, marcarla cobrada o anularla
  'supplier.review': ['admin'],      // revisar y dar por buena una factura de proveedor
  'delete': ['admin'],               // borrar filas de otras personas
  'users': ['admin'],
  'settings': ['admin'],             // tipos de IVA y numeración
};

export const can = (user, action) => !!user && (ONLY[action] ?? ['admin', 'eventos']).includes(user.role);

/** Si no tiene permiso, redirección al inicio con aviso; si lo tiene, null */
export function deny(Astro, action) {
  return can(Astro.locals.user, action) ? null : Astro.redirect('/?aviso=permiso', 303);
}

// ── Formularios ────────────────────────────────────────────────────────────

/** Id numérico de la URL → número o null */
export function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Lee el formulario sin romper si el cuerpo es inválido o demasiado grande */
export async function readForm(request) {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

export function actor(Astro) {
  return { user: Astro.locals.user, ip: getClientIp(Astro.request) };
}

// ── Actividad ──────────────────────────────────────────────────────────────

/**
 * Apunta qué ha pasado en el expediente ("Ana subió la factura 1225 de Hotel Barceló").
 * El texto se guarda ya redactado: así se lee igual aunque luego cambien los datos.
 * Devuelve la sentencia preparada para poder meterla en un db.batch() junto al cambio.
 */
export function activityStmt(db, { user, ip = null }, expedienteId, action, text = null) {
  return db.prepare('INSERT INTO activity (expediente_id, user_id, user_name, action, text, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(expedienteId, user?.id ?? null, user?.name ?? null, action, text, ip);
}

export async function logActivity(db, who, expedienteId, action, text = null) {
  try {
    await activityStmt(db, who, expedienteId, action, text).run();
  } catch (err) {
    console.error('[actividad]', err);
  }
}

/** Mensajes de las redirecciones (?ok=...) */
export const FLASH = {
  guardado: 'Cambios guardados',
  creado: 'Creado correctamente',
  borrado: 'Eliminado correctamente',
  solicitado: 'Solicitud enviada. Administración la verá en su bandeja para abrir el expediente.',
  abierto: 'Expediente abierto',
  cerrado: 'Expediente cerrado',
  reabierto: 'Expediente reabierto',
  pagado: 'Pago registrado',
  emitida: 'Factura emitida',
  cobrada: 'Cobro registrado',
  pedida: 'Factura pedida a Administración',
  subida: 'Factura subida. Administración la revisará.',
  revisada: 'Factura revisada: conforme',
  quitada: 'Factura quitada del pago',
  nota: 'Nota añadida',
  password: 'Contraseña cambiada. Se ha cerrado la sesión en tus otros dispositivos.',
  sesiones: 'Se ha cerrado la sesión en tus otros dispositivos.',
  bienvenida: '¡Bienvenido/a!',
};
