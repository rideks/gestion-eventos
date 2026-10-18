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
// También el justificante bancario del pago (payments.receipt_file_id).

import { activityStmt, can } from './app.js';
import { storeFile, deleteFiles } from './files.js';
import { eur } from './money.js';
import { formatDate, nowIso } from './dates.js';
import { DOC_KINDS, conformBlocker } from './finance.js';

const DOC_COLUMNS = `si.*, f.name AS file_name, u.name AS uploaded_by_name, r.name AS reviewed_by_name,
  (SELECT COUNT(*) FROM payment_documents x WHERE x.document_id = si.id) AS payment_count`;
const DOC_JOINS = `LEFT JOIN files f ON f.id = si.file_id
  LEFT JOIN users u ON u.id = si.uploaded_by LEFT JOIN users r ON r.id = si.reviewed_by`;

/** Un documento con su archivo, quién lo subió / revisó y cuántos pagos cubre */
export function getDocument(db, id) {
  return db.prepare(`SELECT ${DOC_COLUMNS} FROM supplier_invoices si ${DOC_JOINS} WHERE si.id = ?`).bind(id).first();
}

/** Documentos de un pago, los más recientes primero */
export async function paymentDocuments(db, paymentId) {
  const { results } = await db.prepare(
    `SELECT ${DOC_COLUMNS} FROM payment_documents pd JOIN supplier_invoices si ON si.id = pd.document_id ${DOC_JOINS}
      WHERE pd.payment_id = ? ORDER BY si.uploaded_at DESC, si.id DESC`,
  ).bind(paymentId).all();
  return results;
}

/** Pagos que cubre cada documento de un pago (en una sola consulta): Map document_id → pagos */
export async function documentsCoverage(db, paymentId) {
  const { results } = await db.prepare(
    `SELECT pd.document_id, p.id, p.supplier, p.concept, p.total_cents, p.status
       FROM payment_documents pd JOIN payments p ON p.id = pd.payment_id
      WHERE pd.document_id IN (SELECT document_id FROM payment_documents WHERE payment_id = ?)
      ORDER BY p.id`,
  ).bind(paymentId).all();
  const map = new Map();
  for (const r of results) map.set(r.document_id, [...(map.get(r.document_id) ?? []), r]);
  return map;
}

/** Documentos ya subidos en el expediente (para «es un documento que ya está subido») */
export async function expedienteDocuments(db, expedienteId) {
  const { results } = await db.prepare(
    `SELECT si.id, si.kind, si.supplier, si.number FROM supplier_invoices si WHERE si.expediente_id = ? ORDER BY si.supplier, si.id`,
  ).bind(expedienteId).all();
  return results;
}

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

/** Borra el documento (y su archivo) si ya no cubre ningún pago */
export async function dropIfOrphan(db, bucket, documentId) {
  if (!documentId) return;
  const used = await db.prepare('SELECT 1 FROM payment_documents WHERE document_id = ? LIMIT 1').bind(documentId).first();
  if (used) return;
  const d = await db.prepare('SELECT file_id FROM supplier_invoices WHERE id = ?').bind(documentId).first();
  if (!d) return;
  await db.prepare('DELETE FROM supplier_invoices WHERE id = ?').bind(documentId).run();
  if (d.file_id) await deleteFiles(db, bucket, [d.file_id]);
}

/**
 * Sube un documento a un pago (con archivo, con número o con las dos cosas).
 * Factura: si la sube Administración con su número queda ya conforme; si no, pendiente de revisar.
 * Proforma: no se revisa.
 * @param data { kind, number, issued_on, total, comment } (total en céntimos o null)
 */
