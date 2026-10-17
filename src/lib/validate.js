// Validación de formularios con Zod. Mensajes pensados para quien usa la aplicación.
// No se "filtra" HTML al guardar: Astro escapa todo al mostrarlo.

import { z } from 'zod';
import { isDate } from './dates.js';
import { parseAmount, resolveAmounts, VAT_KEYS } from './money.js';
import { PAYMENT_METHODS } from './finance.js';

// Quita caracteres de control (salvo saltos de línea y tabuladores) y espacios sobrantes
const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : v);
const blankToNull = (v) => {
  const c = clean(v ?? '');
  return c === '' ? null : c;
};

const reqText = (label, min, max) => z.preprocess(
  (v) => clean(v ?? ''),
  z.string()
    .min(min, min <= 1 ? `${label}: es obligatorio` : `${label}: mínimo ${min} caracteres`)
    .max(max, `${label}: máximo ${max} caracteres`),
);
const optText = (label, max) => z.preprocess(blankToNull, z.string().max(max, `${label}: máximo ${max} caracteres`).nullable());
const optInt = (label, min, max) => z.preprocess(
  (v) => (blankToNull(v) === null ? null : Number(v)),
  z.number({ error: `${label}: tiene que ser un número` }).int(`${label}: sin decimales`)
    .min(min, `${label}: mínimo ${min}`).max(max, `${label}: máximo ${max}`).nullable(),
);
const optDate = (label) => z.preprocess(blankToNull, z.string().refine(isDate, `${label}: fecha no válida`).nullable());
const reqDate = (label) => z.preprocess((v) => clean(v ?? ''), z.string().refine(isDate, `${label}: elige una fecha`));
/** Importe opcional → céntimos (null si está vacío, NaN si no es un número: lo explica resolveAmounts) */
const amount = z.preprocess((v) => parseAmount(v), z.custom((v) => v === null || typeof v === 'number'));
const vat = z.enum(VAT_KEYS, { error: 'IVA: elige el tipo' });
const email = z.preprocess((v) => clean(v ?? '').toLowerCase(), z.email('Email no válido').max(200));
const optEmail = (label) => z.preprocess(blankToNull, z.email(`${label}: no es un email válido`).max(200).nullable());
const method = z.preprocess(blankToNull, z.enum(Object.keys(PAYMENT_METHODS), { error: 'Forma de pago no válida' }).nullable());

/** Añade base/total resueltos (o el error) a un esquema con base, total y vat */
const withAmounts = (schema, required = true) => schema.transform((d, ctx) => {
  if (!required && d.base === null && d.total === null) return { ...d, base: 0, total: 0 };
  const r = resolveAmounts(d);
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', path: ['base'], message: r.message });
    return z.NEVER;
  }
  return { ...d, base: r.base, total: r.total };
});

// Contraseña: longitud > complejidad (recomendación NIST). Se comprueba además contra filtraciones.
const newPassword = z.string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(128, 'La contraseña es demasiado larga');

// ── Acceso ─────────────────────────────────────────────────────────────────
export const LoginSchema = z.object({
  email,
  password: z.string().min(1, 'Escribe tu contraseña').max(128),
});

export const RegisterSchema = z.object({
  token: z.string().regex(/^inv_[A-Za-z0-9_-]{32}$/, 'El enlace de invitación no es válido'),
  name: reqText('Nombre', 2, 80),
  email,
  password: newPassword,
  password2: z.string(),
}).refine((d) => d.password === d.password2, { path: ['password2'], message: 'Las contraseñas no coinciden' });

export const AccountSchema = z.object({
  name: reqText('Nombre', 2, 80),
});

export const PasswordChangeSchema = z.object({
  current: z.string().min(1, 'Escribe tu contraseña actual').max(128),
  password: newPassword,
  password2: z.string(),
}).refine((d) => d.password === d.password2, { path: ['password2'], message: 'Las contraseñas no coinciden' });

export const ROLES = { admin: 'Administración', eventos: 'Gestión de eventos' };

export const InviteSchema = z.object({
  role: z.enum(Object.keys(ROLES), { error: 'Elige el tipo de cuenta' }),
  note: optText('Nota', 100),
  days: z.preprocess((v) => Number(v || 7), z.number().int().min(1).max(30)),
});

// ── Expediente ─────────────────────────────────────────────────────────────
export const ExpedienteSchema = z.object({
  name: reqText('Nombre del evento', 2, 140),
  company: reqText('Empresa', 2, 120),
  contact_name: optText('Contacto', 120),
  contact_email: optEmail('Email del contacto'),
  contact_phone: z.preprocess(blankToNull, z.string().regex(/^[+\d\s().-]{6,20}$/, 'Teléfono del contacto no válido').nullable()),
  destination: optText('Destino', 120),
  start_date: reqDate('Fecha de inicio'),
  end_date: optDate('Fecha de fin'),
  attendees: optInt('Asistentes', 0, 100000),
  notes: optText('Observaciones', 4000),
  manager_id: z.preprocess((v) => (blankToNull(v) === null ? null : Number(v)), z.number().int().positive().nullable()),
}).refine((d) => !d.end_date || d.end_date >= d.start_date, { path: ['end_date'], message: 'Fecha de fin: no puede ser anterior al inicio' });

export const NumberSchema = z.object({
  number: z.preprocess((v) => Number(clean(v ?? '')), z.number({ error: 'Número de expediente: escribe un número' })
    .int('Número de expediente: sin decimales').min(1, 'Número de expediente: tiene que ser mayor que 0').max(9_999_999)),
});

