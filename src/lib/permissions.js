// Catálogo de permisos: lo que se le puede dar a un rol.
// Qué permisos tiene cada rol se guarda en la base de datos (role_permissions) y se cambia desde
// «Usuarios y permisos». Aquí sólo está la descripción de cada uno y de qué depende.
// Es una lista blanca: un rol puede hacer EXACTAMENTE lo que tiene marcado.

export const AREAS = [
  {
    key: 'expedientes',
    label: 'Expedientes',
    permissions: [
      { key: 'expedientes', label: 'Ver y trabajar en los expedientes', help: 'Pedir expedientes, presupuesto, pagos previstos, documentos y notas. Es la base de casi todo lo demás.' },
      { key: 'expediente.open', label: 'Cambiar el número de los expedientes', help: 'Los expedientes reciben su número solos al crearlos; con este permiso se cambia en «Editar» (p. ej. para que coincida con contabilidad) y se ven en Inicio los nuevos de la semana.' },
      { key: 'expediente.close', label: 'Cerrar, reabrir y cancelar expedientes' },
      { key: 'delete', label: 'Borrar lo que han subido otras personas' },
    ],
  },
  {
    key: 'pagos',
    label: 'Pagos a proveedores',
    permissions: [
      { key: 'pagos', label: 'Bandeja de pagos y marcar pagado con tarjeta' },
      { key: 'payment.any_method', label: 'Marcar pagado por transferencia u otro medio' },
      { key: 'payment.receipt', label: 'Subir y quitar el justificante bancario' },
      { key: 'payment.unpay', label: 'Deshacer pagado' },
      { key: 'supplier.review', label: 'Dar por conformes las facturas de proveedor' },
    ],
  },
  {
    key: 'cobros',
    label: 'Cobros a clientes',
    permissions: [
      { key: 'cobros', label: 'Ver los cobros', help: 'Bandeja de cobros, pestaña Cobros, facturas al cliente y PO. Sin este permiso no se ve ninguna factura al cliente.' },
      { key: 'invoice.issue', label: 'Emitir, cobrar y anular facturas al cliente' },
      { key: 'po.manage', label: 'Subir, editar y cerrar las PO del cliente' },
    ],
  },
  {
    key: 'clientes',
    label: 'Clientes',
    permissions: [
      { key: 'clientes', label: 'Ver el directorio y las fichas de clientes', help: 'Contacto, expedientes (previstos, en curso y terminados), ciudades, hoteles y proveedores con los que se ha trabajado (sin importes).' },
      { key: 'clientes.create', label: 'Dar de alta clientes nuevos', help: 'Desde el directorio o al elegir el cliente de una solicitud. Antes se avisa si ya hay alguno con un nombre parecido.' },
      { key: 'clientes.edit', label: 'Editar y fusionar clientes', help: 'Sus datos, las entidades a las que se factura, juntar los duplicados y borrarlos.' },
      { key: 'clientes.economia', label: 'Ver los datos fiscales, las condiciones y el volumen de negocio', help: 'NIF, acuerdo de pago, fee (y el aplicado en cada expediente) y lo presupuestado. Lo facturado y cobrado, además, sólo con «Ver los cobros».' },
    ],
  },
  {
    key: 'viajes',
    label: 'Business Travel',
    permissions: [
      { key: 'viajes', label: 'Ver y gestionar las reservas de Business Travel', help: 'Reservas de viajes de empresa de cada cliente: pasajeros, transporte, alojamiento, inscripciones y otros servicios, con sus importes y el PVP. Aparte de los expedientes.' },
      { key: 'viajes.fee', label: 'Ver y cambiar el fee interno de los viajes', help: 'El fee oculto de cada servicio y el total de fees de cada reserva. Nunca sale en los documentos del cliente.' },
      { key: 'viajes.close', label: 'Cerrar y reabrir reservas de Business Travel', help: 'Cuando el viaje ha terminado y está todo (pasajeros y localizadores). Una reserva cerrada ya no se cambia hasta reabrirla.' },
      { key: 'viajes.albaran', label: 'Emitir, revisar y anular los albaranes de las reservas', help: 'Cada reserva tiene su albarán (todos sus servicios con su PVP, sin el fee), con número propio. Si la reserva cambia después, se emite una revisión. Ver y descargar el albarán basta con ver los viajes.' },
    ],
  },
  {
    key: 'proveedores',
    label: 'Proveedores',
    permissions: [
      { key: 'proveedores', label: 'Ver el directorio y las fichas de proveedores', help: 'Datos de contacto, tipo, comentarios e historial de expedientes (sin importes).' },
      { key: 'proveedores.create', label: 'Dar de alta proveedores nuevos', help: 'Desde el directorio o al elegir el proveedor de un pago. Antes de crearlo se avisa si ya hay alguno con un nombre parecido.' },
      { key: 'proveedores.edit', label: 'Editar y fusionar proveedores', help: 'Cambiar sus datos, juntar los duplicados, borrarlos y gestionar los tipos de proveedor.' },
      { key: 'proveedores.gasto', label: 'Ver las condiciones económicas y el gasto', help: 'Tarifas, condiciones de pago y cuánto se ha contratado, facturado y pagado con cada uno.' },
      { key: 'contratos', label: 'Ver los contratos de los proveedores', help: 'Condiciones, tarifas, descuentos, caducidad y avisos; también los contratos anteriores y su historial.' },
      { key: 'contratos.edit', label: 'Crear, renovar y modificar contratos', help: 'Cada cambio queda en el historial del contrato; al renovar, el anterior se conserva.' },
    ],
  },
  {
    key: 'sistema',
    label: 'Configuración',
    permissions: [
      { key: 'settings', label: 'Ajustes', help: 'Tipos de IVA, numeración de facturas y primer número de expediente.' },
      { key: 'users', label: 'Usuarios, roles y permisos', help: 'Invitar a personas, asignarles un rol y cambiar lo que puede hacer cada rol.' },
    ],
  },
];

