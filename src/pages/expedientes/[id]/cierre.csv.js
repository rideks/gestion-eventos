// Cierre en CSV con el mismo formato que el Excel de cierre (proveedores | cliente, uno al lado del otro).
// Separador «;» y decimales con coma: Excel en español lo abre directamente con números.
import { env } from 'cloudflare:workers';
import { getExpediente, loadFinance } from '../../../lib/data.js';
import { csvAmount, pct } from '../../../lib/money.js';
import { today, formatRange } from '../../../lib/dates.js';

const cell = (v) => {
  let s = String(v ?? '');
  // Que Excel no ejecute como fórmula un texto que empiece por =, +, @ o - (salvo los importes negativos)
  if (/^[=+@\t\r]/.test(s) || (s.startsWith('-') && !/^-\d+(,\d+)?$/.test(s))) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (cells) => cells.map(cell).join(';');

export async function GET({ params }) {
  const id = Number(params.id);
  const exp = Number.isInteger(id) && id > 0 ? await getExpediente(env.DB, id) : null;
  if (!exp) return new Response('No encontrado', { status: 404 });
  const fin = await loadFinance(env.DB, id, today());
  const s = fin.summary;
  const sales = fin.invoices.filter((i) => i.status !== 'anulada').sort((a, b) => a.id - b.id);
  const salesRows = sales.length
    ? sales.map((i) => [i.billed_to, i.number ?? 'por emitir', csvAmount(i.base_cents), csvAmount(i.total_cents)])
    : [[exp.company, `presupuesto v${fin.budget?.version ?? ''}`, csvAmount(s.sale.base), csvAmount(s.sale.total)]];
  const costRows = [...fin.payments].sort((a, b) => a.id - b.id).map((p) => [p.invoice_number ?? (p.supplier_invoice_id ? 'sin nº' : 'pendiente'), [p.supplier, p.concept].filter(Boolean).join(' - '), csvAmount(p.base_cents), csvAmount(p.total_cents)]);
  const n = Math.max(costRows.length, salesRows.length);
  const profit = s.closingSales.base - s.cost.base;
  const profitTotal = s.closingSales.total - s.cost.total;

  const out = [
    line([exp.number ? `EXP ${exp.number}` : 'Solicitud', exp.name, formatRange(exp.start_date, exp.end_date), exp.company]),
    '',
    line(['Nº FACT', 'COMITENTE / PROVEEDOR', 'NETO SIN IVA', 'NETO CON IVA', '', 'CLIENTE', 'Nº FACTURA', 'IMPORTE SIN IVA', 'IMPORTE CON IVA']),
    ...Array.from({ length: n }, (_, i) => line([...(costRows[i] ?? ['', '', '', '']), '', ...(salesRows[i] ?? ['', '', '', ''])])),
    '',
    line(['', 'TOTAL NETO GRUPO', csvAmount(s.cost.base), csvAmount(s.cost.total), '', 'TOTAL GRUPO', '', csvAmount(s.closingSales.base), csvAmount(s.closingSales.total)]),
    line(['', 'BENEFICIO', csvAmount(profit), csvAmount(profitTotal)]),
    line(['', 'BENEFICIO % VENTAS', pct(profit, s.closingSales.base), pct(profitTotal, s.closingSales.total)]),
  ];
  const name = `cierre-${exp.number ? `exp-${exp.number}` : `solicitud-${exp.id}`}.csv`;
  // BOM para que Excel reconozca las tildes (UTF-8)
  return new Response(`﻿${out.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  });
}
