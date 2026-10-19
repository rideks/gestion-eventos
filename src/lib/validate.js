// Validación de formularios con Zod. Mensajes pensados para quien usa la aplicación.
// No se "filtra" HTML al guardar: Astro escapa todo al mostrarlo.

import { z } from 'zod';
import { isDate } from './dates.js';
import { parseAmount } from './money.js';
import { parseRate, rateLabel, vatColumn, baseFromTotalBp } from './vat.js';
import { PAYMENT_METHODS, DOC_KINDS } from './finance.js';

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
const email = z.preprocess((v) => clean(v ?? '').toLowerCase(), z.email('Email no válido').max(200));
const optEmail = (label) => z.preprocess(blankToNull, z.email(`${label}: no es un email válido`).max(200).nullable());
const method = z.preprocess(blankToNull, z.enum(Object.keys(PAYMENT_METHODS), { error: 'Forma de pago no válida' }).nullable());

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

// El rol se comprueba además contra la base de datos (roles)
const roleId = z.preprocess((v) => Number(v), z.number({ error: 'Elige el rol' }).int('Elige el rol').positive('Elige el rol'));

export const InviteSchema = z.object({
  role_id: roleId,
  note: optText('Nota', 100),
  days: z.preprocess((v) => Number(v || 7), z.number().int().min(1).max(30)),
});

export const UserRoleSchema = z.object({ role_id: roleId });

// ── Proveedores ────────────────────────────────────────────────────────────
export const SUPPLIER_STATUS = { activo: 'Activo', inactivo: 'Inactivo', bloqueado: 'No contratar' };

export const SupplierSchema = z.object({
  name: reqText('Nombre del proveedor', 2, 120),
  type_id: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().positive().nullable()),
  status: z.enum(Object.keys(SUPPLIER_STATUS), { error: 'Elige el estado' }),
  city: optText('Ciudad', 80),
  address: optText('Dirección', 200),
  contact_name: optText('Persona de contacto', 120),
  phone: z.preprocess(blankToNull, z.string().regex(/^[+\d\s().-]{6,20}$/, 'Teléfono no válido').nullable()),
  email: optEmail('Email'),
  max_capacity: optInt('Capacidad máxima', 1, 100000),
  since_on: optDate('Inicio de la relación'),
  economic_terms: optText('Condiciones económicas', 2000),
  payment_terms: optText('Condiciones de crédito y pago', 1000),
  notes: optText('Comentarios internos', 2000),
});

// Alta rápida desde el selector de un pago: lo básico (el resto, en su ficha)
export const SupplierQuickSchema = SupplierSchema.pick({ name: true, type_id: true, city: true });

export const SupplierTypeSchema = z.object({ type_name: reqText('Tipo de proveedor', 2, 40) });

// Contrato o acuerdo con un proveedor. alert_days: avisar esos días antes de que caduque (vacío: sin aviso)
export const ContractSchema = z.object({
  title: reqText('Nombre del contrato', 2, 120),
  signed_on: optDate('Fecha de firma'),
  starts_on: reqDate('Fecha de inicio'),
  ends_on: optDate('Fecha de fin'),
  conditions: optText('Condiciones', 4000),
  rates: optText('Tarifas', 4000),
  discounts: optText('Descuentos y condiciones especiales', 2000),
  credit_terms: optText('Condiciones de crédito', 2000),
  payment_terms: optText('Condiciones de pago', 2000),
  other_terms: optText('Otros acuerdos', 2000),
  notes: optText('Comentarios', 2000),
  alert_days: optInt('Aviso', 1, 730),
}).refine((d) => !d.ends_on || d.ends_on >= d.starts_on, { path: ['ends_on'], message: 'Fecha de fin: no puede ser anterior al inicio' })
  // Sin fecha de fin no hay nada de lo que avisar
  .transform((d) => (d.ends_on ? d : { ...d, alert_days: null }));

export const RenewalSchema = z.object({ renewal: z.preprocess(blankToNull, z.enum(['pendiente', 'no']).nullable()) });

