// Tipos de IVA (centralizados en la tabla vat_rates) y desglose de un importe por tipos.
//
// Un importe puede tener varias líneas, una por tipo (hotel al 10 % + servicios al 21 %):
//   [{ rate: 1000, label: 'IVA 10 %', base: 82145, total: 90360 }, { rate: 2100, … }]
// El tipo va en puntos básicos (21 % → 2100, 9,5 % → 950): cálculos exactos con enteros.
// rate: null = «Otro»: se escriben a mano la base y el total (redondeos raros, facturas antiguas).

import { parseAmount } from './money.js';

/** Valor del desplegable para «Otro (escribir los dos importes)» */
export const MANUAL = 'manual';

/** 2100 → '21' · 950 → '9,5' */
export const pctText = (bp) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(bp / 100);

/** Base sin IVA → total con IVA (redondeo al céntimo) */
export const totalFromBaseBp = (base, bp) => Math.round((base * (10000 + bp)) / 10000);

/** Total con IVA → base sin IVA */
export const baseFromTotalBp = (total, bp) => Math.round((total * 10000) / (10000 + bp));

/**
 * Tipos de la lista, el de por defecto primero. La consulta está en src/repos/rates.js; se re-exporta aquí
 * para las páginas que aún no están en capas.
 */
export { list as loadRates } from '../repos/rates.js';

/** El tipo de por defecto */
export const defaultRate = (rates) => rates.find((r) => r.is_default)?.rate_bp ?? rates[0]?.rate_bp ?? 2100;

/** Nombre de un tipo: el de la lista si está; si no, '21 %' */
export function rateLabel(bp, rates = []) {
  if (bp === null || bp === undefined) return 'Otro tipo';
  return rates.find((r) => r.rate_bp === bp)?.label ?? `${pctText(bp)} %`;
}

/**
 * Completa una línea: con un tipo de la lista basta uno de los dos importes;
 * si se escriben los dos (copiados de la factura, con sus redondeos) se respetan.
 * @param {{ base: number|null, total: number|null, rate: number|null }} line  importes en céntimos (o NaN)
 * @returns {{ ok: true, base: number, total: number } | { ok: false, message: string }}
 */
export function resolveLine({ base, total, rate }) {
  if (Number.isNaN(base) || Number.isNaN(total)) {
    return { ok: false, message: 'escribe el importe con números, por ejemplo 21.400 o 1983,47' };
  }
  if (base === null && total === null) return { ok: false, message: 'escribe el importe sin IVA o con IVA' };
  if (rate === null && (base === null || total === null)) {
    return { ok: false, message: 'con «Otro tipo» escribe el importe sin IVA y el importe con IVA' };
  }
  const b = base ?? baseFromTotalBp(total, rate);
  const t = total ?? totalFromBaseBp(base, rate);
  if ((b < 0 && t > 0) || (b > 0 && t < 0)) {
    return { ok: false, message: 'sin IVA y con IVA tienen que tener el mismo signo (en negativo para abonos)' };
  }
  return { ok: true, base: b, total: t };
}

/** Valor del desplegable → puntos básicos (null = «Otro»; undefined = no válido) */
export function parseRate(value) {
  const v = String(value ?? '').trim();
  if (v === MANUAL) return null;
  const n = Number(v);
  return v !== '' && Number.isInteger(n) && n >= 0 && n <= 10000 ? n : undefined;
}

/** Columna resumen `vat`: '21' si hay un único tipo; 'mixto' si hay varios o es a mano */
export const vatColumn = (lines) => (lines.length === 1 && lines[0].rate !== null ? String(lines[0].rate / 100) : 'mixto');

/**
 * Lee las líneas de IVA de un formulario (name="vl_base", "vl_rate", "vl_total"; una por fila).
 * Las filas sin importes se ignoran.
 * @returns {{ ok: true, lines: any[], base: number, total: number, vat: string } | { ok: false, message: string }}
 */
