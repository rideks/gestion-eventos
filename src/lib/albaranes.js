// Business Travel — el albarán de cada reserva (reglas puras, sin base de datos). Las consultas están en
// src/repos/albaranes.js y los casos de uso en src/services/albaranes.js.
//
// Cada reserva tiene su albarán: un documento con todos sus servicios por bloque (transporte, alojamiento,
// inscripción y otros), el PVP de cada uno, el subtotal de cada bloque y el PVP total. El fee no sale nunca
// (va dentro del PVP) ni el desglose de IVA: el albarán no es una factura.
//   · Pendiente de emisión: la reserva tiene servicios y todavía no tiene albarán (no se guarda: se deduce).
//   · Emitido: tiene su número (ALB-2026-000001, formato de Ajustes) y su revisión 1.
//   · Si después la reserva cambia algo de lo que sale en el documento, se emite una revisión (2, 3…) con el
//     mismo número; las anteriores se conservan tal cual y se pueden volver a sacar.
//   · Facturado: está en una factura (próxima versión). Anulado: no vale (se conserva con su motivo).
import { LINE_KINDS, KIND_KEYS, personName } from './travel.js';
import { yearly, COMPANY_FALLBACK } from './documents.js';
import { eur } from './money.js';
import { formatDate } from './dates.js';

export const DEFAULT_ALBARAN_PATTERN = 'ALB-{yyyy}-{n}';

/** El contador de la serie: uno por año si el formato lleva el año */
export const albaranCounterKey = (pattern, year) => (yearly(pattern) ? `bt_albaran:${year}` : 'bt_albaran');

export const ALBARAN_STATES = {
  pendiente: { key: 'pendiente', label: 'Pendiente de emisión', tone: 'warn' },
  emitido: { key: 'emitido', label: 'Emitido', tone: 'ok' },
  facturado: { key: 'facturado', label: 'Facturado', tone: 'accent' },
  anulado: { key: 'anulado', label: 'Anulado', tone: 'muted' },
};

/**
 * Los datos del cliente que salen en el documento: el nombre fiscal (con su tratamiento si es una persona),
 * el NIF, la dirección fiscal y el email de facturación (o el de contacto).
 * @param {{ name: string, legal_name?: string | null, title?: string | null, kind?: string | null, tax_id?: string | null,
 *   fiscal_address?: string | null, city?: string | null, billing_email?: string | null, email?: string | null }} c
 */
export function clientBlock(c) {
  const name = c.legal_name || c.name;
  return {
    name: c.kind === 'persona' && c.title ? `${c.title} ${name}` : name,
    tax_id: c.tax_id || null,
    address: c.fiscal_address || c.city || null,
    email: c.billing_email || c.email || null,
  };
}

/**
 * Lo que dice el albarán de una reserva (sin el emisor): el cliente, la reserva, sus pasajeros y sus servicios por
 * bloque con su PVP. Es lo que se compara para saber si la reserva ha cambiado desde que se emitió.
 * @param {{ booking: { reference: string, title?: string | null }, client: Parameters<typeof clientBlock>[0],
 *   passengers: { id: number, title?: string | null, first_name: string, last_name: string }[],
 *   lines: { kind: string, supplier?: string | null, description?: string | null, start_date?: string | null, end_date?: string | null,
 *     locator?: string | null, details?: string | null, pvp_cents: number, passenger_ids?: number[] }[] }} d
 */
export function albaranContent({ booking, client, passengers, lines }) {
  const names = new Map(passengers.map((p) => [p.id, personName(p)]));
  const groups = KIND_KEYS.map((kind) => {
    const rows = lines.filter((l) => l.kind === kind).map((l) => ({
      supplier: l.supplier || null,
      description: l.description || null,
      start_date: l.start_date || null,
      end_date: l.end_date || null,
      locator: l.locator || null,
      details: l.details || null,
      passengers: (l.passenger_ids ?? []).map((id) => names.get(id)).filter(Boolean),
      pvp_cents: l.pvp_cents,
    }));
    return { kind, lines: rows, subtotal_cents: rows.reduce((s, r) => s + r.pvp_cents, 0) };
  }).filter((g) => g.lines.length);
  return {
    client: clientBlock(client),
    booking: { reference: booking.reference, title: booking.title || null },
    passengers: passengers.map(personName),
    groups,
    total_cents: groups.reduce((s, g) => s + g.subtotal_cents, 0),
  };
}

/** Lo que se compara de un albarán guardado (sin el emisor, que puede cambiar en Ajustes sin tocar la reserva) */
const comparable = (/** @type {Record<string, any>} */ c) => JSON.stringify({ client: c.client, booking: c.booking, passengers: c.passengers, groups: c.groups });

/** ¿Dicen lo mismo? (el contenido guardado y el de ahora) */
export const sameContent = (/** @type {Record<string, any>} */ a, /** @type {Record<string, any>} */ b) => comparable(a) === comparable(b);

