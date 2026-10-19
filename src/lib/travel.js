// Business Travel — reglas puras (sin base de datos): los cuatro bloques de servicios, sus importes y el
// resumen de una reserva. Las consultas están en src/repos/travel.js y los casos de uso en src/services/travel.js.
//
// Importes de cada servicio (en céntimos; el IVA en puntos básicos: 21 % → 2100):
//   · Se escribe el importe sin IVA o el importe con IVA, y el otro se calcula con el % de IVA:
//       con IVA = sin IVA × (1 + IVA)        sin IVA = con IVA / (1 + IVA)        (redondeo al céntimo)
//     Si se escriben los dos (copiados de la factura del proveedor, con sus redondeos) se respetan.
//   · Fee oculto: lo que se cobra al cliente además del servicio. No sale nunca como concepto aparte en los
//     documentos del cliente.
//   · PVP = importe con IVA + fee.
// El resumen de una reserva suma sus servicios: los pasajeros no multiplican nada (un hotel con dos huéspedes
// es un servicio con un importe).
import { resolveLine } from './vat.js';
import { parseAmount } from './money.js';
import { formatDate } from './dates.js';

/**
 * Los cuatro bloques de una reserva y lo que se pide en cada uno (las etiquetas de sus campos).
 * supplier: 'required' | 'optional' · passengers: 'many' | 'one' (la inscripción es de un asistente)
 * vat: el IVA que se propone (transporte de viajeros y hostelería al 10 %; inscripciones al 21 %). Se cambia en cada
 *   servicio (p. ej. un vuelo internacional, sin IVA). Si ese tipo no está en Ajustes, se propone el de por defecto.
 */
export const LINE_KINDS = {
  transporte: {
    label: 'Transporte', one: 'transporte', icon: 'plane', supplier: 'required', passengers: 'many', vat: 1000,
    fields: { description: 'Trayecto', start_date: 'Fecha de ida', end_date: 'Fecha de vuelta', locator: 'Localizador', issued_on: 'Fecha de emisión', details: 'Datos adicionales' },
    required: ['start_date'],
    placeholders: { description: 'Madrid → Barcelona · vuelo VY1001', details: 'Horarios, clase, equipaje…' },
    who: 'Pasajeros',
  },
  alojamiento: {
    label: 'Alojamiento', one: 'alojamiento', icon: 'bed-double', supplier: 'required', passengers: 'many', vat: 1000,
    fields: { description: 'Establecimiento', start_date: 'Check-in', end_date: 'Check-out', locator: 'Nº de reserva', details: 'Información adicional' },
    required: ['start_date', 'end_date'],
    placeholders: { description: 'NH Collection Madrid Eurobuilding', details: 'Habitación doble, desayuno incluido…' },
    who: 'Huéspedes',
  },
  inscripcion: {
    label: 'Inscripción', one: 'inscripción', icon: 'ticket', supplier: 'optional', passengers: 'one', vat: 2100,
    fields: { description: 'Inscripción, actividad o evento', start_date: 'Fecha de inicio', end_date: 'Fecha de fin', locator: 'Nº de inscripción', details: 'Información adicional' },
    required: ['description'],
    placeholders: { description: 'Congreso Nacional SEOM 2026', details: 'Cuota de socio, cursos…' },
    who: 'Asistente',
  },
  otros: {
    label: 'Otros servicios', one: 'servicio', icon: 'luggage', supplier: 'optional', passengers: 'many',
    fields: { description: 'Descripción del servicio', start_date: 'Fecha', locator: 'Referencia', details: 'Información adicional' },
    required: ['description'],
    placeholders: { description: 'Traslado aeropuerto - hotel', details: '' },
    who: 'Pasajeros',
  },
};
export const KIND_KEYS = Object.keys(LINE_KINDS);

/** El IVA que se propone en un servicio nuevo de ese bloque (si está en la lista; si no, el de por defecto) */
export function suggestedVat(kind, rates, fallback) {
  const bp = LINE_KINDS[kind]?.vat;
  return bp !== undefined && rates.some((r) => r.rate_bp === bp) ? bp : fallback;
}

export const BOOKING_STATUS = { abierta: 'Abierta', cancelada: 'Cancelada' };

// ── Estado de una reserva, pestañas y cierre ────────────────────────────────
// Una reserva nace abierta. Cuando pasa la fecha de su último servicio queda «por cerrar» y se cierra a mano
// (comprobando antes lo de closeChecks); se puede reabrir. Cerrada y cancelada son de sólo lectura. Cerrada no es
// un estado aparte en la base: es una reserva abierta con fecha de cierre (closed_at).

/** Las pestañas de Business Travel (como las de Expedientes) */
export const BOOKING_TABS = {
  curso: 'En curso', cerrar: 'Por cerrar', mias: 'Mías', cerradas: 'Cerradas', canceladas: 'Canceladas', todas: 'Todas',
};

/**
 * El estado de una reserva para enseñarlo: { key, label, tone } (tone: el color de la etiqueta)
 * @param {{ status: string, closed_at?: string | null, lines?: number, first_date?: string | null, last_date?: string | null }} b
 * @param {string} today 'YYYY-MM-DD'
 */