export function parseVatLines(form, rates, { prefix = 'vl', required = true, max = 12 } = {}) {
  const col = (f) => (form ? form.getAll(`${prefix}_${f}`).map(String) : []);
  const bases = col('base');
  const rateValues = col('rate');
  const totals = col('total');
  const rows = Math.max(bases.length, totals.length);
  const lines = [];
  for (let i = 0; i < rows; i++) {
    const base = parseAmount(bases[i]);
    const total = parseAmount(totals[i]);
    if (base === null && total === null) continue;
    const where = rows > 1 ? `Importe (línea ${lines.length + 1})` : 'Importe';
    const rate = parseRate(rateValues[i]);
    if (rate === undefined) return { ok: false, message: `${where}: elige el tipo de IVA` };
    const r = resolveLine({ base, total, rate });
    if (!r.ok) return { ok: false, message: `${where}: ${r.message}` };
    lines.push({ rate, label: rateLabel(rate, rates), base: r.base, total: r.total });
  }
  if (lines.length > max) return { ok: false, message: `Importe: máximo ${max} tipos de IVA` };
  if (!lines.length && required) return { ok: false, message: 'Importe: escribe el importe sin IVA o con IVA' };
  const base = lines.reduce((a, l) => a + l.base, 0);
  const total = lines.reduce((a, l) => a + l.total, 0);
  return { ok: true, lines, base, total, vat: lines.length ? vatColumn(lines) : String(defaultRate(rates) / 100) };
}

/** Lo que se escribió en el formulario, para volver a pintarlo tal cual si hay un error */
export function rawVatLines(form, prefix = 'vl') {
  if (!form) return [];
  const bases = form.getAll(`${prefix}_base`).map(String);
  const rates = form.getAll(`${prefix}_rate`).map(String);
  const totals = form.getAll(`${prefix}_total`).map(String);
  return bases.map((base, i) => ({ base, rate: rates[i] ?? '', total: totals[i] ?? '' }))
    .filter((l) => l.base.trim() || l.total.trim());
}

/** Desglose guardado de una fila (budgets, payments, invoices). Las antiguas sin desglose → una línea. */
export function linesOf(row) {
  try {
    const parsed = JSON.parse(row?.vat_lines ?? '');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* sin desglose */ }
  const v = row?.vat;
  const bp = v && v !== 'mixto' && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : null;
  return [{ rate: bp, label: bp === null ? 'Varios tipos' : `IVA ${pctText(bp)} %`, base: row?.base_cents ?? 0, total: row?.total_cents ?? 0 }];
}

/** 'IVA 10 % + IVA 21 %' */
export const linesSummary = (lines) => lines.map((l) => l.label).join(' + ');

/** Importe de una sola línea con el tipo por defecto (p. ej. una factura sin importe: la suma de sus PO) */
export function defaultLine(base, rates) {
  const rate = defaultRate(rates);
  const lines = [{ rate, label: rateLabel(rate, rates), base, total: totalFromBaseBp(base, rate) }];
  return { ok: true, lines, base, total: lines[0].total, vat: vatColumn(lines) };
}

/**
 * Importe de una factura al cliente: lo escrito o, si no hay nada escrito,
 * la suma de las PO marcadas con el tipo por defecto.
 */
export function invoiceAmounts(form, rates, allocations = []) {
  const amounts = parseVatLines(form, rates, { required: false });
  if (!amounts.ok || amounts.lines.length) return amounts;
  const sum = allocations.reduce((a, r) => a + r.amount, 0);
  return allocations.length ? defaultLine(sum, rates) : { ok: false, message: 'Importe: escribe el importe sin IVA o con IVA (o marca las PO que cubre)' };
}

/**
 * Reparte un importe sin IVA entre los tipos de IVA de un desglose, en la misma proporción (p. ej. lo que
 * falta por facturar, con los tipos del presupuesto). Cuadra al céntimo: la última línea se lleva el resto.
 */
export function splitLikeLines(lines, base) {
  const whole = lines.reduce((a, l) => a + l.base, 0);
  if (!whole || base <= 0) return [];
  let done = 0;
  return lines
    .map((l, i) => {
      const b = i === lines.length - 1 ? base - done : Math.round((base * l.base) / whole);
      done += b;
      return { rate: l.rate, base: b, total: l.rate != null ? totalFromBaseBp(b, l.rate) : Math.round((l.total * b) / (l.base || 1)) };
    })
    .filter((l) => l.base !== 0);
}
