// Clientes — reglas puras (sin base de datos): antigüedad, fee, etapa de cada expediente y volumen de negocio.
// Las consultas están en src/repos/clients.js y los casos de uso en src/services/clients.js.
//
// Cómo se calcula la relación económica con un cliente (nada se apunta a mano; sale de sus expedientes,
// y los cancelados no cuentan):
//   · Presupuestado  = Σ de la versión vigente del presupuesto de cada expediente (SIN IVA): el volumen contratado.
//   · Facturado      = Σ facturas emitidas o cobradas, sin anular (SIN IVA).
//   · Cobrado        = Σ facturas cobradas (CON IVA: lo que ha entrado en el banco).
//   · Pendiente      = Σ facturas emitidas y aún no cobradas (CON IVA).
//   · Año            = el del evento (fecha de inicio del expediente).
// Ni lo facturado es beneficio ni lo pendiente está cobrado: se enseñan por separado y con su IVA indicado.
import { isDate } from './dates.js';
import { pctText } from './vat.js';

/** '10 %' · '7,5 %' · null si no hay fee */
export const feeLabel = (bp) => (bp === null || bp === undefined ? null : `${pctText(bp)} %`);

/**
 * Antigüedad: desde el inicio de la relación (si se sabe) o desde su primer evento registrado.
 * @returns {{ from: string, verified: boolean, years: number, months: number, label: string } | null}
 */
export function seniority(sinceOn, firstEvent, now) {
  const from = isDate(sinceOn) ? sinceOn : isDate(firstEvent) ? firstEvent : null;
  if (!from || from > now) return null;
  // Meses de calendario cumplidos (del 1 de marzo al 1 de marzo del año siguiente, justo 12)
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ny, nm, nd] = now.split('-').map(Number);
  const totalMonths = (ny - fy) * 12 + (nm - fm) - (nd < fd ? 1 : 0);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const y = years ? `${years} ${years === 1 ? 'año' : 'años'}` : '';
  const m = months ? `${months} ${months === 1 ? 'mes' : 'meses'}` : '';
  return { from, verified: from === sinceOn, years, months, label: [y, m].filter(Boolean).join(' y ') || 'menos de un mes' };
}

/**
 * En qué punto está un expediente para la ficha del cliente:
 * previsto (pedido o con el evento por llegar) · en_curso (el evento está ocurriendo) · terminado · cancelado
 */
export function stageOf(e, now) {
  if (e.status === 'cancelado') return 'cancelado';
  if (e.status === 'cerrado') return 'terminado';
  if (e.status === 'solicitado' || !isDate(e.start_date) || e.start_date > now) return 'previsto';
  return (e.end_date || e.start_date) < now ? 'terminado' : 'en_curso';
}

export const STAGES = { previsto: 'Previstos', en_curso: 'En curso', terminado: 'Terminados', cancelado: 'Cancelados' };

/**
 * Relación económica a partir de una fila por expediente:
 * { status, start_date, end_date, destination, budget_base, invoiced_base, collected_total, pending_total, fee_bp }
 * Puro: se prueba en tests/clients.test.mjs.
 */
export function clientVolume(rows, year, now) {
  const live = rows.filter((r) => r.status !== 'cancelado');
  const sum = (list, f) => list.reduce((a, r) => a + (r[f] ?? 0), 0);
  const stages = Object.fromEntries(Object.keys(STAGES).map((k) => [k, 0]));
  for (const r of rows) stages[stageOf(r, now)] += 1;
  const group = (key) => {
    const m = new Map();
    for (const r of live) {
      const k = key(r) || '—';
      const g = m.get(k) ?? { key: k, exps: 0, budget: 0, invoiced: 0 };
      g.exps += 1;
      g.budget += r.budget_base ?? 0;
      g.invoiced += r.invoiced_base ?? 0;
      m.set(k, g);
    }
    return [...m.values()];
  };
  const byYear = group((r) => (r.start_date ?? '').slice(0, 4)).sort((a, b) => b.key.localeCompare(a.key));
  for (const y of byYear) {
    const prev = byYear.find((p) => Number(p.key) === Number(y.key) - 1);
    y.change = prev && prev.budget ? (y.budget - prev.budget) / prev.budget : null;
  }
  const dates = live.map((r) => r.start_date).filter(isDate).sort();
  const withFee = live.filter((r) => r.fee_bp !== null && r.fee_bp !== undefined);
  const budget = sum(live, 'budget_base');
  return {
    exps: live.length,
    stages,
    budget,
    invoiced: sum(live, 'invoiced_base'),
    collected: sum(live, 'collected_total'),
    pending: sum(live, 'pending_total'),
    thisYear: sum(live.filter((r) => (r.start_date ?? '').startsWith(String(year))), 'budget_base'),
    average: live.length ? Math.round(budget / live.length) : 0,
    // Fee medio de los expedientes que lo tienen, ponderado por su presupuesto
    averageFeeBp: withFee.length && sum(withFee, 'budget_base')
      ? Math.round(withFee.reduce((a, r) => a + r.fee_bp * (r.budget_base ?? 0), 0) / sum(withFee, 'budget_base'))
      : null,
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
    byYear,
    byCity: group((r) => r.destination).sort((a, b) => b.budget - a.budget),
  };
}
