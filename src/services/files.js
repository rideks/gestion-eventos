// @ts-check
// Almacén de archivos (documentos de proveedor, justificantes, PO, presupuestos, contratos…): el contenido en
// R2 con un nombre aleatorio y su fila en `files` (nombre original, tipo, tamaño, quién lo subió).
// Nunca hay URL pública: se sirven desde /archivos/<id>/<nombre> con sesión. Lo usan los demás servicios
// (y las páginas que aún no están en capas). Las comprobaciones del fichero son puras: src/lib/files.js.
import * as repo from '../repos/files.js';
import { uploadInfo, checkSignature, getFile, UploadError } from '../lib/files.js';
import { randomToken } from '../lib/crypto.js';

/**
 * ¿Vale este archivo? Lo mismo que comprueba storeFile (tipo, tamaño y sus primeros bytes), sin guardar nada.
 * Para comprobarlo antes de crear lo que lo usa (p. ej. un expediente, que gastaría un número).
 * @param {File | null} file
 * @returns {Promise<string | null>} el motivo si no vale; null si vale (o si no hay archivo)
 */
export async function fileProblem(file) {
  if (!file) return null;
  try {
    checkSignature(uploadInfo(file.name, file.size), new Uint8Array(await file.arrayBuffer()));
    return null;
  } catch (err) {
    if (err instanceof UploadError) return err.message;
    throw err;
  }
}

/**
 * Comprueba el fichero, lo sube a R2 y crea su fila. Lanza UploadError si no es válido (sin guardar nada).
 * folder: carpeta en R2 si el documento no es de un expediente (p. ej. el contrato de un proveedor: `prov/12`)
 * @param {{ db: any, bucket: any, file: File, expedienteId?: number | null, userId?: number | null, folder?: string | null }} args
 * @returns {Promise<number>} id del archivo
 */
export async function storeFile({ db, bucket, file, expedienteId = null, userId = null, folder = null }) {
  const info = uploadInfo(file.name, file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkSignature(info, bytes);
  const key = `${folder ?? `exp/${expedienteId}`}/${randomToken(16)}.${info.ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: info.mime } });
  try {
    return await repo.insert(db, { expedienteId, key, name: info.name, mime: info.mime, size: bytes.length, userId: userId ?? null });
  } catch (err) {
    await bucket.delete(key).catch(() => {});
    throw err;
  }
}

/**
 * Sube el fichero del campo `field` si lo hay. Devuelve su id, null si no hay fichero, o lanza UploadError
 * @param {{ db: any, bucket: any, form: FormData | null, field?: string, expedienteId: number | null, userId: number | null }} args
 */
export async function fileFromForm({ db, bucket, form, field = 'file', expedienteId, userId }) {
  const file = getFile(form, field);
  return file ? storeFile({ db, bucket, file, expedienteId, userId }) : null;
}

/**
 * Borra archivos (R2 + fila) que ya no usa nadie
 * @param {any} db
 * @param {any} bucket
 * @param {Array<number | null | undefined>} ids
 */
export async function deleteFiles(db, bucket, ids) {
  const list = /** @type {number[]} */ (ids.filter((id) => Number.isInteger(id)));
  if (!list.length) return;
  const rows = await repo.keys(db, list);
  if (!rows.length) return;
  await bucket.delete(rows.map((r) => r.key)).catch((/** @type {unknown} */ err) => console.error('[archivos]', err));
  await repo.deleteStmt(db, rows.map((r) => r.id)).run();
}
