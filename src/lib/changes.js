// Qué ha cambiado entre dos versiones de una ficha (para el historial común, change_log).

/**
 * fields: { campo: { label, format?: (valor) => texto, show?: false } }
 *   show: false → en el resumen sólo sale el nombre del campo (textos largos), no los valores.
 * @param {Record<string, any>} before
 * @param {Record<string, any>} after
 * @param {Record<string, { label: string, format?: (v: any) => string | null, show?: boolean }>} fields
 * @returns {{ changes: Record<string, [any, any]>, summary: string }} summary: «Fee: 8 % → 10 % · Acuerdo de pago»
 */
export function diffFields(before, after, fields) {
  /** @type {Record<string, [any, any]>} */
  const changes = {};
  const parts = [];
  for (const [key, { label, format = (v) => String(v), show = true }] of Object.entries(fields)) {
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    if (a === b) continue;
    changes[key] = [a, b];
    parts.push(show ? `${label}: ${a === null ? 'sin dato' : format(a)} → ${b === null ? 'sin dato' : format(b)}` : label);
  }
  return { changes, summary: parts.join(' · ') };
}
