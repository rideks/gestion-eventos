// Documentos (facturas, PO, presupuestos) en R2.
//
//  · Nunca hay URL pública: se sirven desde /archivos/<id>/<nombre> y sólo con sesión.
//  · Se comprueba el tipo real del fichero por sus primeros bytes (no basta con la extensión).
//  · El nombre en R2 es aleatorio; el nombre original sólo se guarda para mostrarlo.

import { randomToken } from './crypto.js';

export const MAX_FILE_BYTES = 15 * 1024 * 1024;

// extensión → tipo MIME con el que se sirve y "firma" que tiene que tener el fichero
const TYPES = {
  pdf: { mime: 'application/pdf', sig: 'pdf', inline: true },
  jpg: { mime: 'image/jpeg', sig: 'jpg', inline: true },
  jpeg: { mime: 'image/jpeg', sig: 'jpg', inline: true },
  png: { mime: 'image/png', sig: 'png', inline: true },
  webp: { mime: 'image/webp', sig: 'webp', inline: true },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sig: 'zip' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sig: 'zip' },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', sig: 'zip' },
  odt: { mime: 'application/vnd.oasis.opendocument.text', sig: 'zip' },
  xls: { mime: 'application/vnd.ms-excel', sig: 'ole' },
  doc: { mime: 'application/msword', sig: 'ole' },
  msg: { mime: 'application/vnd.ms-outlook', sig: 'ole' },
  eml: { mime: 'message/rfc822', sig: 'text' },
};

/** Para el atributo accept de los <input type="file"> */
export const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',');

export class UploadError extends Error {}

function signatureOf(b) {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'pdf'; // %PDF-
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'zip';
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0
    && b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1) return 'ole';
  // Texto (correos .eml): sin bytes nulos al principio
  if (b.length > 0 && !b.subarray(0, 512).includes(0)) return 'text';
  return null;
}

/** Nombre limpio para mostrar y para la descarga: 'Factura Hotel 1225.pdf' */
export function cleanName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop()
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (base || 'documento').slice(0, 120);
}

export const extensionOf = (name) => (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] ?? '').toLowerCase();

/** El fichero (o null) de un campo del formulario */
export function getFile(form, name) {
  const v = form?.get(name);
  return v && typeof v === 'object' && 'arrayBuffer' in v && v.size > 0 ? v : null;
}

/**
 * Comprueba el fichero, lo sube a R2 y crea su fila en `files`.
 * @returns {Promise<number>} id del documento
 */
export async function storeFile({ db, bucket, file, expedienteId, userId }) {
  const name = cleanName(file.name);
  const ext = extensionOf(name);
  const type = TYPES[ext];
  if (!type) throw new UploadError(`«${name}»: tipo de archivo no admitido (PDF, foto, Excel, Word o correo).`);
  if (file.size > MAX_FILE_BYTES) throw new UploadError(`«${name}» ocupa demasiado (máximo ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signatureOf(bytes) !== type.sig) {
    throw new UploadError(`«${name}» no parece un ${ext.toUpperCase()} válido. Vuelve a exportarlo o súbelo en PDF.`);
  }
  const key = `exp/${expedienteId}/${randomToken(16)}.${ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: type.mime } });
  try {
    const row = await db.prepare(
      'INSERT INTO files (expediente_id, key, name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    ).bind(expedienteId, key, name, type.mime, bytes.length, userId ?? null).first();
    return row.id;
  } catch (err) {
    await bucket.delete(key).catch(() => {});
    throw err;
  }
}

/** Sube el fichero del campo `field` si lo hay. Devuelve su id, null si no hay fichero, o lanza UploadError */
export async function fileFromForm({ db, bucket, form, field = 'file', expedienteId, userId }) {
  const file = getFile(form, field);
  return file ? storeFile({ db, bucket, file, expedienteId, userId }) : null;
}

/** Borra documentos (R2 + fila) que ya no usa nadie */
export async function deleteFiles(db, bucket, ids) {
  const list = ids.filter((id) => Number.isInteger(id));
  if (!list.length) return;
  const { results } = await db.prepare(`SELECT id, key FROM files WHERE id IN (${list.map(() => '?').join(',')})`).bind(...list).all();
  if (!results.length) return;
  await bucket.delete(results.map((r) => r.key)).catch((err) => console.error('[archivos]', err));
  await db.prepare(`DELETE FROM files WHERE id IN (${results.map(() => '?').join(',')})`).bind(...results.map((r) => r.id)).run();
}

/** ¿Se puede ver en el navegador (PDF, foto) o hay que descargarlo (Excel, Word)? */
export const isInline = (mime) => Object.values(TYPES).some((t) => t.mime === mime && t.inline);

/** Enlace al documento */
export const fileUrl = (f) => (f?.file_id ? `/archivos/${f.file_id}/${encodeURIComponent(f.file_name ?? 'documento')}` : null);

/** '1,2 MB' */
export const fileSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
