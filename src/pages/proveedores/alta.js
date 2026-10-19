// Alta rápida de un proveedor desde el selector de un pago (lo llama SupplierPicker, responde JSON).
// No se da de alta a ciegas: si ya hay alguno con un nombre parecido se devuelven para que la persona
// elija uno de ellos o confirme que es otro distinto (confirm=1).
import { env } from 'cloudflare:workers';
import { readForm, actor, can, logActivity } from '../../lib/app.js';
import { SupplierQuickSchema, validate, formToObject } from '../../lib/validate.js';
import { createSupplier } from '../../lib/suppliers.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function POST(Astro) {
  const me = Astro.locals.user;
  if (!can(me, 'proveedores.create')) return json({ ok: false, error: 'No tienes permiso para dar de alta proveedores. Pídeselo a Administración.' }, 403);
  const form = await readForm(Astro.request);
  const input = form ? formToObject(form) : {};
  const parsed = validate(SupplierQuickSchema, input);
  if (!parsed.ok) return json({ ok: false, error: parsed.message }, 400);

  const r = await createSupplier(env.DB, parsed.data, me.id, { confirmed: input.confirm === '1' });
  if (r.taken) return json({ ok: false, error: `Ya existe: ${r.taken}. Búscalo en la lista.` }, 409);
  if (r.similar) return json({ ok: false, similar: r.similar.map(({ id, name, type, city, status, via }) => ({ id, name, type, city, status, via })) });
  await logActivity(env.DB, actor(Astro), null, 'supplier.create', `dio de alta al proveedor ${r.supplier.name}`);
  return json({ ok: true, supplier: { ...r.supplier, aliases: [] } }, 201);
}