export const PERMISSIONS = AREAS.flatMap((a) => a.permissions);
const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));
export const permissionLabel = (key) => BY_KEY.get(key)?.label ?? key;

// Permisos que no tienen sentido sin otro (emitir facturas sin ver los cobros, pagar sin ver los expedientes…)
export const REQUIRES = {
  'expediente.open': 'expedientes',
  'expediente.close': 'expedientes',
  delete: 'expedientes',
  pagos: 'expedientes',
  'payment.any_method': 'pagos',
  'payment.receipt': 'pagos',
  'payment.unpay': 'pagos',
  'supplier.review': 'expedientes',
  cobros: 'expedientes',
  'invoice.issue': 'cobros',
  'po.manage': 'cobros',
  clientes: 'expedientes',
  'clientes.create': 'clientes',
  'clientes.edit': 'clientes',
  'clientes.economia': 'clientes',
  proveedores: 'expedientes',
  'proveedores.create': 'proveedores',
  'proveedores.edit': 'proveedores',
  'proveedores.gasto': 'proveedores',
  contratos: 'proveedores',
  'contratos.edit': 'contratos',
  'viajes.fee': 'viajes',
  'viajes.close': 'viajes',
  'viajes.albaran': 'viajes',
};

/**
 * Deja sólo permisos que existen y cuya base también está marcada.
 * @returns {{ permissions: string[], dropped: string[] }} dropped = los quitados por faltarles su base
 */
export function normalizePermissions(list) {
  const set = new Set([...list].filter((k) => BY_KEY.has(k)));
  const dropped = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of set) {
      const base = REQUIRES[k];
      if (base && !set.has(base)) {
        set.delete(k);
        dropped.push(k);
        changed = true;
      }
    }
  }
  return { permissions: PERMISSIONS.map((p) => p.key).filter((k) => set.has(k)), dropped };
}

/** Qué ha cambiado entre dos listas de permisos (para el registro de actividad) */
export function permissionDiff(before, after) {
  const b = new Set(before);
  const a = new Set(after);
  return { added: [...a].filter((k) => !b.has(k)), removed: [...b].filter((k) => !a.has(k)) };
}

/** «Ventas y Tesorería» → 'ventas_y_tesoreria' (clave estable de un rol nuevo) */
export function roleKey(name) {
  return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'rol';
}

// ── Secciones ──────────────────────────────────────────────────────────────
// Qué permiso hace falta para entrar en cada parte de la aplicación (el middleware lo comprueba
// antes de la página; cada página comprueba además sus acciones). Una ruta que no esté aquí no se
// abre a nadie: una página nueva que se olvide añadir queda cerrada, no abierta.
const ANY_SESSION = new Set(['/', '/cuenta', '/salir', '/404', '/preferencias/tabla']);
const SECTIONS = [
  [/^\/(expedientes|archivos|buscar)(\/|$)/, 'expedientes'],
  [/^\/pagos\/?$/, 'pagos'],
  [/^\/cobros\/?$/, 'cobros'],
  [/^\/clientes(\/|$)/, 'clientes'],
  [/^\/viajes(\/|$)/, 'viajes'],
  [/^\/proveedores\/(contratos|\d+\/contratos)(\/|$)/, 'contratos'],
  [/^\/proveedores(\/|$)/, 'proveedores'],
  [/^\/usuarios(\/|$)/, 'users'],
  [/^\/ajustes\/?$/, 'settings'],
];

/** '' = basta con tener sesión · 'clave' = hace falta ese permiso · null = ruta desconocida (cerrada) */
export function sectionPermission(path) {
  if (ANY_SESSION.has(path)) return '';
  for (const [re, permission] of SECTIONS) if (re.test(path)) return permission;
  return null;
}

// ── Salvaguarda ────────────────────────────────────────────────────────────
/**
 * Cuántas personas activas podrían gestionar usuarios (permiso 'users') si se aplicara un cambio.
 * Tiene que quedar al menos una: si no, nadie podría volver a dar permisos.
 *   users        [{ id, role_id, active }]
 *   managerRoles ids de los roles que hoy tienen 'users'
 *   change       { userId, newRoleId }      → a esa persona se le cambia el rol
 *                { userId, active: false }  → se desactiva o se borra
 *                { roleId, hasUsersPerm }   → a ese rol se le da o se le quita 'users'
 */
export function managersAfter(users, managerRoles, change = {}) {
  const roles = new Set(managerRoles);
  if (change.roleId != null && change.hasUsersPerm != null) {
    if (change.hasUsersPerm) roles.add(change.roleId);
    else roles.delete(change.roleId);
  }
  return users.filter((u) => {
    if (change.userId != null && u.id === change.userId) {
      if (change.active === false) return false;
      return (change.active === true || !!u.active) && roles.has(change.newRoleId ?? u.role_id);
    }
    return !!u.active && roles.has(u.role_id);
  }).length;
}
