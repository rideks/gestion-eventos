// Documentos (facturas, PO, presupuestos) en R2.
//
//  · Nunca hay URL pública: se sirven desde /archivos/<id>/<nombre> y sólo con sesión.
//  · Se comprueba el tipo real del fichero por sus primeros bytes (no basta con la extensión).
//  · El nombre en R2 es aleatorio; el nombre original sólo se guarda para mostrarlo.
// Aquí, lo puro (tipos, nombres, comprobaciones, enlaces). Guardar y borrar: src/services/files.js.

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
 * Antes de leer un fichero: ¿tipo admitido y tamaño razonable? (puro; lo usa src/services/files.js)
 * @param {string} rawName nombre original
 * @param {number} size bytes
 * @returns {{ name: string, ext: string, mime: string, sig: string }}
 * @throws {UploadError}
 */
export function uploadInfo(rawName, size) {
  const name = cleanName(rawName);
  const ext = extensionOf(name);
  const type = TYPES[ext];
  if (!type) throw new UploadError(`«${name}»: tipo de archivo no admitido (PDF, foto, Excel, Word o correo).`);
  if (size > MAX_FILE_BYTES) throw new UploadError(`«${name}» ocupa demasiado (máximo ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
  return { name, ext, mime: type.mime, sig: type.sig };
}

/**
 * Después de leerlo: ¿sus primeros bytes son de ese tipo? (no basta con la extensión)
 * @param {{ name: string, ext: string, sig: string }} info lo que devuelve uploadInfo
 * @param {Uint8Array} bytes
 * @throws {UploadError}
 */
export function checkSignature(info, bytes) {
  if (signatureOf(bytes) !== info.sig) {
    throw new UploadError(`«${info.name}» no parece un ${info.ext.toUpperCase()} válido. Vuelve a exportarlo o súbelo en PDF.`);
  }
}

/** ¿Se puede ver en el navegador (PDF, foto) o hay que descargarlo (Excel, Word)? */
export const isInline = (mime) => Object.values(TYPES).some((t) => t.mime === mime && t.inline);

/** Enlace al documento */
export const fileUrl = (f) => (f?.file_id ? `/archivos/${f.file_id}/${encodeURIComponent(f.file_name ?? 'documento')}` : null);

/** '1,2 MB' */
export const fileSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
