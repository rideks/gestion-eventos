// Facturas al cliente: el número (automático, correlativo y único), los datos del emisor y el envío.
//
// Número: sale de un formato configurable en Ajustes, p. ej. 'G/{n}/{yy}/01' → G/000904/26/01.
//   {n} el número de orden (6 cifras) · {yy} el año con 2 cifras · {yyyy} con 4.
//   Si el formato lleva el año, cada año empieza en 1 (una serie por año, como pide la normativa).
//   Se asigna al EMITIR (no al pedir la factura), así no quedan huecos por borradores que no se emiten.
//   Es único: además del contador, la base de datos no deja repetir un número (índice único).
//
// Envío al cliente: todavía SIMULADO (no sale ningún correo). Queda apuntado a quién, cuándo y quién.

import { activityStmt } from './app.js';
import { eur } from './money.js';
import { formatDate, nowIso, addDays } from './dates.js';
import { InvoiceSchema, EmitSchema, parseAllocations, validate } from './validate.js';
import { invoiceAmounts } from './vat.js';

export const DEFAULT_PATTERN = 'G/{n}/{yy}/01';
const DIGITS = 6;

/** ¿El formato lleva el año? (entonces la numeración vuelve a 1 cada año) */
export const yearly = (pattern) => /\{yy(yy)?\}/.test(pattern);

/** Problema del formato, o null si vale */
export function patternProblem(pattern) {
  const p = String(pattern ?? '').trim();
  if (!p) return 'Formato: escríbelo, por ejemplo G/{n}/{yy}/01';
  if (p.length > 40) return 'Formato: máximo 40 caracteres';
  if ((p.match(/\{n\}/g) ?? []).length !== 1) return 'Formato: tiene que llevar {n} (el número) una vez';
  if (/\{(?!n\}|yy\}|yyyy\})[^}]*\}/.test(p)) return 'Formato: sólo se puede usar {n}, {yy} y {yyyy}';
  return null;
}

