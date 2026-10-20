// Reglas comunes de las acciones que se hacen desde varias pantallas (expediente, bandejas, inicio): si el expediente
// se puede tocar y qué hace falta para marcar un pago como hecho. Las acciones están en sus servicios
// (pagar: src/services/payments.js; cobrar: src/services/invoices.js).
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
