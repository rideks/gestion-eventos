// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

const TURNSTILE = 'https://challenges.cloudflare.com';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),

  // Las sesiones van en D1 (src/lib/auth.js): sin sesiones de Astro (no hace falta KV)
  session: false,

  // Sin la barra de herramientas de Astro en desarrollo (tapa botones)
  devToolbar: { enabled: false },

  security: {
    // Astro rechaza POST de formularios con Origin distinto (CSRF).
    // Además, src/middleware.js comprueba Sec-Fetch-Site / Origin en todo lo que no sea GET.
    checkOrigin: true,

    // CSP estricta: cada <script>/<style> inline lleva su hash
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        `connect-src 'self' ${TURNSTILE}`,
        `frame-src 'self' ${TURNSTILE}`,
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      scriptDirective: { resources: ["'self'", TURNSTILE] },
      styleDirective: { resources: ["'self'"] },
    },
  },

  vite: {
    tsconfig: './tsconfig.json',
  },

  build: {
    inlineStylesheets: 'never',
  },
});
