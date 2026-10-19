// Alta rápida de un cliente desde el selector de una solicitud (lo llama EntityPickerKit, responde JSON).
// No se da de alta a ciegas: si ya hay alguno con un nombre parecido se devuelven para que la persona
// elija uno de ellos o confirme que es otro distinto (confirm=1). Las reglas: src/services/clients.js.
import { readForm } from '../../lib/app.js';
import { formToObject } from '../../lib/validate.js';
import { serviceContext } from '../../services/context.js';
import * as clients from '../../services/clients.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const STATUS = { forbidden: 403, invalid: 400, conflict: 409 };

export async function POST(Astro) {
  const form = await readForm(Astro.request);
  const r = await clients.create(serviceContext(Astro), form ? formToObject(form) : {}, { quick: true });
  if (r.ok) return json({ ok: true, item: r.value }, 201);
  if (r.code === 'similar') {
    return json({ ok: false, similar: r.similar.map(({ id, name, city, status, via }) => ({ id, name, city, status, via })) });
  }
  const message = r.code === 'forbidden' ? 'No tienes permiso para dar de alta clientes. Pídeselo a Administración.' : r.message;
  return json({ ok: false, error: message }, STATUS[r.code] ?? 400);
}
