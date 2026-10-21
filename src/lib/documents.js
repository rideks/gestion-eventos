// Documentos al cliente (facturas y albaranes): el formato de su número y los datos del emisor. Lógica pura.
//
// Formato del número: un texto con {n} (el número de orden, 6 cifras), {yy} (el año con 2 cifras) y {yyyy} (con 4).
//   'G/{n}/{yy}/01' → G/000904/26/01 · 'ALB-{yyyy}-{n}' → ALB-2026-000001
//   Si el formato lleva el año, cada año empieza en 1 (una serie por año).

const DIGITS = 6;

/** ¿El formato lleva el año? (entonces la numeración vuelve a 1 cada año) */
export const yearly = (pattern) => /\{yy(yy)?\}/.test(pattern);

/** Problema del formato, o null si vale. example: el que se propone en el mensaje */
export function patternProblem(pattern, example = 'G/{n}/{yy}/01') {
  const p = String(pattern ?? '').trim();
  if (!p) return `Formato: escríbelo, por ejemplo ${example}`;
  if (p.length > 40) return 'Formato: máximo 40 caracteres';
  if ((p.match(/\{n\}/g) ?? []).length !== 1) return 'Formato: tiene que llevar {n} (el número) una vez';
  if (/\{(?!n\}|yy\}|yyyy\})[^}]*\}/.test(p)) return 'Formato: sólo se puede usar {n}, {yy} y {yyyy}';
  return null;
}

/** El formato con el año ya puesto: 'ALB-{yyyy}-{n}' + 2026 → 'ALB-2026-{n}' */
const withYear = (pattern, year) => pattern.replaceAll('{yyyy}', String(year)).replaceAll('{yy}', String(year).slice(-2));

/** 'G/{n}/{yy}/01' + 904 + 2026 → 'G/000904/26/01' */
export const formatNumber = (pattern, n, year) => withYear(pattern, year).replaceAll('{n}', String(n).padStart(DIGITS, '0'));

/**
 * Lo que va antes y después del número de orden (para componer el número dentro de una sentencia SQL):
 * 'ALB-{yyyy}-{n}' + 2026 → { prefix: 'ALB-2026-', suffix: '', digits: 6 }
 */
export function numberParts(pattern, year) {
  const [prefix, suffix = ''] = withYear(pattern, year).split('{n}');
  return { prefix, suffix, digits: DIGITS };
}

/** Nombre de la empresa si en Ajustes no hay razón social */
export const COMPANY_FALLBACK = 'Seven Worlds Events & Congresses';

/**
 * Los datos del emisor guardados en Ajustes (claves company_*)
 * @param {Record<string, string | null | undefined>} s
 */
export const companyFrom = (s) => ({
  name: s.company_legal_name || '',
  taxId: s.company_tax_id || '',
  address: s.company_address || '',
  iban: s.company_iban || '',
  email: s.company_email || '',
});