// Porcentaje escrito como en el Excel ('10', '7,5', '12 %') → puntos básicos (10 % → 1000); vacío → null
const optPercentBp = (label) => z.preprocess(
  (v) => {
    const c = blankToNull(v);
    if (c === null) return null;
    const n = Number(String(c).replace('%', '').replace(',', '.').trim());
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  },
  z.number({ error: `${label}: escríbelo como un porcentaje, por ejemplo 10 o 7,5` })
    .min(0, `${label}: entre 0 y 100 %`).max(10000, `${label}: entre 0 y 100 %`).nullable(),
);
const taxId = z.preprocess((v) => (blankToNull(v) === null ? null : String(clean(v)).toUpperCase().replace(/[\s.]/g, '')),
  z.string().regex(/^[A-Z0-9-]{5,15}$/, 'NIF: letras y números (p. ej. B12345678)').nullable());

// ── Clientes ───────────────────────────────────────────────────────────────
export const CLIENT_STATUS = { activo: 'Activo', inactivo: 'Inactivo' };
export const CLIENT_KINDS = { empresa: 'Empresa', persona: 'Persona' };
// Tratamiento (Dr. / Dra.) de una persona: cliente particular o pasajero
const personTitle = z.preprocess(blankToNull, z.enum(['Dr.', 'Dra.'], { error: 'Tratamiento: Dr., Dra. o sin tratamiento' }).nullable());
const phone = z.preprocess(blankToNull, z.string().regex(/^[+\d\s().-]{6,20}$/, 'Teléfono no válido').nullable());

export const ClientSchema = z.object({
  name: reqText('Nombre del cliente', 2, 120),
  status: z.enum(Object.keys(CLIENT_STATUS), { error: 'Elige el estado' }),
  kind: z.preprocess((v) => blankToNull(v) ?? 'empresa', z.enum(Object.keys(CLIENT_KINDS), { error: 'Tipo: empresa o persona' })),
  title: personTitle,
  legal_name: optText('Nombre fiscal', 160),
  tax_id: taxId,
  fiscal_address: optText('Dirección fiscal', 300),
  city: optText('Ciudad', 80),
  phone: z.preprocess(blankToNull, z.string().regex(/^[+\d\s().-]{6,20}$/, 'Teléfono no válido').nullable()),
  email: optEmail('Email'),
  billing_email: optEmail('Email de facturación'),
  payment_terms: optText('Acuerdo de pago', 1000),
  fee: optPercentBp('Fee'),
  since_on: optDate('Inicio de la relación'),
  notes: optText('Comentarios internos', 2000),
}).transform((d) => (d.kind === 'empresa' ? { ...d, title: null } : d)); // una empresa no lleva tratamiento

// Alta rápida desde el selector de una solicitud: lo básico (el resto, en su ficha)
export const ClientQuickSchema = z.object({ name: reqText('Nombre del cliente', 2, 120), city: optText('Ciudad', 80) });

// Otra entidad a la que se factura (p. ej. un concesionario de BMW)
export const ClientEntitySchema = z.object({
  legal_name: reqText('Nombre fiscal', 2, 160),
  tax_id: taxId,
  fiscal_address: optText('Dirección fiscal', 300),
  email: optEmail('Email de facturación'),
});

// Fee aplicado a un expediente (se copia del cliente al pedirlo; se puede ajustar en ese expediente)
export const ExpedienteFeeSchema = z.object({ fee: optPercentBp('Fee del expediente') });

// ── Business Travel ────────────────────────────────────────────────────────
export const BtBookingSchema = z.object({
  title: optText('Descripción', 140),
  notes: optText('Comentarios internos', 2000),
});

export const BtPassengerSchema = z.object({
  title: personTitle,
  first_name: reqText('Nombre', 1, 80),
  last_name: reqText('Apellidos', 1, 120),
  email: optEmail('Email'),
  phone,
  notes: optText('Datos adicionales', 500),
});

/**
 * Datos de un servicio de una reserva (los importes se leen aparte: parseLineAmounts en src/lib/travel.js).
 * labels/required: los de su bloque (LINE_KINDS en src/lib/travel.js).
 */
