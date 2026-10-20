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

// ── Documentos que no se pierden ─────────────────────────────────────────
// El navegador no puede volver a poner un archivo en un formulario. Si al guardar falta algún dato, el documento
// elegido se guarda como temporal (comprobado como cualquier otro) y la página vuelve con su ficha
// («factura.pdf · Listo») y un campo oculto <campo>__kept con su clave. Al volver a enviar, keepUploads lo vuelve a
// poner en el formulario como si se acabara de elegir, así que el resto del código no cambia.

/** El campo oculto con la clave del temporal: <campo>__kept */
export const KEPT = '__kept';
/** Horas que dura un temporal (la limpieza diaria borra los más viejos) */
export const STAGED_HOURS = 24;

/**
 * @typedef {{ token: string, id: number, name: string, size: number }} Kept
 */

/**
 * Prepara los documentos de un formulario (antes de usarlo): recupera los que se guardaron en un intento anterior
 * con error. Después, con lo que devuelve: done() si salió bien (borra los temporales, que ya se han guardado
 * aparte) o keep() si hubo un error (guarda como temporales los documentos elegidos y devuelve sus fichas).
 * @param {{ db: any, bucket: any, user?: { id: number } | null, now?: string }} ctx
 * @param {FormData | null} form
 * @param {string[]} fields los campos de archivo del formulario (p. ej. ['file', 'receipt'])
 */
export async function keepUploads(ctx, form, fields) {
  const userId = ctx.user?.id ?? null;
  const since = new Date(Date.now() - STAGED_HOURS * 3600e3).toISOString();
  /** @type {Record<string, { id: number, key: string, name: string, mime: string, size: number, token: string }>} */
  const restored = {};
  if (form && userId) {
    for (const field of fields) {
      const token = String(form.get(`${field}${KEPT}`) ?? '').trim();
      // Si se ha elegido otro archivo, ése sustituye al guardado
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(token) || getFile(form, field)) continue;
      const row = await repo.staged(ctx.db, token, userId, since);
      const object = row ? await ctx.bucket.get(row.key) : null;
      if (!row || !object) continue;
      form.set(field, new File([await object.arrayBuffer()], row.name, { type: row.mime }));
      restored[field] = { ...row, token };
    }
  }
  return {
    restored,
    /** Ha salido bien: los temporales ya no hacen falta */
    async done() {
      await deleteFiles(ctx.db, ctx.bucket, Object.values(restored).map((r) => r.id));
    },
    /**
     * Ha habido un error: los documentos elegidos se guardan como temporales para no tener que volver a subirlos
     * (uno que no vale, p. ej. un PDF falso, no: su error ya sale en el campo)
     * @returns {Promise<Record<string, Kept>>}
     */
    async keep() {
      /** @type {Record<string, Kept>} */
      const kept = {};
      for (const field of fields) {
        const prev = restored[field];
        if (prev) {
          kept[field] = { token: prev.token, id: prev.id, name: prev.name, size: prev.size };
          continue;
        }
        const file = form ? getFile(form, field) : null;
        if (!file || !userId) continue;
        try {
          kept[field] = await stage(ctx, file, userId);
        } catch (err) {
          if (!(err instanceof UploadError)) throw err;
        }
      }
      return kept;
    },
  };
}

/**
 * Guarda un temporal (con las mismas comprobaciones que storeFile)
 * @param {{ db: any, bucket: any }} ctx @param {File} file @param {number} userId
 * @returns {Promise<Kept>}
 */
async function stage(ctx, file, userId) {
  const info = uploadInfo(file.name, file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkSignature(info, bytes);
  const token = randomToken(16);
  const key = `tmp/${userId}/${token}.${info.ext}`;
  await ctx.bucket.put(key, bytes, { httpMetadata: { contentType: info.mime } });
  try {
    const id = await repo.insertStaged(ctx.db, { key, name: info.name, mime: info.mime, size: bytes.length, userId, token, at: new Date().toISOString() });
    return { token, id, name: info.name, size: bytes.length };
  } catch (err) {
    await ctx.bucket.delete(key).catch(() => {});
    throw err;
  }
}
