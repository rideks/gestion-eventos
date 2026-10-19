// Puente entre las páginas (Astro) y los servicios.
//   serviceContext(Astro): con qué base de datos y almacenamiento, quién lo pide y qué día es
//   failure(Astro, result, back): qué hace la página con un resultado fallido
// Es lo único de src/services que depende de Cloudflare: los servicios se prueban con otro contexto
// (tests/helpers/context.mjs) sin navegador ni servidor.
import { env } from 'cloudflare:workers';
import { actor } from '../lib/app.js';
import { today } from '../lib/dates.js';

/** @returns {import('./types').Context} */
export function serviceContext(Astro) {
  return { db: env.DB, bucket: env.DOCS, user: Astro.locals.user, actor: actor(Astro), now: today() };
}

/**
 * Sin permiso → vuelve a `back` con el aviso de permiso; no existe → 404.
 * El resto (formulario, conflicto) se enseña en la página: devuelve null y deja la respuesta en 400.
 */
export function failure(Astro, result, back) {
  if (result.code === 'forbidden') return Astro.redirect(`${back}${back.includes('?') ? '&' : '?'}aviso=permiso`, 303);
  if (result.code === 'not_found') return Astro.rewrite('/404');
  Astro.response.status = 400;
  return null;
}