export async function attachDocument({ db, bucket, who, payment, file, data }) {
  const fileId = file ? await storeFile({ db, bucket, file, expedienteId: payment.expediente_id, userId: who.user.id }) : null;
  const invoice = data.kind === 'factura';
  // Si la sube Administración con su número y el pago ya está hecho, queda conforme
  const conforme = invoice && can(who.user, 'supplier.review') && !!data.number && payment.status === 'pagado';
  const at = nowIso();
  const d = await db.prepare(
    `INSERT INTO supplier_invoices (expediente_id, kind, supplier, number, issued_on, total_cents, file_id, review, reviewed_by, reviewed_at, uploaded_by, uploaded_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(payment.expediente_id, data.kind, payment.supplier, data.number, data.issued_on, data.total ?? null, fileId,
    conforme ? 'conforme' : 'pendiente', conforme ? who.user.id : null, conforme ? at : null, who.user.id, at, data.comment ?? null).first();
  const what = docName({ kind: data.kind, number: data.number });
  await db.batch([
    db.prepare('INSERT INTO payment_documents (payment_id, document_id) VALUES (?, ?)').bind(payment.id, d.id),
    db.prepare('UPDATE payments SET updated_at = ? WHERE id = ?').bind(at, payment.id),
    activityStmt(db, who, payment.expediente_id, invoice ? 'supplier_invoice.add' : 'supplier_proforma.add',
      `subió la ${what} de ${payment.supplier} (${eur(payment.total_cents)})${invoice && !conforme ? ' · pendiente de revisar' : ''}`
      + `${data.comment ? `. Comentario: ${data.comment}` : ''}`),
  ]);
  return d.id;
}

/** El pago lo cubre también un documento que ya está subido (mismo expediente) */
export async function linkDocument({ db, who, payment, documentId }) {
  const d = await getDocument(db, documentId);
  if (!d || d.expediente_id !== payment.expediente_id) return { ok: false, message: 'Ese documento no es de este expediente.' };
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO payment_documents (payment_id, document_id) VALUES (?, ?)').bind(payment.id, d.id),
    activityStmt(db, who, payment.expediente_id, 'supplier_invoice.link',
      `indicó que la ${docName(d)} de ${d.supplier} también cubre el pago de ${payment.supplier} (${eur(payment.total_cents)})`),
  ]);
  return { ok: true };
}

/**
 * Quita el documento del pago (si ya no cubre ningún otro pago, se borra con su archivo).
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function removeDocument({ db, bucket, who, payment, document: d }) {
  if (isConforme(d)) return { ok: false, message: 'Una factura conforme no se puede borrar: si hay que cambiarla, sube otra explicando por qué.' };
  if (!canRemoveDocument(who.user, d)) return { ok: false, message: 'Sólo Administración o quien subió el documento puede quitarlo.' };
  await db.batch([
    db.prepare('DELETE FROM payment_documents WHERE payment_id = ? AND document_id = ?').bind(payment.id, d.id),
    activityStmt(db, who, payment.expediente_id, 'supplier_invoice.remove', `quitó la ${docName(d)} del pago de ${payment.supplier}`),
  ]);
  await dropIfOrphan(db, bucket, d.id);
  return { ok: true };
}

/**
 * Administración revisa la factura y la da por buena: anota el número (y la fecha) y queda «Con factura».
 * @returns {Promise<{ ok: true, expedienteId: number } | { ok: false, message: string }>}
 */
export async function conformInvoice({ db, who, invoiceId, data }) {
  if (!can(who.user, 'supplier.review')) return { ok: false, message: 'Sólo Administración puede dar una factura por revisada.' };
  const si = await getDocument(db, invoiceId);
  if (!si) return { ok: false, message: 'Esa factura ya no existe.' };
  if (si.kind !== 'factura') return { ok: false, message: 'Las proformas no se revisan.' };
  const { results: covered } = await db.prepare(
    'SELECT p.status FROM payment_documents pd JOIN payments p ON p.id = pd.payment_id WHERE pd.document_id = ?',
  ).bind(si.id).all();
  const blocked = conformBlocker(covered);
  if (blocked) return { ok: false, message: blocked };
  const exp = await db.prepare('SELECT status FROM expedientes WHERE id = ?').bind(si.expediente_id).first();
  if (exp?.status === 'cerrado' || exp?.status === 'cancelado') return { ok: false, message: 'El expediente está cerrado: reábrelo para cambiar algo.' };
  const at = nowIso();
  await db.batch([
    db.prepare("UPDATE supplier_invoices SET number = ?, issued_on = ?, review = 'conforme', reviewed_by = ?, reviewed_at = ? WHERE id = ?")
      .bind(data.number, data.issued_on ?? si.issued_on, who.user.id, at, si.id),
    activityStmt(db, who, si.expediente_id, 'supplier_invoice.conform',
      `revisó la factura ${data.number} de ${si.supplier}${data.issued_on ? ` del ${formatDate(data.issued_on)}` : ''}: conforme`),
  ]);
  return { ok: true, expedienteId: si.expediente_id };
}

/** Guarda (o cambia) el justificante bancario del pago */
export async function saveReceipt({ db, bucket, who, payment, file }) {
  const fileId = await storeFile({ db, bucket, file, expedienteId: payment.expediente_id, userId: who.user.id });
  await db.batch([
    db.prepare('UPDATE payments SET receipt_file_id = ?, updated_at = ? WHERE id = ?').bind(fileId, nowIso(), payment.id),
    activityStmt(db, who, payment.expediente_id, 'payment.receipt',
      `${payment.receipt_file_id ? 'cambió' : 'subió'} el justificante del pago a ${payment.supplier} (${eur(payment.total_cents)})`),
  ]);
  if (payment.receipt_file_id) await deleteFiles(db, bucket, [payment.receipt_file_id]);
}

/** Quita el justificante (no si el pago ya está hecho por transferencia: entonces sólo se cambia) */
export async function removeReceipt({ db, bucket, who, payment }) {
  if (!payment.receipt_file_id) return;
  await db.batch([
    db.prepare('UPDATE payments SET receipt_file_id = NULL, updated_at = ? WHERE id = ?').bind(nowIso(), payment.id),
    activityStmt(db, who, payment.expediente_id, 'payment.receipt', `quitó el justificante del pago a ${payment.supplier}`),
  ]);
  await deleteFiles(db, bucket, [payment.receipt_file_id]);
}
