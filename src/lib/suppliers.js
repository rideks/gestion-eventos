// Proveedores — reglas puras (sin base de datos): el nombre limpio y el volumen de negocio.
// Las consultas están en src/repos/suppliers.js y los casos de uso en src/services/suppliers.js.
// (Las facturas y proformas de cada pago están en supplier.js.)
//
// Cómo se calcula el volumen de negocio con un proveedor (siempre SIN IVA y sólo con expedientes
// no cancelados; no se guarda: sale de los pagos en cada consulta):
//   · Contratado  = Σ líneas de coste (importe positivo) del proveedor, previstas o con factura.
//   · Con factura = parte de lo contratado cuyas líneas tienen al menos una FACTURA (no proforma).
//   · Pagado      = parte de lo contratado ya pagada · Pendiente = la que falta por pagar.
//   · Abonos      = líneas negativas (abonos, comisiones del hotel, devoluciones): se muestran aparte.
//   · Año         = el del evento (fecha de inicio del expediente).
// Cada línea de coste cuenta una vez: no se suman los importes de los documentos del proveedor
// (una factura puede cubrir varios pagos y su total es opcional).

/** Nombre limpio: sin espacios sobrantes */
export const cleanName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ');

/**
 * Volumen de negocio a partir de las filas por expediente (los cancelados no cuentan).
 * Puro: se prueba en tests/suppliers.test.mjs.
 */
export function businessVolume(rows, year) {
  const live = rows.filter((r) => r.status !== 'cancelado');
  const sum = (list, f) => list.reduce((a, r) => a + (r[f] ?? 0), 0);
  const group = (key) => {
    const m = new Map();
    for (const r of live) {
      const k = key(r) || '—';
      const g = m.get(k) ?? { key: k, exps: 0, contracted: 0, paid: 0 };
      g.exps += 1;
      g.contracted += r.contracted;
      g.paid += r.paid;
      m.set(k, g);
    }
    return [...m.values()];
  };
  const byYear = group((r) => (r.start_date ?? '').slice(0, 4)).sort((a, b) => b.key.localeCompare(a.key));
  // Cambio respecto al año anterior (sólo si hay datos de ese año)
  for (const y of byYear) {
    const prev = byYear.find((p) => Number(p.key) === Number(y.key) - 1);
    y.change = prev && prev.contracted ? (y.contracted - prev.contracted) / prev.contracted : null;
  }
  const dates = live.map((r) => r.start_date).filter(Boolean).sort();
  const contracted = sum(live, 'contracted');
  return {
    exps: live.length,
    lines: sum(live, 'lines'),
    contracted,
    invoiced: sum(live, 'invoiced'),
    paid: sum(live, 'paid'),
    pending: sum(live, 'pending'),
    credits: sum(live, 'credits'),
    thisYear: sum(live.filter((r) => (r.start_date ?? '').startsWith(String(year))), 'contracted'),
    average: live.length ? Math.round(contracted / live.length) : 0,
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
    byYear,
    byClient: group((r) => r.company).sort((a, b) => b.contracted - a.contracted),
    byCity: group((r) => r.destination).sort((a, b) => b.contracted - a.contracted),
  };
}