export const btLineSchema = (labels, required = []) => z.object({
  description: optText(labels.description ?? 'Descripción', 200),
  start_date: optDate(labels.start_date ?? 'Fecha'),
  end_date: optDate(labels.end_date ?? 'Fecha de fin'),
  locator: optText(labels.locator ?? 'Referencia', 60),
  issued_on: optDate(labels.issued_on ?? 'Fecha de emisión'),
  details: optText(labels.details ?? 'Información adicional', 1000),
}).superRefine((d, ctx) => {
  for (const f of required) {
    if (!d[f]) ctx.addIssue({ code: 'custom', path: [f], message: `${labels[f]}: ${f.endsWith('date') ? 'elige una fecha' : 'escríbelo'}` });
  }
  if (d.start_date && d.end_date && d.end_date < d.start_date) {
    ctx.addIssue({ code: 'custom', path: ['end_date'], message: `${labels.end_date}: no puede ser anterior a ${labels.start_date.toLowerCase()}` });
  }
});

export const RoleSchema = z.object({
  name: reqText('Nombre del rol', 2, 40),
  description: optText('Descripción', 160),
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

// Los importes (con su desglose por tipos de IVA) se leen aparte: parseVatLines en src/lib/vat.js

/** Presupuesto aprobado (cada versión) */
export const BudgetSchema = z.object({
  note: optText('Nota', 300),
});

/**
 * Una fila de pagos previstos (hotel: 21.400 € IVA incluido antes del 29/01).
 * Se escribe el importe con IVA y su tipo; la base se calcula.
 */
// El proveedor de cada fila se elige de la lista: supplier_id (con JavaScript) o su nombre exacto
const supplierId = z.preprocess((v) => (blankToNull(v) === null ? null : Number(v)), z.number().int().positive().nullable().catch(null));

export const forecastRowSchema = (rates) => z.object({
  supplier: reqText('Proveedor', 2, 120),
  supplier_id: supplierId,
  concept: optText('Concepto', 160),
  due_date: optDate('Fecha límite'),
  total: z.preprocess((v) => parseAmount(v), z.custom((v) => typeof v === 'number' && !Number.isNaN(v),
    'Importe: escríbelo con números, por ejemplo 21.400')),
  rate: z.preprocess((v) => parseRate(v), z.custom((v) => typeof v === 'number', 'IVA: elige el tipo')),
}).transform((d) => {
  const base = baseFromTotalBp(d.total, d.rate);
  const lines = [{ rate: d.rate, label: rateLabel(d.rate, rates), base, total: d.total }];
  return { ...d, base, lines, vat: vatColumn(lines) };
});

// ── Proveedores ────────────────────────────────────────────────────────────
export const PaymentSchema = z.object({
  supplier: reqText('Proveedor', 2, 120),
  supplier_id: supplierId,
  concept: optText('Concepto', 160),
  due_date: optDate('Fecha límite de pago'),
  status: z.enum(['pendiente', 'pagado']),
  paid_on: optDate('Fecha de pago'),
  method,
  notes: optText('Notas', 1000),
}).refine((d) => d.status !== 'pagado' || d.paid_on, { path: ['paid_on'], message: 'Fecha de pago: indica cuándo se pagó' });

/**
 * Documento de un proveedor: si es factura o proforma y lo que se anota de él.
 * El tipo se comprueba en cada pantalla (en el alta de un pago, el documento es opcional).
 * comment: por qué se sube (obligatorio si ya hay una factura conforme y se sube otra).
 */
export const SupplierDocSchema = z.object({
  doc_kind: z.preprocess(blankToNull, z.enum(Object.keys(DOC_KINDS), { error: 'Tipo de documento: factura o proforma' }).nullable()),
  invoice_number: optText('Nº del documento', 60),
  invoice_date: optDate('Fecha del documento'),
  invoice_total: z.preprocess((v) => parseAmount(v), z.custom((v) => v === null || (typeof v === 'number' && !Number.isNaN(v)),
    'Total del documento: escríbelo con números, por ejemplo 50.000 o 3303,60')),
  doc_comment: optText('Comentario', 500),
}).transform((d) => ({ kind: d.doc_kind, number: d.invoice_number, issued_on: d.invoice_date, total: d.invoice_total, comment: d.doc_comment }));

/** Administración la da por buena: el número es obligatorio */
export const ConformSchema = z.object({
  invoice_number: reqText('Nº de factura', 1, 60),
  invoice_date: optDate('Fecha de la factura'),
}).transform((d) => ({ number: d.invoice_number, issued_on: d.invoice_date }));

export const PaySchema = z.object({
  paid_on: reqDate('Fecha de pago'),
  method: z.enum(Object.keys(PAYMENT_METHODS), { error: 'Forma de pago: elige cómo se ha pagado' }),
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

/**
 * Factura al cliente (borrador o pedida). El número no se escribe: se asigna al emitirla.
 * billed_*: los datos fiscales del cliente que salen en la factura y el email al que se envía.
 */
export const InvoiceSchema = z.object({
  billed_to: reqText('Cliente', 2, 120),
  billed_tax_id: optText('NIF/CIF del cliente', 20),
  billed_address: optText('Dirección fiscal', 300),
  billed_email: optEmail('Email de facturación'),
  concept: optText('Concepto', 500),
  issued_on: optDate('Fecha de emisión'),
  due_date: optDate('Vencimiento'),
  notes: optText('Notas', 1000),
});

/** Para emitirla hacen falta los datos que exige una factura (además del importe) */
export const EmitSchema = z.object({
  billed_tax_id: reqText('NIF/CIF del cliente', 5, 20),
  billed_address: reqText('Dirección fiscal del cliente', 5, 300),
  concept: reqText('Concepto (lo que se factura)', 3, 500),
  issued_on: reqDate('Fecha de emisión'),
  due_date: optDate('Vencimiento'),
});

/** Envío al cliente (simulado) */
export const SendSchema = z.object({
  sent_to: z.preprocess((v) => clean(v ?? '').toLowerCase(), z.email('Email de facturación: no es un email válido').max(200)),
});

/** Ajustes de facturación: formato del número, próximo número y datos del emisor */
export const InvoiceSettingsSchema = z.object({
  invoice_pattern: reqText('Formato', 3, 40),
  invoice_next: z.preprocess((v) => Number(clean(v ?? '')), z.number({ error: 'Próximo número: escribe un número' })
    .int('Próximo número: sin decimales').min(1, 'Próximo número: mayor que 0').max(999_999, 'Próximo número: como mucho 999999')),
  company_legal_name: optText('Razón social', 120),
  company_tax_id: optText('CIF', 20),
  company_address: optText('Dirección', 300),
  company_iban: optText('IBAN', 40),
  company_email: optEmail('Email de facturación'),
});

/** Un tipo de IVA nuevo (Ajustes) */
export const VatRateSchema = z.object({
  label: reqText('Nombre', 2, 40),
  rate: z.preprocess((v) => {
    const n = Number(String(v ?? '').trim().replace(',', '.').replace(/\s*%$/, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
  }, z.number({ error: 'Porcentaje: escribe un número, por ejemplo 21 o 9,5' }).int().min(0, 'Porcentaje: mínimo 0').max(10000, 'Porcentaje: máximo 100')),
});

export const FirstNumberSchema = z.object({
  first_number: z.preprocess((v) => Number(clean(v ?? '')), z.number({ error: 'Primer número: escribe un número' })
    .int('Primer número: sin decimales').min(1, 'Primer número: mayor que 0').max(9_999_999)),
});

export const CollectSchema = z.object({
  collected_on: reqDate('Fecha de cobro'),
});

export const PoCloseSchema = z.object({
  closed_note: optText('Motivo', 300),
});

export const NoteSchema = z.object({
  text: reqText('Nota', 1, 2000),
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Filas repetidas de un formulario (previsión de pagos): cada campo llega como lista
 * (name="fc_supplier", name="fc_total"…). Las filas vacías se ignoran.
 * @param {FormData} form
 * @param {string} prefix
 * @param {string[]} fields
 * @param {any} schema
 * @param {{ max?: number, ignore?: string[] }} [options] ignore: campos que no cuentan para saber si una fila está vacía
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
    if (po.closed && !current.has(poId)) return { ok: false, message: `La PO ${po.number} está cerrada: reábrela para facturar de ella.` };
    const available = po.billable_cents + (current.get(poId) ?? 0);
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