export function bookingState(b, today) {
  if (b.status === 'cancelada') return { key: 'cancelada', label: 'Cancelada', tone: 'muted' };
  if (b.closed_at) return { key: 'cerrada', label: 'Cerrada', tone: 'accent' };
  if (!b.lines) return { key: 'vacia', label: 'Sin servicios', tone: 'warn' };
  if (b.last_date && b.last_date < today) return { key: 'por_cerrar', label: 'Viaje hecho · por cerrar', tone: 'info' };
  if (b.first_date && b.first_date <= today) return { key: 'de_viaje', label: 'De viaje', tone: 'ok' };
  return { key: 'en_curso', label: 'En curso', tone: 'ok' };
}

/** Los servicios que necesitan su localizador (o nº de reserva o de inscripción) para cerrar; en «otros» (un taxi…) no siempre hay */
export const NEEDS_LOCATOR = ['transporte', 'alojamiento', 'inscripcion'];

/**
 * Antes de cerrar una reserva: lo que está hecho y lo que falta. Se cierra sólo con todo en verde.
 * @param {{ passengers: any[], lines: { kind: string, locator?: string | null, description?: string | null, start_date?: string | null, end_date?: string | null, passenger_ids?: number[] }[] }} booking
 * @param {string} today 'YYYY-MM-DD'
 * @returns {{ key: string, ok: boolean, label: string, missing?: string[] }[]}
 */
export function closeChecks({ passengers, lines }, today) {
  const { to } = bookingDates(lines);
  const name = (l) => l.description || LINE_KINDS[l.kind]?.label || 'Servicio';
  const noLocator = lines.filter((l) => NEEDS_LOCATOR.includes(l.kind) && !String(l.locator ?? '').trim());
  const alone = lines.filter((l) => !(l.passenger_ids ?? []).length);
  return [
    { key: 'servicios', ok: lines.length > 0, label: lines.length ? 'Tiene sus servicios' : 'Todavía no tiene servicios' },
    {
      key: 'terminado', ok: !!to && to < today,
      label: !to ? 'Sus servicios no tienen fechas' : to < today ? `El viaje terminó el ${formatDate(to)}` : `El viaje termina el ${formatDate(to)}: se cierra después`,
    },
    {
      key: 'pasajeros', ok: passengers.length > 0 && !alone.length,
      label: !passengers.length ? 'No tiene pasajeros' : alone.length ? 'Hay servicios sin pasajeros' : 'Cada servicio tiene sus pasajeros',
      missing: alone.map(name),
    },
    {
      key: 'localizadores', ok: !noLocator.length,
      label: noLocator.length ? 'Faltan localizadores' : 'Todos los servicios tienen su localizador',
      missing: noLocator.map(name),
    },
  ];
}
export const TITLES = ['Dr.', 'Dra.'];

/** 'Dra. María López' · 'Carlos García' */
export const personName = (p) => [p?.title, p?.first_name, p?.last_name].filter(Boolean).join(' ');

/** Referencia de una reserva: BT-2026-0001 */
export const bookingReference = (year, n) => `BT-${year}-${String(n).padStart(4, '0')}`;

/**
 * Importes de un servicio a partir de lo escrito (textos del formulario).
 * fee: null = no se ha escrito (sin permiso para verlo: se conserva el que tenía).
 * @param {{ base?: string, total?: string, vat?: string|number, fee?: string|null }} raw
 * @returns {{ ok: true, base: number, total: number, vat_bp: number, fee: number|null } | { ok: false, field: string, message: string }}
 */
export function parseLineAmounts(raw) {
  const vat = String(raw.vat ?? '').trim() === '' ? NaN : Number(raw.vat);
  if (!Number.isInteger(vat) || vat < 0 || vat > 10000) return { ok: false, field: 'vat', message: 'IVA: elige el porcentaje' };
  const r = resolveLine({ base: parseAmount(raw.base), total: parseAmount(raw.total), rate: vat });
  if (!r.ok) return { ok: false, field: 'amount', message: `Importe: ${r.message}` };
  let fee = null;
  if (raw.fee !== null && raw.fee !== undefined) {
    const f = parseAmount(raw.fee);
    if (Number.isNaN(f)) return { ok: false, field: 'fee', message: 'Fee: escríbelo con números, por ejemplo 15 o 12,50' };
    if (f !== null && f < 0) return { ok: false, field: 'fee', message: 'Fee: no puede ser negativo' };
    fee = f ?? 0;
  }
  return { ok: true, base: r.base, total: r.total, vat_bp: vat, fee };
}

/** PVP de un servicio: con IVA + fee */
export const pvpOf = (total, fee) => total + (fee ?? 0);

const empty = () => ({ count: 0, base: 0, total: 0, fee: 0, pvp: 0 });

/**
 * Resumen económico de una reserva (o de cualquier lista de servicios), en total y por bloque.
 * @param {{ kind: string, base_cents: number, total_cents: number, fee_cents: number, pvp_cents: number }[]} lines
 */
export function bookingSummary(lines) {
  const total = empty();
  const byKind = Object.fromEntries(KIND_KEYS.map((k) => [k, empty()]));
  for (const l of lines) {
    for (const t of [total, byKind[l.kind]]) {
      if (!t) continue;
      t.count += 1;
      t.base += l.base_cents;
      t.total += l.total_cents;
      t.fee += l.fee_cents;
      t.pvp += l.pvp_cents;
    }
  }
  return { ...total, byKind };
}

/** Desde cuándo y hasta cuándo: la primera fecha y la última de sus servicios */
export function bookingDates(lines) {
  const dates = lines.flatMap((l) => [l.start_date, l.end_date]).filter(Boolean).sort();
  return { from: dates[0] ?? null, to: dates.at(-1) ?? null };
}
