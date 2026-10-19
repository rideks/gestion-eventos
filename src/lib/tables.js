// Las tablas de listado de la aplicación: sus columnas (cuáles se ven por defecto, cuáles se pueden añadir con
// «Columnas» y cuáles piden un permiso), por cuáles se puede ordenar y qué filtros llevan. El motor está en
// src/lib/table.js; cada repositorio traduce la columna de orden a SQL (sólo las de esta lista).
//   sort: 'asc' | 'desc'  → se puede ordenar por ella, y en qué sentido al pulsarla la primera vez
//   hidden: true          → no se ve hasta que se añade en «Columnas»
//   fixed: true           → siempre se ve (la que identifica la fila)
//   need                  → el permiso (o permisos) para verla

const ECONOMY = 'clientes.economia';
const BILLING = ['clientes.economia', 'cobros'];

export const TABLES = {
  clientes: {
    key: 'clientes', sort: 'name', noun: ['cliente', 'clientes'],
    search: 'Nombre, nombre fiscal, NIF, ciudad, nombre anterior o entidad',
    columns: [
      { key: 'name', label: 'Cliente', fixed: true, sort: 'asc' },
      { key: 'tipo', label: 'Tipo', hidden: true, sort: 'asc' },
      { key: 'ciudad', label: 'Ciudad', sort: 'asc' },
      { key: 'nif', label: 'NIF', hidden: true, need: ECONOMY, sort: 'asc' },
      { key: 'email', label: 'Email', hidden: true, sort: 'asc' },
      { key: 'telefono', label: 'Teléfono', hidden: true },
      { key: 'expedientes', label: 'Expedientes', num: true, sort: 'desc' },
      { key: 'viajes', label: 'Reservas de viaje', num: true, hidden: true, need: 'viajes', sort: 'desc' },
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
    key: 'proveedores', sort: 'name', noun: ['proveedor', 'proveedores'],
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

  viajes: {
    key: 'viajes', sort: 'reserva', noun: ['reserva', 'reservas'],
    search: 'Referencia, cliente, pasajero, proveedor o localizador',
    columns: [
      { key: 'reserva', label: 'Reserva', fixed: true, sort: 'desc' },
      { key: 'cliente', label: 'Cliente', sort: 'asc' },
      { key: 'fechas', label: 'Fechas', sort: 'asc' },
      { key: 'pasajeros', label: 'Pasajeros', num: true, sort: 'desc' },
      { key: 'servicios', label: 'Servicios', num: true, sort: 'desc' },
      { key: 'base', label: 'Sin IVA', num: true, hidden: true, sort: 'desc' },
      { key: 'total', label: 'Con IVA', num: true, sort: 'desc' },
      { key: 'fee', label: 'Fee', num: true, need: 'viajes.fee', sort: 'desc' },
      { key: 'pvp', label: 'PVP', num: true, sort: 'desc' },
      { key: 'estado', label: 'Estado', hidden: true, sort: 'asc' },
      { key: 'creada', label: 'Creada', hidden: true, sort: 'desc' },
      { key: 'creador', label: 'Creada por', hidden: true, sort: 'asc' },
    ],
    filters: [
      { key: 'cliente', label: 'Cliente', all: 'Todos los clientes' },
      { key: 'mes', label: 'Mes', all: 'Todos los meses' },
      { key: 'estado', label: 'Estado', all: 'Todos los estados' },
    ],
  },
};
