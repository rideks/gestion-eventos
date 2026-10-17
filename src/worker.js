// Punto de entrada del Worker: Astro atiende las peticiones y aquí va la limpieza diaria (cron).
import { handle } from '@astrojs/cloudflare/handler';

export default {
  fetch: handle,

  async scheduled(_controller, env, ctx) {
    const now = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    ctx.waitUntil(
      env.DB.batch([
        // Sesiones caducadas o abandonadas (7 días sin uso)
        env.DB.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?').bind(now, now - 7 * DAY),
        // Intentos de login de más de un día
        env.DB.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(now - DAY),
        // Invitaciones usadas, anuladas o caducadas hace más de 90 días
        env.DB.prepare(
          'DELETE FROM invites WHERE (used_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at < ?) AND created_at < ?',
        ).bind(now, now - 90 * DAY),
        // Actividad general (accesos) de más de un año. La de los expedientes se guarda siempre.
        env.DB.prepare("DELETE FROM activity WHERE expediente_id IS NULL AND at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-365 days')"),
      ]).then(() => console.log('[cron] limpieza completada')),
    );
  },
};
