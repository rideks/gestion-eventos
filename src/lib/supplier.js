// Facturas de proveedor: el documento (PDF/foto) con su número, que cubre uno o VARIOS pagos
// del expediente (p. ej. el hotel cobra dos anticipos y manda una única factura).
//
// Revisión: quien la sube la deja «pendiente» (naranja) y le sale a Administración en su bandeja;
// Administración la abre, anota el número y la da por «conforme» (verde: «Con factura»).

import { activityStmt, can } from './app.js';
import { storeFile, deleteFiles } from './files.js';
import { eur } from './money.js';
import { formatDate, nowIso } from './dates.js';

/** Factura con su documento y quién la subió / revisó */
export function getSupplierInvoice(db, id) {
  return db.prepare(
    `SELECT si.*, f.name AS file_name, u.name AS uploaded_by_name, r.name AS reviewed_by_name
       FROM supplier_invoices si LEFT JOIN files f ON f.id = si.file_id
       LEFT JOIN users u ON u.id = si.uploaded_by LEFT JOIN users r ON r.id = si.reviewed_by
      WHERE si.id = ?`,
  ).bind(id).first();
}

/** Pagos que cubre una factura */
export async function invoicePayments(db, invoiceId) {
  const { results } = await db.prepare(
    'SELECT id, supplier, concept, total_cents, base_cents, status, paid_on, due_date FROM payments WHERE supplier_invoice_id = ? ORDER BY id',
  ).bind(invoiceId).all();
  return results;
}

/** Facturas ya subidas en el expediente (para «es una factura que ya está subida») */
export async function expedienteInvoices(db, expedienteId) {
  const { results } = await db.prepare(
    `SELECT si.id, si.supplier, si.number, si.issued_on, si.review, f.name AS file_name,
            (SELECT COUNT(*) FROM payments p WHERE p.supplier_invoice_id = si.id) AS payment_count
       FROM supplier_invoices si LEFT JOIN files f ON f.id = si.file_id
      WHERE si.expediente_id = ? ORDER BY si.supplier, si.id`,
  ).bind(expedienteId).all();
  return results;
}

/** Nombre corto de una factura: 'Factura 10000002019' · 'Factura sin número (Hotel.pdf)' */
export const invoiceName = (si) => (si.number ? `factura ${si.number}` : `factura sin número${si.file_name ? ` (${si.file_name})` : ''}`);

/** Borra la factura (y su documento) si ya no cubre ningún pago */
export async function dropIfOrphan(db, bucket, invoiceId) {
  if (!invoiceId) return;
  const used = await db.prepare('SELECT 1 FROM payments WHERE supplier_invoice_id = ? LIMIT 1').bind(invoiceId).first();
  if (used) return;
  const si = await db.prepare('SELECT file_id FROM supplier_invoices WHERE id = ?').bind(invoiceId).first();
  if (!si) return;
  await db.prepare('DELETE FROM supplier_invoices WHERE id = ?').bind(invoiceId).run();
  if (si.file_id) await deleteFiles(db, bucket, [si.file_id]);
}

/**
 * Crea una factura para un pago (con documento, con número o con las dos cosas).
 * Si la sube Administración con su número, queda ya conforme; si no, pendiente de revisar.
 * @param data { number, issued_on, total } (total en céntimos o null)
 */
