// Acciones rápidas que se pueden hacer desde varias pantallas (expediente, bandejas, inicio).
import { activityStmt, can } from './app.js';
import { PaySchema, CollectSchema, validate } from './validate.js';
import { eur } from './money.js';
import { formatDate, nowIso } from './dates.js';
import { PAYMENT_METHODS, needsReceipt, RECEIPT_MISSING } from './finance.js';
import { saveReceipt } from './supplier.js';
import { UploadError } from './files.js';

/** ¿Se puede tocar el expediente? Los cerrados y cancelados son de sólo lectura. */
export const isLocked = (exp) => exp.status === 'cerrado' || exp.status === 'cancelado';
export const LOCKED_MSG = 'El expediente está cerrado: reábrelo para cambiar algo.';

export const CARD_ONLY = 'Desde Eventos sólo se marcan como pagados los pagos hechos con tarjeta. Las transferencias y los demás pagos los marca Administración.';

/**
 * Al pasar un pago a «pagado»: hace falta la forma de pago y, si es por transferencia, el justificante.
 * cardOnly: quien lo marca sólo puede registrar pagos con tarjeta (Eventos).
 * @returns {string | null} el problema, o null si se puede
 */
export function paidProblem({ method, hasReceipt, cardOnly = false }) {
  if (!method) return 'Forma de pago: elige cómo se ha pagado.';
  if (cardOnly && method !== 'tarjeta') return CARD_ONLY;
  if (needsReceipt(method) && !hasReceipt) return RECEIPT_MISSING;
  return null;
}

/**
 * Marca un pago a proveedor como hecho (si es por transferencia, con su justificante).
 * receipt: { bucket, file } si el justificante se adjunta en el mismo momento (desde cualquier lista).
 * @returns {Promise<{ ok: true, expedienteId: number } | { ok: false, message: string }>}
 */
export async function markPaid(db, who, input, expedienteId = null, receipt = null) {
  const id = Number(input.payment_id);
  const parsed = validate(PaySchema, input);
  if (!parsed.ok) return parsed;
  const p = Number.isInteger(id) ? await db.prepare(
    `SELECT p.id, p.supplier, p.total_cents, p.status, p.expediente_id, p.receipt_file_id, e.status AS exp_status
       FROM payments p JOIN expedientes e ON e.id = p.expediente_id WHERE p.id = ?`,
  ).bind(id).first() : null;
  if (!p || (expedienteId && p.expediente_id !== expedienteId)) return { ok: false, message: 'Ese pago ya no existe.' };
  if (isLocked({ status: p.exp_status })) return { ok: false, message: LOCKED_MSG };
  if (p.status === 'pagado') return { ok: true, expedienteId: p.expediente_id };
  const { paid_on, method } = parsed.data;
  const problem = paidProblem({ method, hasReceipt: !!(p.receipt_file_id || receipt?.file), cardOnly: !can(who.user, 'payment.any_method') });
  if (problem) return { ok: false, message: problem };
  if (receipt?.file) {
    try {
      await saveReceipt({ db, bucket: receipt.bucket, who, payment: p, file: receipt.file });
    } catch (err) {
      if (!(err instanceof UploadError)) throw err;
      return { ok: false, message: `Justificante · ${err.message}` };
    }
  }
  await db.batch([
    db.prepare("UPDATE payments SET status = 'pagado', paid_on = ?, method = ?, updated_at = ? WHERE id = ?")
      .bind(paid_on, method, nowIso(), id),
    activityStmt(db, who, p.expediente_id, 'payment.paid',
      `marcó como pagado ${p.supplier} (${eur(p.total_cents)}) el ${formatDate(paid_on)}${method ? ` por ${PAYMENT_METHODS[method].toLowerCase()}` : ''}`),
  ]);
  return { ok: true, expedienteId: p.expediente_id };
}

/** Marca una factura emitida como cobrada (sólo Administración) */
export async function markCollected(db, who, input, expedienteId = null) {
  if (!can(who.user, 'invoice.issue')) return { ok: false, message: 'Sólo Administración puede registrar cobros.' };
  const id = Number(input.invoice_id);
  const parsed = validate(CollectSchema, input);
  if (!parsed.ok) return parsed;
  const inv = Number.isInteger(id) ? await db.prepare(
    `SELECT i.id, i.number, i.billed_to, i.total_cents, i.status, i.expediente_id, e.status AS exp_status
       FROM invoices i JOIN expedientes e ON e.id = i.expediente_id WHERE i.id = ?`,
  ).bind(id).first() : null;
  if (!inv || (expedienteId && inv.expediente_id !== expedienteId)) return { ok: false, message: 'Esa factura ya no existe.' };
  if (isLocked({ status: inv.exp_status })) return { ok: false, message: LOCKED_MSG };
  if (inv.status !== 'emitida') return { ok: false, message: 'Sólo se puede cobrar una factura emitida.' };
  await db.batch([
    db.prepare("UPDATE invoices SET status = 'cobrada', collected_on = ?, updated_at = ? WHERE id = ?")
      .bind(parsed.data.collected_on, nowIso(), id),
    activityStmt(db, who, inv.expediente_id, 'invoice.collected',
      `registró el cobro de la factura ${inv.number} de ${inv.billed_to} (${eur(inv.total_cents)})`),
  ]);
  return { ok: true, expedienteId: inv.expediente_id };
}