/**
 * Qué ha cambiado entre el albarán emitido y la reserva de ahora, en pocas palabras:
 * ['los datos del cliente', 'los servicios', 'el PVP total: 1.000,00 € → 1.200,00 €']
 */
export function contentChanges(/** @type {Record<string, any>} */ before, /** @type {Record<string, any>} */ after) {
  const out = [];
  const same = (/** @type {string} */ k) => JSON.stringify(before[k]) === JSON.stringify(after[k]);
  if (!same('client')) out.push('los datos del cliente');
  if (!same('booking')) out.push('la descripción de la reserva');
  if (!same('passengers')) out.push('los pasajeros');
  if (!same('groups')) out.push('los servicios');
  if (before.total_cents !== after.total_cents) out.push(`el PVP total: ${eur(before.total_cents)} → ${eur(after.total_cents)}`);
  return out;
}

/** 'Fecha de ida 18/11/2026 · Fecha de vuelta 20/11/2026 · Localizador IRY7Q2K · Clase Singular' */
function lineDetail(kind, l) {
  const f = LINE_KINDS[kind].fields;
  const dates = l.end_date && l.end_date !== l.start_date && f.end_date
    ? [`${f.start_date} ${formatDate(l.start_date)}`, `${f.end_date} ${formatDate(l.end_date)}`]
    : [l.start_date && `${f.start_date} ${formatDate(l.start_date)}`];
  return [...dates, l.locator && `${f.locator} ${l.locator}`, l.details].filter(Boolean).join(' · ');
}

/** Un nombre de archivo sin caracteres raros: 'Albaran-ALB-2026-000001-rev2.pdf' */
export function albaranFileName({ number, revision = 1, draft = false, reference = '' }) {
  const base = draft ? `Albaran-borrador-${reference}` : `Albaran-${number}${revision > 1 ? `-rev${revision}` : ''}`;
  return `${base.replace(/[^\w.-]+/g, '-')}.pdf`;
}

/**
 * Lo que se enseña del albarán, ya en textos: lo mismo para la vista imprimible y para el PDF.
 * @param {Record<string, any>} content lo guardado en la revisión (o el de ahora, en un borrador), con company
 * @param {{ number?: string | null, revision?: number, issued_on?: string | null, status?: string, draft?: boolean, void_reason?: string | null }} meta
 */
export function albaranView(content, meta) {
  const co = content.company ?? {};
  const companyName = co.name || COMPANY_FALLBACK;
  const missing = (/** @type {string | null | undefined} */ v, /** @type {string} */ what) => v || `[${what}: pendiente]`;
  const pending = (/** @type {string | null | undefined} */ v) => v || '[pendiente]';
  const cl = content.client;
  const meta2 = [
    ['Fecha de emisión', meta.draft ? 'Sin emitir' : formatDate(meta.issued_on)],
    ['Reserva', content.booking.reference],
    ...(meta.revision && meta.revision > 1 ? [['Revisión', String(meta.revision)]] : []),
    ['Pasajeros', String(content.passengers.length)],
  ];
  return {
    title: 'Albarán',
    number: meta.draft ? 'Sin número (borrador)' : meta.number,
    // Para la cabecera de las hojas siguientes y el título del PDF
    short: meta.draft ? `borrador de la reserva ${content.booking.reference}` : meta.number,
    stamp: meta.draft ? 'Borrador' : meta.status === 'anulado' ? 'Anulado' : null,
    fileName: albaranFileName({ number: meta.number, revision: meta.revision, draft: meta.draft, reference: content.booking.reference }),
    issuer: { name: companyName, lines: [`CIF: ${pending(co.taxId)}`, missing(co.address, 'dirección'), co.email].filter(Boolean) },
    client: { name: cl.name, lines: [`NIF/CIF: ${pending(cl.tax_id)}`, missing(cl.address, 'dirección fiscal'), cl.email].filter(Boolean) },
    meta: meta2,
    subject: content.booking.title,
    passengers: content.passengers.join(', '),
    groups: content.groups.map((/** @type {any} */ g) => {
      const k = LINE_KINDS[/** @type {keyof typeof LINE_KINDS} */ (g.kind)];
      return {
        label: k.label,
        subtotal: eur(g.subtotal_cents),
        rows: g.lines.map((/** @type {any} */ l) => ({
          concept: [l.supplier, l.description].filter(Boolean).join(' · ') || k.label,
          detail: lineDetail(g.kind, l),
          who: l.passengers.length ? `${k.who}: ${l.passengers.join(', ')}` : '',
          pvp: eur(l.pvp_cents),
        })),
      };
    }),
    total: eur(content.total_cents),
    note: 'Importes finales de cada servicio, impuestos incluidos. Este albarán no es una factura.',
    voided: meta.status === 'anulado' ? `Albarán anulado${meta.void_reason ? `: ${meta.void_reason}` : ''}.` : null,
    foot: `${companyName} · CIF ${pending(co.taxId)} · ${missing(co.address, 'dirección')}`,
  };
}
