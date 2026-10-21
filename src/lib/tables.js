// Las tablas de listado de la aplicación: sus columnas (cuáles se ven por defecto, cuáles se pueden añadir con
// «Columnas» y cuáles piden un permiso), por cuáles se puede ordenar y qué filtros llevan. El motor está en
// src/lib/table.js; cada repositorio traduce la columna de orden a SQL (sólo las de esta lista).
//   sort: 'asc' | 'desc'  → se puede ordenar por ella, y en qué sentido al pulsarla la primera vez
//   hidden: true          → no se ve hasta que se añade en «Columnas»
//   fixed: true           → siempre se ve (la que identifica la fila)
//   need                  → el permiso (o permisos) para verla
// views: la tabla se puede ver también como tarjetas; view: la vista por defecto (Expedientes y Business Travel,
// tarjetas; Clientes y Proveedores, tabla). Cada persona elige y se le recuerda.

const ECONOMY = 'clientes.economia';
const BILLING = ['clientes.economia', 'cobros'];

export const TABLES = {
  expedientes: {
    key: 'expedientes', sort: 'fechas', noun: ['expediente', 'expedientes'], views: ['tarjetas', 'tabla'], view: 'tarjetas',
    search: 'Nombre, cliente, destino o nº',
    columns: [
      { key: 'numero', label: 'Expediente', fixed: true, sort: 'desc' },
      { key: 'cliente', label: 'Cliente', sort: 'asc' },
      { key: 'destino', label: 'Destino', hidden: true, sort: 'asc' },
      { key: 'fechas', label: 'Fechas', sort: 'asc' },
      { key: 'responsable', label: 'Responsable', sort: 'asc' },
      { key: 'asistentes', label: 'Asistentes', num: true, hidden: true, sort: 'desc' },
      { key: 'estado', label: 'Estado', sort: 'asc' },
      { key: 'presupuesto', label: 'Presupuesto', num: true, sort: 'desc' },
      { key: 'coste', label: 'Coste', num: true, hidden: true, sort: 'desc' },
      { key: 'por_pagar', label: 'Por pagar', num: true, sort: 'desc' },
      { key: 'facturado', label: 'Facturado', num: true, hidden: true, need: 'cobros', sort: 'desc' },
      { key: 'por_cobrar', label: 'Por cobrar', num: true, need: 'cobros', sort: 'desc' },
      { key: 'beneficio', label: 'Beneficio (cerrados)', num: true, hidden: true, sort: 'desc' },
      { key: 'alta', label: 'Alta', hidden: true, sort: 'desc' },
    ],
    // El estado va en pestañas encima de la lista (en curso, por cerrar, míos, cerrados, cancelados, todos)
    filters: [
      { key: 'cliente', label: 'Cliente', all: 'Todos los clientes' },
      { key: 'responsable', label: 'Responsable', all: 'Todos los responsables' },
      { key: 'mes', label: 'Mes', all: 'Todos los meses' },
    ],
  },

  clientes: {
    key: 'clientes', sort: 'name', noun: ['cliente', 'clientes'], views: ['tarjetas', 'tabla'], view: 'tabla',
    search: 'Nombre, nombre fiscal, NIF, ciudad, nombre anterior o entidad',
    columns: [
      { key: 'name', label: 'Cliente', fixed: true, sort: 'asc' },
      { key: 'tipo', label: 'Tipo', hidden: true, sort: 'asc' },
      { key: 'ciudad', label: 'Ciudad', sort: 'asc' },
      { key: 'nif', label: 'NIF', hidden: true, need: ECONOMY, sort: 'asc' },
      { key: 'email', label: 'Email', hidden: true, sort: 'asc' },
      { key: 'telefono', label: 'Teléfono', hidden: true },
      { key: 'expedientes', label: 'Aceptados', num: true, sort: 'desc' },
      { key: 'cancelados', label: 'Cancelados', num: true, sort: 'desc' },
      { key: 'tasa', label: '% cancelados', num: true, hidden: true, sort: 'desc' },
      { key: 'viajes', label: 'Reservas de viaje', num: true, hidden: true, need: 'viajes', sort: 'desc' },
      { key: 'viajes_canceladas', label: 'Reservas canceladas', num: true, hidden: true, need: 'viajes', sort: 'desc' },
      { key: 'proximo', label: 'Próximo evento', sort: 'asc' },
      { key: 'uso', label: 'Último evento', sort: 'desc' },
      { key: 'fee', label: 'Fee', num: true, need: ECONOMY, sort: 'desc' },
      { key: 'volumen', label: 'Presupuestado', num: true, need: ECONOMY, sort: 'desc' },
      { key: 'year', label: 'Presupuestado este año', num: true, hidden: true, need: ECONOMY, sort: 'desc' },
      { key: 'facturado', label: 'Facturado', num: true, need: BILLING, sort: 'desc' },
      { key: 'pendiente', label: 'Pendiente de cobro', num: true, need: BILLING, sort: 'desc' },
      { key: 'altas', label: 'Alta', hidden: true, sort: 'desc' },
    ],
    filters: [
      { key: 'estado', label: 'Estado', all: 'Todos los estados' },
      { key: 'tipo', label: 'Tipo', all: 'Empresas y personas' },
      { key: 'ciudad', label: 'Ciudad', all: 'Todas las ciudades' },
    ],
  },

  proveedores: {
    key: 'proveedores', sort: 'name', noun: ['proveedor', 'proveedores'], views: ['tarjetas', 'tabla'], view: 'tabla',
    search: 'Nombre, ciudad, contacto o nombre anterior',
    columns: [
      { key: 'name', label: 'Proveedor', fixed: true, sort: 'asc' },
      { key: 'tipo', label: 'Tipo', sort: 'asc' },
      { key: 'ciudad', label: 'Ciudad', sort: 'asc' },
      { key: 'contacto', label: 'Contacto', hidden: true, sort: 'asc' },
      { key: 'telefono', label: 'Teléfono', hidden: true },
      { key: 'email', label: 'Email', hidden: true, sort: 'asc' },
      { key: 'expedientes', label: 'Expedientes', num: true, sort: 'desc' },
      { key: 'uso', label: 'Último evento', sort: 'desc' },
      { key: 'contrato', label: 'Contrato', need: 'contratos' },
      { key: 'altas', label: 'Alta', hidden: true, sort: 'desc' },
      { key: 'year', label: 'Contratado este año', num: true, need: 'proveedores.gasto', sort: 'desc' },
      { key: 'gasto', label: 'Contratado en total', num: true, need: 'proveedores.gasto', sort: 'desc' },
    ],
    filters: [
      { key: 'tipo', label: 'Tipo', all: 'Todos los tipos' },
      { key: 'estado', label: 'Estado', all: 'Todos los estados' },
      { key: 'ciudad', label: 'Ciudad', all: 'Todas las ciudades' },
    ],
  },

  contratos: {
    key: 'contratos', sort: 'estado', noun: ['contrato', 'contratos'],
    search: 'Proveedor, contrato o ciudad',
    columns: [
      { key: 'proveedor', label: 'Proveedor', fixed: true, sort: 'asc' },
      { key: 'contrato', label: 'Contrato', sort: 'asc' },
      { key: 'tipo', label: 'Tipo de proveedor', hidden: true, sort: 'asc' },
      { key: 'ciudad', label: 'Ciudad', hidden: true, sort: 'asc' },
      { key: 'firma', label: 'Firma', hidden: true, sort: 'desc' },
      { key: 'inicio', label: 'Inicio', sort: 'desc' },
      { key: 'fin', label: 'Fin', sort: 'asc' },
      { key: 'estado', label: 'Estado', sort: 'asc' },
      { key: 'aviso', label: 'Aviso', sort: 'asc' },
      { key: 'documento', label: 'Documento', hidden: true },
    ],
    // La pestaña (ver: atención, en vigor…) va aparte, como pestañas encima de la tabla
    filters: [
      { key: 'tipo', label: 'Tipo de proveedor', all: 'Todos los tipos' },
    ],
  },

  // Bandeja de pagos: los pendientes (por plazo) y los ya hechos (historial). En tarjetas, por grupos; en tabla, por páginas
  pagos: {
    key: 'pagos', sort: 'vence', noun: ['pago', 'pagos'], views: ['tarjetas', 'tabla'], view: 'tarjetas',
    search: 'Proveedor, concepto, nº de factura o expediente',
    columns: [
      { key: 'proveedor', label: 'Proveedor', fixed: true, sort: 'asc' },
      { key: 'expediente', label: 'Expediente', sort: 'desc' },
      { key: 'vence', label: 'Fecha límite', sort: 'asc' },
      { key: 'estado', label: 'Plazo', sort: 'asc' },
      { key: 'factura', label: 'Factura' },
      { key: 'tipo', label: 'Tipo', hidden: true, sort: 'asc' },
      { key: 'base', label: 'Sin IVA', num: true, hidden: true, sort: 'desc' },
      { key: 'total', label: 'Importe', num: true, sort: 'desc' },
      { key: 'alta', label: 'Alta', hidden: true, sort: 'desc' },
    ],
    filters: [
      { key: 'plazo', label: 'Plazo', all: 'Todos los plazos' },
      { key: 'tipo', label: 'Tipo', all: 'Pagos y liquidaciones' },
    ],
  },

  pagados: {
    key: 'pagados', sort: 'pagado', noun: ['pago', 'pagos'], views: ['tarjetas', 'tabla'], view: 'tarjetas',
    search: 'Proveedor, nº de factura o expediente',
    columns: [
      { key: 'proveedor', label: 'Proveedor', fixed: true, sort: 'asc' },
      { key: 'expediente', label: 'Expediente', sort: 'desc' },
      { key: 'pagado', label: 'Pagado el', sort: 'desc' },
      { key: 'forma', label: 'Forma de pago', sort: 'asc' },
      { key: 'factura', label: 'Factura' },
      { key: 'justificante', label: 'Justificante', hidden: true },
      { key: 'tipo', label: 'Tipo', hidden: true, sort: 'asc' },
      { key: 'base', label: 'Sin IVA', num: true, hidden: true, sort: 'desc' },
      { key: 'total', label: 'Importe', num: true, sort: 'desc' },
    ],
    filters: [
      { key: 'mes', label: 'Mes', all: 'Todos los meses' },
      { key: 'forma', label: 'Forma de pago', all: 'Todas las formas' },
      { key: 'tipo', label: 'Tipo', all: 'Pagos y liquidaciones' },
    ],
  },

  // Cobros: las facturas por emitir y por cobrar, y las cobradas (historial). En tarjetas, como embudo o por meses
  cobros: {
    key: 'cobros', sort: 'estado', noun: ['factura', 'facturas'], views: ['tarjetas', 'tabla'], view: 'tarjetas',
    search: 'Cliente, expediente, nº de factura o PO',
    columns: [
      { key: 'factura', label: 'Factura', fixed: true, sort: 'asc' },
      { key: 'cliente', label: 'Cliente', sort: 'asc' },
      { key: 'expediente', label: 'Expediente', sort: 'desc' },
      { key: 'estado', label: 'Estado', sort: 'asc' },
      { key: 'emitida', label: 'Emitida', hidden: true, sort: 'desc' },
      { key: 'vence', label: 'Vence', sort: 'asc' },
      { key: 'envio', label: 'Envío al cliente', hidden: true },
      { key: 'po', label: 'PO', hidden: true },
      { key: 'base', label: 'Sin IVA', num: true, hidden: true, sort: 'desc' },
      { key: 'total', label: 'Importe', num: true, sort: 'desc' },
    ],
    filters: [
      { key: 'estado', label: 'Estado', all: 'Por emitir y por cobrar' },
    ],
  },

  cobradas: {
    key: 'cobradas', sort: 'cobrada', noun: ['factura', 'facturas'], views: ['tarjetas', 'tabla'], view: 'tarjetas',
    search: 'Cliente, expediente, nº de factura o PO',
    columns: [
      { key: 'factura', label: 'Factura', fixed: true, sort: 'asc' },
      { key: 'cliente', label: 'Cliente', sort: 'asc' },
      { key: 'expediente', label: 'Expediente', sort: 'desc' },
      { key: 'emitida', label: 'Emitida', hidden: true, sort: 'desc' },
      { key: 'cobrada', label: 'Cobrada el', sort: 'desc' },
      { key: 'po', label: 'PO', hidden: true },
      { key: 'base', label: 'Sin IVA', num: true, hidden: true, sort: 'desc' },
      { key: 'total', label: 'Importe', num: true, sort: 'desc' },
    ],
    filters: [
      { key: 'mes', label: 'Mes', all: 'Todos los meses' },
    ],
  },

  viajes: {
    key: 'viajes', sort: 'reserva', noun: ['reserva', 'reservas'], views: ['tarjetas', 'tabla'], view: 'tarjetas',
    search: 'Referencia, cliente, pasajero, proveedor o localizador',
    columns: [
      { key: 'reserva', label: 'Nº de reserva', fixed: true, sort: 'desc' },
      { key: 'cliente', label: 'Cliente', sort: 'asc' },
      { key: 'fechas', label: 'Fechas', sort: 'asc' },
      { key: 'pasajeros', label: 'Pasajeros', num: true, sort: 'desc' },
      { key: 'servicios', label: 'Servicios', num: true, sort: 'desc' },
      { key: 'base', label: 'Sin IVA', num: true, hidden: true, sort: 'desc' },
      { key: 'total', label: 'Con IVA', num: true, sort: 'desc' },
      { key: 'fee', label: 'Fee', num: true, need: 'viajes.fee', sort: 'desc' },
      { key: 'pvp', label: 'PVP', num: true, sort: 'desc' },
      { key: 'estado', label: 'Estado', sort: 'asc' },
      { key: 'albaran', label: 'Albarán', sort: 'asc' },
      { key: 'creada', label: 'Creada', hidden: true, sort: 'desc' },
      { key: 'creador', label: 'Creada por', hidden: true, sort: 'asc' },
    ],
    // El estado va en pestañas encima de la lista (en curso, por cerrar, mías, cerradas, canceladas, todas)
    filters: [
      { key: 'cliente', label: 'Cliente', all: 'Todos los clientes' },
      { key: 'mes', label: 'Mes', all: 'Todos los meses' },
    ],
  },
};
