// Documentos del proveedor: FACTURAS y PROFORMAS (PDF o foto) con su número. Un pago puede tener
// varios (la proforma, la factura, otra factura que la sustituye…) y un documento puede cubrir
// VARIOS pagos del expediente (el hotel cobra dos anticipos y manda una única factura).
//
// Revisión (sólo facturas): quien la sube la deja «pendiente» (naranja) y a Administración le sale
// en la campana; Administración la abre, anota el número y la da por «conforme» (verde: «Con factura»).
// Las proformas no se revisan ni avisan a nadie.
// Una factura conforme ya no se puede borrar: si hay que cambiarla se sube otra explicando por qué,
// y vuelve a avisar a Administración.
//
// Aquí, las reglas puras. Subir, enlazar, quitar y conformar: src/services/payments.js (el SQL, en
// src/repos/supplier-docs.js).

import { can } from './app.js';
import { DOC_KINDS } from './finance.js';

/** Nombre corto: 'factura 10000002019' · 'proforma sin número (Hotel.pdf)' */
export const docName = (d) => {
  const kind = (DOC_KINDS[d.kind] ?? 'Factura').toLowerCase();
  return d.number ? `${kind} ${d.number}` : `${kind} sin número${d.file_name ? ` (${d.file_name})` : ''}`;
};

export const isConforme = (d) => d.kind === 'factura' && d.review === 'conforme';
export const hasConformeInvoice = (docs) => docs.some(isConforme);

/**
 * ¿Puede quitar este documento? Nunca una factura conforme; las demás, Administración
 * (deja la nueva y borra la vieja) o quien la subió (por si se equivocó).
 */
export const canRemoveDocument = (user, d) => !isConforme(d) && (can(user, 'supplier.review') || d.uploaded_by === user.id);