export async function attachNewInvoice({ db, bucket, who, payment, file, data }) {
  const fileId = file ? await storeFile({ db, bucket, file, expedienteId: payment.expediente_id, userId: who.user.id }) : null;
  const conforme = can(who.user, 'supplier.review') && !!data.number;
  const at = nowIso();
  const si = await db.prepare(
    `INSERT INTO supplier_invoices (expediente_id, supplier, number, issued_on, total_cents, file_id, review, reviewed_by, reviewed_at, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(payment.expediente_id, payment.supplier, data.number, data.issued_on, data.total ?? null, fileId,
    conforme ? 'conforme' : 'pendiente', conforme ? who.user.id : null, conforme ? at : null, who.user.id, at).first();
  const previous = payment.supplier_invoice_id;
  await db.batch([
    db.prepare('UPDATE payments SET supplier_invoice_id = ?, updated_at = ? WHERE id = ?').bind(si.id, at, payment.id),
    activityStmt(db, who, payment.expediente_id, 'supplier_invoice.add',
      `subió la ${data.number ? `factura ${data.number}` : 'factura'} de ${payment.supplier} (${eur(payment.total_cents)})${conforme ? '' : ' · pendiente de revisar'}`),
  ]);
  await dropIfOrphan(db, bucket, previous);
  return si.id;
}

/** El pago lo cubre una factura que ya está subida (mismo expediente) */
export async function linkExistingInvoice({ db, bucket, who, payment, invoiceId }) {
  const si = await getSupplierInvoice(db, invoiceId);
  if (!si || si.expediente_id !== payment.expediente_id) return { ok: false, message: 'Esa factura no es de este expediente.' };
  const previous = payment.supplier_invoice_id;
  await db.batch([
    db.prepare('UPDATE payments SET supplier_invoice_id = ?, updated_at = ? WHERE id = ?').bind(si.id, nowIso(), payment.id),
    activityStmt(db, who, payment.expediente_id, 'supplier_invoice.link',
      `indicó que la ${invoiceName(si)} de ${si.supplier} también cubre el pago de ${payment.supplier} (${eur(payment.total_cents)})`),
  ]);
  if (previous !== si.id) await dropIfOrphan(db, bucket, previous);
  return { ok: true };
}

/** Quita la factura del pago (si ya no cubre ningún otro pago, se borra con su documento) */
export async function unlinkInvoice({ db, bucket, who, payment }) {
  const si = payment.supplier_invoice_id ? await getSupplierInvoice(db, payment.supplier_invoice_id) : null;
  if (!si) return;
  await db.batch([
    db.prepare('UPDATE payments SET supplier_invoice_id = NULL, updated_at = ? WHERE id = ?').bind(nowIso(), payment.id),
    activityStmt(db, who, payment.expediente_id, 'supplier_invoice.remove', `quitó la ${invoiceName(si)} del pago de ${payment.supplier}`),
  ]);
  await dropIfOrphan(db, bucket, si.id);
}

/** Cambia el documento de la factura: vuelve a quedar pendiente de revisar */
export async function replaceInvoiceFile({ db, bucket, who, invoice, file }) {
  const fileId = await storeFile({ db, bucket, file, expedienteId: invoice.expediente_id, userId: who.user.id });
  await db.batch([
    db.prepare("UPDATE supplier_invoices SET file_id = ?, review = 'pendiente', reviewed_by = NULL, reviewed_at = NULL, uploaded_by = ?, uploaded_at = ? WHERE id = ?")
      .bind(fileId, who.user.id, nowIso(), invoice.id),
    activityStmt(db, who, invoice.expediente_id, 'supplier_invoice.file', `cambió el documento de la ${invoiceName(invoice)} de ${invoice.supplier} · pendiente de revisar`),
  ]);
  if (invoice.file_id) await deleteFiles(db, bucket, [invoice.file_id]);
}

/**
 * Corrige número, fecha o total de la factura. Si lo cambia alguien que no es Administración
 * en una factura ya revisada, vuelve a quedar pendiente de revisar.
 */
export async function updateInvoiceData({ db, who, invoice, data }) {
  const recheck = invoice.review === 'conforme' && !can(who.user, 'supplier.review');
  await db.batch([
    db.prepare(`UPDATE supplier_invoices SET number = ?, issued_on = ?, total_cents = ?${recheck ? ", review = 'pendiente', reviewed_by = NULL, reviewed_at = NULL" : ''} WHERE id = ?`)
      .bind(data.number, data.issued_on, data.total ?? null, invoice.id),
    activityStmt(db, who, invoice.expediente_id, 'supplier_invoice.update', `corrigió los datos de la ${invoiceName({ ...invoice, ...data })} de ${invoice.supplier}`),
  ]);
}

/**
 * Administración revisa la factura y la da por buena: anota el número (y la fecha) y queda «Con factura».
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function conformInvoice({ db, who, invoiceId, data }) {
  if (!can(who.user, 'supplier.review')) return { ok: false, message: 'Sólo Administración puede dar una factura por revisada.' };
  const si = await getSupplierInvoice(db, invoiceId);
  if (!si) return { ok: false, message: 'Esa factura ya no existe.' };
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
