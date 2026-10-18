// Documento de un expediente (factura, PO, presupuesto). Sólo con sesión (lo comprueba el middleware)
// y nunca en caché compartida. PDF y fotos se abren en el navegador; Excel y Word se descargan.
import { env } from 'cloudflare:workers';
import { isInline } from '../../../lib/files.js';
import { can } from '../../../lib/app.js';

const notFound = () => new Response('No encontrado', { status: 404, headers: { 'cache-control': 'no-store' } });

export async function GET({ params, locals }) {
  if (!locals.user) return notFound();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return notFound();
  const row = await env.DB.prepare(
    `SELECT f.key, f.name, f.mime,
            EXISTS (SELECT 1 FROM invoices i WHERE i.file_id = f.id) OR EXISTS (SELECT 1 FROM purchase_orders po WHERE po.file_id = f.id) AS billing
       FROM files f WHERE f.id = ?`,
  ).bind(id).first();
  // Los documentos de cobros (facturas al cliente y PO) sólo los ve quien puede ver los cobros
  if (!row || (row.billing && !can(locals.user, 'cobros'))) return notFound();
  const object = await env.DOCS.get(row.key);
  if (!object) return notFound();

  // Nombre de descarga seguro (RFC 6266: versión ASCII + versión UTF-8)
  const ascii = row.name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'documento';
  const disposition = `${isInline(row.mime) ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.name)}`;
  const headers = {
    'content-type': row.mime,
    'content-disposition': disposition,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
  };
  // El visor de PDF del navegador no funciona dentro de un sandbox; el resto (fotos, descargas) sí va aislado.
  // El tipo real del archivo se comprobó al subirlo, así que un PDF nunca se interpreta como HTML.
  if (row.mime !== 'application/pdf') headers['content-security-policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
  return new Response(object.body, { headers });
}
