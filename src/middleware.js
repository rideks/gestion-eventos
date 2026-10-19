// Middleware global: CSRF, sesión obligatoria y cabeceras de seguridad.
// Toda la aplicación es privada: sin sesión sólo se ven el acceso y el alta por invitación.
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { getSession, SESSION_COOKIE, sessionCookieOptions } from './lib/auth.js';
import { applySecurityHeaders, isTrustedMutation, rateLimit } from './lib/security.js';
import { navCounts } from './lib/data.js';
import { can } from './lib/app.js';
import { sectionPermission } from './lib/permissions.js';
import { today } from './lib/dates.js';

const PUBLIC = new Set(['/login', '/registro']);
const ASSETS = new Set(['/favicon.png', '/apple-touch-icon.png', '/robots.txt']);
const isAsset = (path) => path.startsWith('/_astro/') || path.startsWith('/brand/') || ASSETS.has(path);

function withHeaders(response, url) {
  try {
    return applySecurityHeaders(response, { url });
  } catch {
    // Algunas respuestas tienen cabeceras inmutables: se clonan
    return applySecurityHeaders(new Response(response.body, response), { url });
  }
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { request, url, cookies, locals } = ctx;
  const path = url.pathname;
  if (isAsset(path)) return next();

  // 1. CSRF: nada que modifique datos puede venir de otra web
  if (!isTrustedMutation(request, url)) {
    return withHeaders(new Response('Petición bloqueada: origen no permitido.', { status: 403 }), url);
  }
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
    return withHeaders(new Response('Método no permitido', { status: 405 }), url);
  }

  // 2. Sesión
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = await getSession(env.DB, token);
    if (session) {
      locals.user = session.user;
      locals.sessionId = session.sessionId;
      if (session.touched) cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    } else {
      cookies.delete(SESSION_COOKIE, { path: '/' });
    }
  }

  if (!locals.user && !PUBLIC.has(path)) {
    // Tras entrar, vuelve a la página que se quería ver (sólo rutas internas)
    const back = request.method === 'GET' && path !== '/' ? `?volver=${encodeURIComponent(path + url.search)}` : '';
    return withHeaders(ctx.redirect(`/login${back}`, 302), url);
  }

  // 3. Permiso de la sección: sin él no se llega ni a la página (ni por URL ni por formulario).
  //    El acceso y el alta son públicos: cada una sabe qué hacer si ya hay sesión.
  if (locals.user && !PUBLIC.has(path)) {
    const need = sectionPermission(path);
    if (need === null || (need && !can(locals.user, need))) {
      return withHeaders(ctx.redirect('/?aviso=permiso', 303), url);
    }
  }

  // 4. Límite de escrituras por usuario (evita abusos si alguien roba una sesión)
  if (locals.user && request.method === 'POST' && !(await rateLimit(env.RL_WRITE, `w:${locals.user.id}`))) {
    return withHeaders(new Response('Demasiadas acciones seguidas. Espera un minuto y vuelve a intentarlo.', {
      status: 429, headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' },
    }), url);
  }

  // 5. Los contadores del menú se piden ya, a la vez que los datos de la página (la plantilla los espera)
  if (can(locals.user, 'expedientes') && request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
    locals.counts = navCounts(env.DB, today()).catch(() => null);
  }

  return withHeaders(await next(), url);
});
