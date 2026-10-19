// Guarda las columnas que alguien quiere ver en una tabla (botón «Columnas») o la vista (tarjetas o tabla) y vuelve
// a la misma página.
// Las reglas (qué columnas existen y cuáles puede ver cada uno) están en src/services/prefs.js.
import { readForm } from '../../lib/app.js';
import { serviceContext } from '../../services/context.js';
import * as prefs from '../../services/prefs.js';

/** Sólo se vuelve a una página de la aplicación (nunca a otra web) */
const safeBack = (v) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') ? v : '/');

export async function POST(Astro) {
  const form = await readForm(Astro.request);
  const back = safeBack(form?.get('volver'));
  const intent = form?.get('intent');
  const r = await prefs.saveTable(serviceContext(Astro), String(form?.get('tabla') ?? ''), intent === 'view' ? { view: form?.get('vista') } : {
    columns: form ? form.getAll('columnas') : [],
    per: form?.get('por'),
    reset: intent === 'reset',
  });
  const sep = back.includes('?') ? '&' : '?';
  if (r.ok && intent === 'view') return Astro.redirect(back, 303); // cambiar de vista no necesita aviso
  return Astro.redirect(r.ok ? `${back}${sep}ok=columnas` : `${back}${sep}aviso=permiso`, 303);
}
