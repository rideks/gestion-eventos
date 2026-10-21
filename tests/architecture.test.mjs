// Reglas de la arquitectura por capas (ARQUITECTURA.md), comprobadas en cada `npm test`:
//   páginas → servicios → repositorios → base de datos, y la lógica pura (src/lib) sin base de datos.
// Lo que todavía no se ha pasado a capas está en las listas LEGACY: sólo pueden encoger. Si una página
// o un módulo nuevo hace consultas por su cuenta, esta prueba falla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(js|astro|mjs)$/.test(f) ? [p] : [];
});
const rel = (p) => relative(SRC, p).replaceAll('\\', '/');
const read = (p) => readFileSync(p, 'utf8');
// Escribir SQL = preparar una sentencia. (Los servicios sí juntan en un db.batch las sentencias de los
// repositorios: es la transacción del caso de uso.)
const SQL = /\.prepare\(/;
const imports = (code, what) => new RegExp(`from\\s+['"][^'"]*${what}`).test(code);
const all = files(SRC);

// Deuda conocida: módulos y páginas que aún hacen SQL directamente (se irán pasando a repos y servicios)
const LEGACY_LIB = ['lib/app.js', 'lib/auth.js', 'lib/data.js', 'lib/invoicing.js', 'lib/users.js'];
const LEGACY_PAGES = [
  'ajustes.astro', 'archivos/[id]/[name].js', 'buscar.astro', 'cuenta.astro', 'expedientes/[id]/cierre.astro', 'expedientes/[id]/cobros.astro',
  'expedientes/[id]/editar.astro', 'expedientes/[id]/facturas/[fid].astro', 'expedientes/[id]/facturas/[fid]/documento.astro',
  'expedientes/[id]/facturas/nueva.astro', 'expedientes/[id]/index.astro',
  'expedientes/[id]/po/[poid].astro', 'expedientes/[id]/presupuesto.astro', 'expedientes/nuevo.astro', 'index.astro',
  'login.astro', 'registro.astro', 'usuarios/index.astro', 'usuarios/roles/index.astro',
].map((p) => `pages/${p}`);

test('el SQL sólo está en los repositorios (y en lo que aún no se ha pasado a capas)', () => {
  const withSql = all.map(rel).filter((p) => !p.startsWith('repos/') && p !== 'worker.js' && SQL.test(read(join(SRC, p))));
  const unexpected = withSql.filter((p) => !LEGACY_LIB.includes(p) && !LEGACY_PAGES.includes(p));
  assert.deepEqual(unexpected, [], 'Mueve estas consultas a src/repos/ y llámalas desde un servicio');
});

test('los servicios no hacen consultas ni dependen de Cloudflare (salvo el puente con las páginas)', () => {
  for (const p of all.filter((f) => rel(f).startsWith('services/'))) {
    const code = read(p);
    assert.ok(!SQL.test(code), `${rel(p)}: el SQL va en src/repos/`);
    if (rel(p) !== 'services/context.js') assert.ok(!code.includes('cloudflare:workers'), `${rel(p)}: usa el contexto (ctx), no env`);
  }
});

test('los repositorios no deciden permisos ni dependen de los servicios', () => {
  for (const p of all.filter((f) => rel(f).startsWith('repos/'))) {
    const code = read(p);
    assert.ok(!/\bcan\(/.test(code) && !imports(code, '/services/') && !imports(code, 'lib/app.js') && !code.includes('cloudflare:workers'), rel(p));
  }
});

// Áreas ya en capas: sus páginas sólo usan servicios (cada área nueva se añade aquí)
const LAYERED = ['pages/proveedores/', 'pages/clientes/', 'pages/pagos.astro', 'pages/cobros.astro', 'pages/expedientes/index.astro', 'pages/expedientes/[id]/pagos', 'pages/viajes/', 'pages/preferencias/', 'pages/usuarios/roles/[id].astro'];

test('las páginas de las áreas en capas (Proveedores, Contratos, Clientes, Pagos, Business Travel) sólo hablan con los servicios', () => {
  for (const p of all.filter((f) => LAYERED.some((dir) => rel(f).startsWith(dir)))) {
    const code = read(p);
    assert.ok(!SQL.test(code) && !code.includes('cloudflare:workers') && !imports(code, '/repos/') && !imports(code, 'lib/data.js'), `${rel(p)}: usa src/services/`);
  }
});

test('la deuda sólo encoge: lo que ya está en capas no vuelve a la lista', () => {
  // Si una página o un módulo de la lista ya no hace SQL, hay que quitarlo de LEGACY (así no se vuelve atrás)
  const clean = [...LEGACY_LIB, ...LEGACY_PAGES].filter((p) => !SQL.test(read(join(SRC, p))));
  assert.deepEqual(clean, [], 'Ya no tienen SQL: quítalos de LEGACY_LIB / LEGACY_PAGES');
});
