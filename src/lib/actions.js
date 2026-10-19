// Acciones rápidas que se pueden hacer desde varias pantallas (expediente, bandejas, inicio).
// Marcar un pago como hecho ya está en el servicio de pagos (src/services/payments.js); aquí quedan las
// reglas comunes y el cobro de una factura (hasta que Cobros pase a capas).
import { activityStmt, can } from './app.js';
import { CollectSchema, validate } from './validate.js';
import { eur } from './money.js';
import { nowIso } from './dates.js';
import { needsReceipt, RECEIPT_MISSING } from './finance.js';

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

/** Marca una factura emitida como cobrada (permiso invoice.issue) */
export async function markCollected(db, who, input, expedienteId = null) {
  if (!can(who.user, 'invoice.issue')) return { ok: false, message: 'No tienes permiso para registrar cobros.' };
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
