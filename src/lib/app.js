// Ayudantes comunes de las páginas: permisos, formularios y registro de actividad.
import { getClientIp } from './security.js';

// ── Permisos ───────────────────────────────────────────────────────────────
// Cada rol tiene su lista de permisos en la base de datos (role_permissions) y llega con la sesión
// (src/lib/auth.js). Lista blanca: lo que el rol no tiene marcado, no lo puede hacer.
// El catálogo de permisos y su descripción están en src/lib/permissions.js.
export const can = (user, action) => !!user?.permissions?.has(action);

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
/**
 * @param {any} db
 * @param {{ user: any, ip?: string | null }} who
 * @param {number | null} expedienteId null: actividad general (proveedores, contratos…)
 * @param {string} action
 * @param {string | null} [text]
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
  emitida: 'Factura emitida: ya tiene su número',
  enviada: 'Factura emitida y enviada al cliente (envío simulado: todavía no sale ningún correo)',
  envio: 'Factura enviada al cliente (envío simulado: todavía no sale ningún correo)',
  cobrada: 'Cobro registrado',
  pedida: 'Factura pedida a Administración',
  subida: 'Factura subida. Administración la dará por conforme cuando el pago esté hecho.',
  revisada: 'Factura revisada: conforme',
  quitada: 'Documento quitado del pago',
  proforma: 'Proforma subida',
  justificante: 'Justificante subido',
  documento: 'Documento subido',
  renovado: 'Renovación guardada: el contrato anterior se conserva en el historial',
  deshecho: 'El pago vuelve a estar por pagar: corrígelo y márcalo pagado de nuevo',
  po_cerrada: 'PO cerrada: lo que quedaba sin facturar ya no cuenta como pendiente',
  po_reabierta: 'PO reabierta',
  nota: 'Nota añadida',
  password: 'Contraseña cambiada. Se ha cerrado la sesión en tus otros dispositivos.',
  sesiones: 'Se ha cerrado la sesión en tus otros dispositivos.',
  bienvenida: '¡Bienvenido/a!',
  creada: 'Reserva creada: añade sus pasajeros y servicios',
  cancelada: 'Reserva cancelada: se conserva y se puede reabrir',
  reabierta: 'Reserva reabierta',
  pasajero: 'Pasajero añadido',
  servicio: 'Servicio añadido',
  quitado: 'Quitado de la reserva',
  columnas: 'Columnas guardadas: se mantienen la próxima vez',
};
