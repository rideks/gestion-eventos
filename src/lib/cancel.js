// Cancelaciones de expedientes y de reservas de Business Travel: quién cancela y por qué. Se guarda con el
// expediente o la reserva (cancel_by, cancel_reason, cancel_notes) para tener el histórico de qué clientes cancelan
// y el motivo. Al reabrir se borra (queda en la actividad o el historial con el texto de cancelSummary).

/** Quién cancela */
export const CANCEL_SIDES = { cliente: 'El cliente', agencia: 'Nosotros' };

/** Motivos (con «Otros», el comentario es obligatorio) */
export const CANCEL_REASONS = {
  precio: 'Precio o presupuesto',
  fechas: 'Cambio de fechas o aplazamiento',
  competencia: 'Eligió otra agencia o proveedor',
  no_se_hace: 'El evento o el viaje ya no se hace',
  fuerza_mayor: 'Fuerza mayor (clima, salud, huelgas…)',
  duplicado: 'Duplicado o creado por error',
  otros: 'Otros',
};

/** ¿Cuenta como cancelación en las cifras del cliente? (un duplicado o un error, no) */
export const countsAsCancellation = (reason) => reason !== 'duplicado';

/**
 * Para la actividad, el historial y las listas: «El cliente · Precio o presupuesto · «se fue a otra agencia»»
 * @param {{ cancel_by?: string | null, cancel_reason?: string | null, cancel_notes?: string | null }} c
 */
export function cancelSummary({ cancel_by, cancel_reason, cancel_notes }) {
  if (!cancel_reason) return 'sin motivo apuntado';
  const parts = [CANCEL_SIDES[cancel_by] ?? null, CANCEL_REASONS[cancel_reason] ?? cancel_reason, cancel_notes ? `«${cancel_notes}»` : null];
  return parts.filter(Boolean).join(' · ');
}