/** 'G/{n}/{yy}/01' + 904 + 2026 → 'G/000904/26/01' */
export function formatInvoiceNumber(pattern, n, year) {
  return pattern
    .replaceAll('{n}', String(n).padStart(DIGITS, '0'))
    .replaceAll('{yyyy}', String(year))
    .replaceAll('{yy}', String(year).slice(-2));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** El número de orden de un nº de factura de esa serie (y ese año), o null si es de otra */
export function seqOf(pattern, number, year) {
  const re = pattern.split(/(\{n\}|\{yyyy\}|\{yy\})/).map((part) => {
    if (part === '{n}') return '(\\d+)';
    if (part === '{yyyy}') return String(year);
    if (part === '{yy}') return String(year).slice(-2);
    return escapeRe(part);
  }).join('');
  const m = new RegExp(`^${re}$`).exec(String(number ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * El siguiente número de orden: el guardado en Ajustes («próximo número») o, si ya hay facturas
 * de la serie por encima, el siguiente a la mayor.
 * @param numbers los nº de factura que ya existen
 */
export function nextSeq({ pattern, year, stored = null, numbers = [] }) {
  const used = numbers.map((n) => seqOf(pattern, n, year)).filter((n) => n !== null);
  const highest = used.length ? Math.max(...used) : 0;
  return Math.max(Number(stored) || 1, highest + 1);
}

/** La clave del contador en settings: uno por año si el formato lleva el año */
export const counterKey = (pattern, year) => (yearly(pattern) ? `invoice_next:${year}` : 'invoice_next');

/** Lee los ajustes de facturación (formato, emisor) */
export async function invoiceSettings(db) {
  const { results } = await db.prepare(
    "SELECT key, value FROM settings WHERE key = 'invoice_pattern' OR key LIKE 'company_%' OR key LIKE 'invoice_next%'",
  ).all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    pattern: s.invoice_pattern || DEFAULT_PATTERN,
    counters: Object.fromEntries(results.filter((r) => r.key.startsWith('invoice_next')).map((r) => [r.key, r.value])),
    company: {
      name: s.company_legal_name || '',
      taxId: s.company_tax_id || '',
      address: s.company_address || '',
      iban: s.company_iban || '',
      email: s.company_email || '',
    },
  };
}

/** El próximo nº de factura de un año (sin reservarlo): para enseñarlo antes de emitir */
export async function peekInvoiceNumber(db, year) {
  const [settings, { results }] = await Promise.all([
    invoiceSettings(db),
    db.prepare('SELECT number FROM invoices WHERE number IS NOT NULL').all(),
  ]);
  const { pattern } = settings;
  const key = counterKey(pattern, year);
  const seq = nextSeq({ pattern, year, stored: settings.counters[key], numbers: results.map((r) => r.number) });
  return { pattern, key, seq, number: formatInvoiceNumber(pattern, seq, year) };
}

const isUniqueClash = (err) => /UNIQUE constraint failed/i.test(String(err?.message ?? err));

/**
 * Emite una factura: le asigna el siguiente número de la serie, la fecha y la deja «emitida».
 * Si a la vez otra persona ha cogido ese número, se reintenta con el siguiente.
 * @param extra sentencias que van en la misma transacción (actividad…), en función del número
 * @returns {Promise<string>} el número asignado
 */
export async function issueInvoice({ db, invoiceId, issuedOn, dueDate, extra = () => [] }) {
  const year = Number(String(issuedOn).slice(0, 4));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { key, seq, number } = await peekInvoiceNumber(db, year);
    try {
      await db.batch([
        db.prepare(
          "UPDATE invoices SET number = ?, status = 'emitida', issued_on = ?, due_date = ?, updated_at = ? WHERE id = ? AND status = 'por_emitir'",
        ).bind(number, issuedOn, dueDate, nowIso(), invoiceId),
        db.prepare(
          `INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
        ).bind(key, String(seq + 1)),
        ...extra(number),
      ]);
      return number;
    } catch (err) {
      if (!isUniqueClash(err)) throw err;
    }
  }
  throw new Error('No se ha podido asignar un número de factura libre. Inténtalo otra vez.');
}

/** Correo con la factura (de momento sólo se enseña: el envío es simulado) */
export function invoiceEmail(inv, company, poNumbers = '') {
  const name = company.name || 'Seven Worlds';
  return {
    subject: `Factura ${inv.number} · ${name}`,
    body: [
      'Hola:',
      '',
      `Adjuntamos la factura ${inv.number} del ${formatDate(inv.issued_on)} por ${eur(inv.total_cents)}${inv.concept ? `, correspondiente a «${inv.concept.split('\n')[0]}»` : ''}${poNumbers ? ` (PO ${poNumbers})` : ''}.`,
      inv.due_date ? `Vencimiento: ${formatDate(inv.due_date)}.${company.iban ? ` Forma de pago: transferencia a ${company.iban}.` : ''}` : '',
      '',
      'Un saludo,',
      name,
    ].filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n'),
  };
}

/** Apunta el envío (simulado) de la factura al cliente */
export async function markSent({ db, who, inv, to }) {
  const at = nowIso();
  await db.batch([
    db.prepare('UPDATE invoices SET sent_at = ?, sent_to = ?, sent_by = ?, updated_at = ? WHERE id = ?').bind(at, to, who.user.id, at, inv.id),
    activityStmt(db, who, inv.expediente_id, 'invoice.send',
      `${inv.sent_at ? 'reenvió' : 'envió'} la factura ${inv.number} a ${to} (${eur(inv.total_cents)}) · envío simulado, no sale ningún correo`),
  ]);
}

/** Días hasta el vencimiento que se proponen al emitir */
export const DUE_DAYS = 30;

/**
 * Lee y comprueba el formulario de una factura al cliente.
 * mode: 'draft' (borrador o pedida), 'emit' (además, lo que exige una factura: NIF, dirección,
 * concepto y fecha) o 'send' (emitir y enviar: además, el email de facturación).
 */
export function readInvoiceForm({ form, input, poRows, rates, allocated = new Map(), mode = 'draft', today }) {
  const alloc = parseAllocations(form, poRows, allocated);
  if (!alloc.ok) return { ok: false, message: alloc.message, errors: {} };
  const parsed = validate(InvoiceSchema, input);
  if (!parsed.ok) return parsed;
  const amounts = invoiceAmounts(form, rates, alloc.rows);
  if (!amounts.ok) return { ok: false, message: amounts.message, errors: { amount: amounts.message } };
  let d = parsed.data;
  if (mode !== 'draft') {
    const e = validate(EmitSchema, { ...input, issued_on: input.issued_on || today });
    if (!e.ok) return { ok: false, message: `Para emitirla: ${e.message}`, errors: e.errors };
    d = { ...d, issued_on: e.data.issued_on, due_date: d.due_date ?? addDays(e.data.issued_on, DUE_DAYS) };
    if (mode === 'send' && !d.billed_email) {
      const message = 'Para enviarla: escribe el email de facturación del cliente.';
      return { ok: false, message, errors: { billed_email: message } };
    }
  }
  return { ok: true, data: { ...d, base: amounts.base, total: amounts.total }, amounts, alloc };
}

/** Columnas de la factura que salen del formulario (para INSERT y UPDATE) */
export function invoiceValues(d, amounts) {
  return [d.billed_to, d.billed_tax_id, d.billed_address, d.billed_email, d.concept, d.base, d.total, amounts.vat,
    JSON.stringify(amounts.lines), d.due_date, d.notes];
}
export const INVOICE_FIELDS = 'billed_to, billed_tax_id, billed_address, billed_email, concept, base_cents, total_cents, vat, vat_lines, due_date, notes';