/** Presupuesto aprobado (cada versión) */
export const BudgetSchema = withAmounts(z.object({
  base: amount,
  total: amount,
  vat,
  note: optText('Nota', 300),
}));

/** Una fila de la previsión de pagos de la solicitud (hotel: 21.400 € antes del 29/01) */
export const ForecastRowSchema = withAmounts(z.object({
  supplier: reqText('Previsión: proveedor', 2, 120),
  concept: optText('Previsión: concepto', 160),
  due_date: optDate('Previsión: fecha límite'),
  base: z.preprocess(() => null, z.null()),
  total: amount,
  vat,
}));

// ── Proveedores ────────────────────────────────────────────────────────────
export const PaymentSchema = withAmounts(z.object({
  supplier: reqText('Proveedor', 2, 120),
  concept: optText('Concepto', 160),
  invoice_number: optText('Nº de factura', 60),
  invoice_date: optDate('Fecha de la factura'),
  base: amount,
  total: amount,
  vat,
  due_date: optDate('Fecha límite de pago'),
  status: z.enum(['pendiente', 'pagado']),
  paid_on: optDate('Fecha de pago'),
  method,
  notes: optText('Notas', 1000),
})).refine((d) => d.status !== 'pagado' || d.paid_on, { path: ['paid_on'], message: 'Fecha de pago: indica cuándo se pagó' });

export const PaySchema = z.object({
  paid_on: reqDate('Fecha de pago'),
  method,
});

// ── Cliente ────────────────────────────────────────────────────────────────
export const PoSchema = z.object({
  number: reqText('Nº de PO', 1, 60),
  billed_to: reqText('Cliente', 2, 120),
  amount: z.preprocess((v) => parseAmount(v), z.custom((v) => typeof v === 'number' && !Number.isNaN(v),
    'Importe: escribe el importe sin IVA con números, por ejemplo 13.922,20')),
  issued_on: optDate('Fecha de la PO'),
  notes: optText('Notas', 1000),
});

export const InvoiceSchema = withAmounts(z.object({
  billed_to: reqText('Cliente', 2, 120),
  concept: optText('Concepto', 200),
  base: amount,
  total: amount,
  vat,
  number: optText('Nº de factura', 60),
  issued_on: optDate('Fecha de emisión'),
  due_date: optDate('Vencimiento'),
  notes: optText('Notas', 1000),
}));

export const IssueSchema = z.object({
  number: reqText('Nº de factura', 1, 60),
  issued_on: reqDate('Fecha de emisión'),
  due_date: optDate('Vencimiento'),
});

export const CollectSchema = z.object({
  collected_on: reqDate('Fecha de cobro'),
});

export const NoteSchema = z.object({
  text: reqText('Nota', 1, 2000),
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Filas repetidas de un formulario (previsión de pagos): cada campo llega como lista
 * (name="fc_supplier", name="fc_total"…). Las filas vacías se ignoran.
 * @returns {{ ok: true, rows: any[] } | { ok: false, message: string }}
 */
export function parseRows(form, prefix, fields, schema, { max = 40, ignore = [] } = {}) {
  const cols = Object.fromEntries(fields.map((f) => [f, form.getAll(`${prefix}_${f}`).map((v) => String(v))]));
  const n = Math.max(0, ...Object.values(cols).map((c) => c.length));
  const rows = [];
  for (let i = 0; i < n; i++) {
    const raw = Object.fromEntries(fields.map((f) => [f, cols[f][i] ?? '']));
    if (fields.every((f) => ignore.includes(f) || raw[f].trim() === '')) continue; // fila vacía
    const r = schema.safeParse(raw);
    if (!r.success) return { ok: false, message: `Fila ${rows.length + 1}: ${r.error.issues[0]?.message ?? 'datos no válidos'}` };
    rows.push(r.data);
    if (rows.length > max) return { ok: false, message: `Máximo ${max} filas` };
  }
  return { ok: true, rows };
}

/** Pasa el FormData a objeto (sólo campos de texto; los ficheros se tratan aparte) */
export function formToObject(form) {
  const obj = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string' && !(key in obj)) obj[key] = value;
  }
  return obj;
}

/**
 * @returns {{ ok: true, data: any } | { ok: false, errors: Record<string,string>, message: string }}
 */
export function validate(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const errors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '_');
    errors[key] ??= issue.message;
  }
  return { ok: false, errors, message: Object.values(errors)[0] ?? 'Revisa los datos del formulario' };
}

/**
 * PO marcadas en el formulario de una factura y cuánto se factura de cada una.
 * @param poRows  PO del expediente con su saldo (summary.poRows)
 * @param current lo que esta misma factura ya tenía de cada PO (al editarla)
 * @returns {{ ok: true, rows: { po_id: number, amount: number }[] } | { ok: false, message: string }}
 */
export function parseAllocations(form, poRows, current = new Map()) {
  const ids = [...new Set(form.getAll('po_ids').map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const rows = [];
  for (const poId of ids) {
    const po = poRows.find((p) => p.id === poId);
    if (!po) return { ok: false, message: 'Una de las PO marcadas ya no existe.' };
    const available = po.left_cents + (current.get(poId) ?? 0);
    const raw = parseAmount(form.get(`po_amount_${poId}`));
    const amount = raw === null ? available : raw;
    if (Number.isNaN(amount) || amount <= 0) return { ok: false, message: `PO ${po.number}: escribe cuánto se factura de ella` };
    if (amount > available) {
      return { ok: false, message: `PO ${po.number}: sólo quedan ${(available / 100).toFixed(2).replace('.', ',')} € sin facturar` };
    }
    rows.push({ po_id: poId, amount });
  }
  return { ok: true, rows };
}
