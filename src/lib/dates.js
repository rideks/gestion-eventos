// Fechas de negocio 'YYYY-MM-DD' (vencimientos, facturas, fechas del evento).
// Se guardan y se comparan como texto: '2026-01-29' < '2026-02-01'.

export const TZ = 'Europe/Madrid';

const pad = (n) => String(n).padStart(2, '0');

/** Hoy en Madrid → 'YYYY-MM-DD' */
export function today(tz = TZ) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p; // el formato en-CA ya es 'YYYY-MM-DD'
}

/** 'YYYY-MM-DD' que existe de verdad (no vale el 30 de febrero) */
export function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 'YYYY-MM-DD' + n días */
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Días de 'from' a 'to' (negativo si 'to' ya pasó) */
export function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

const asDate = (s) => (isDate(s) ? new Date(`${s}T00:00:00Z`) : null);
const fmt = (s, options) => {
  const d = asDate(s);
  return d ? new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', ...options }).format(d) : '';
};

/** '29/01/2026' */
export const formatDate = (s) => {
  const d = asDate(s);
  return d ? `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` : '';
};

/** '29 ene 2026' */
export const formatDateLong = (s) => fmt(s, { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');

/** Fechas del evento: '20–22 abr 2026' · '30 abr – 2 may 2026' · '6 may 2026' */
export function formatRange(start, end) {
  if (!isDate(start)) return '';
  if (!isDate(end) || end === start) return formatDateLong(start);
  const [ys, ms] = [start.slice(0, 4), start.slice(5, 7)];
  const [ye, me] = [end.slice(0, 4), end.slice(5, 7)];
  const day = (s) => Number(s.slice(8, 10));
  const month = (s) => fmt(s, { month: 'short' }).replace('.', '');
  if (ys === ye && ms === me) return `${day(start)}–${day(end)} ${month(end)} ${ye}`;
  if (ys === ye) return `${day(start)} ${month(start)} – ${day(end)} ${month(end)} ${ye}`;
  return `${formatDateLong(start)} – ${formatDateLong(end)}`;
}

/** Texto relativo de un vencimiento: 'vence hoy' · 'vence en 3 días' · 'venció hace 5 días' */
export function dueText(due, now = today()) {
  if (!isDate(due)) return 'sin fecha límite';
  const d = daysBetween(now, due);
  if (d === 0) return 'vence hoy';
  if (d === 1) return 'vence mañana';
  if (d > 1) return `vence en ${d} días`;
  if (d === -1) return 'venció ayer';
  return `venció hace ${-d} días`;
}

/** ISO UTC de la actividad (2026-10-13T10:00:00Z) → '13 oct, 12:00' en Madrid ({ year: true }: '13 oct 2026, 12:00') */
export function formatStamp(iso, { year = false } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ, day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit',
  }).format(d).replace('.', '');
}

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** '2026-10' → 'octubre de 2026' */
export function formatMonth(key) {
  if (!/^\d{4}-\d{2}$/.test(key)) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${key}-01T00:00:00Z`));
}
