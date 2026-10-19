// Tablas de listado (Clientes, Proveedores, Contratos, Business Travel): qué columnas se ven, cómo se ordenan,
// qué filtros llevan y qué página se enseña. Todo sale de la URL (se puede compartir un enlace a una búsqueda) y de
// las preferencias de cada persona (las columnas que eligió y cuántas filas por página).
//
// Una tabla se define así (src/lib/tables.js):
//   { key: 'clientes', sort: 'name',
//     columns: [{ key, label, sort?: 'asc' | 'desc' (se puede ordenar; y en qué sentido al pulsarla primero),
//                 fixed?: true (siempre se ve), hidden?: true (oculta hasta que se elija), need?: 'permiso' | ['p1', 'p2'],
//                 num?: true (cifras: a la derecha) }],
//     filters: [{ key, label }] }   ← el nombre del parámetro en la URL; sus opciones las da cada página
// En la URL: q (buscador), un parámetro por filtro, orden + dir (columna y sentido), pagina y por (filas por página).
// Si la tabla tiene vistas (def.views: tarjetas o tabla), la que eligió cada persona; si no, la de por defecto.

export const PER_PAGE = [25, 50, 100];
export const DEFAULT_PER = 25;

/** Las columnas que puede ver esta persona (las que piden un permiso, sólo con él) */
export function allowedColumns(def, can) {
  return def.columns.filter((c) => !c.need || [].concat(c.need).every((p) => can(p)));
}

/**
 * Estado de la tabla a partir de la URL y las preferencias guardadas.
 * @param {any} def
 * @param {URLSearchParams} params
 * @param {{ prefs?: { columns?: string[], per?: number, view?: string } | null, can?: (permission: string) => boolean }} [options]
 */
export function tableState(def, params, { prefs = null, can = () => true } = {}) {
  const columns = allowedColumns(def, can);
  const allowed = new Set(columns.map((c) => c.key));
  // Orden: una columna que se pueda ordenar (aunque esté oculta) y su sentido
  const asked = columns.find((c) => c.sort && c.key === params.get('orden'));
  const sort = asked?.key ?? def.sort;
  const natural = columns.find((c) => c.key === sort)?.sort ?? 'asc';
  const dirParam = params.get('dir');
  const dir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : natural;
  // Las columnas elegidas (las que siguen permitidas) y las fijas; si no se ha elegido nada, las de por defecto.
  // Se ven ésas y, si está oculta, la columna por la que se ordena (para ver el orden)
  const saved = Array.isArray(prefs?.columns) ? new Set(prefs.columns.filter((k) => allowed.has(k))) : null;
  const chosen = columns.filter((c) => c.fixed || (saved ? saved.has(c.key) : !c.hidden)).map((c) => c.key);
  const visible = columns.filter((c) => chosen.includes(c.key) || c.key === sort).map((c) => c.key);
  // Buscador y filtros (los valores los comprueba cada servicio)
  const q = (params.get('q') ?? '').trim().slice(0, 80);
  /** @type {Record<string, string>} */
  const filters = {};
  for (const f of def.filters ?? []) {
    const v = (params.get(f.key) ?? '').trim().slice(0, 80);
    if (v) filters[f.key] = v;
  }
  // Página
  const perParam = Number(params.get('por'));
  const per = PER_PAGE.includes(perParam) ? perParam : PER_PAGE.includes(Number(prefs?.per)) ? Number(prefs?.per) : DEFAULT_PER;
  const page = Math.min(100000, Math.max(1, Math.floor(Number(params.get('pagina'))) || 1));
  const views = def.views ?? [];
  const view = views.includes(prefs?.view) ? prefs.view : def.view ?? 'tabla';
  return { key: def.key, q, filters, sort, dir, per, page, offset: (page - 1) * per, limit: per, columns, chosen, visible, view };
}

/** ¿Se ve esa columna? */
export const shows = (state, key) => state.visible.includes(key);

/** ¿Hay algo filtrado (buscador o filtros)? */
export const isFiltered = (state) => !!state.q || Object.keys(state.filters).length > 0;

/**
 * Páginas para la barra de abajo: «26–50 de 143» y los números (con huecos: 1 … 4 5 6 … 12)
 * @param {number} total
 * @param {{ page: number, per: number }} state
 */
export function pageInfo(total, { page, per }) {
  const last = Math.max(1, Math.ceil(total / per));
  const p = Math.min(Math.max(1, page), last);
  /** @type {(number | '…')[]} */
  const items = [];
  for (let i = 1; i <= last; i++) {
    if (i === 1 || i === last || Math.abs(i - p) <= 2) items.push(i);
    else if (items.at(-1) !== '…') items.push('…');
  }
  return {
    total, page: p, last, items,
    from: total ? (p - 1) * per + 1 : 0,
    to: Math.min(total, p * per),
    prev: p > 1 ? p - 1 : null,
    next: p < last ? p + 1 : null,
  };
}

/**
 * El enlace de la misma tabla cambiando algunos parámetros (null o '' los quita). Si no se cambia la página,
 * se vuelve a la primera (al cambiar filtros u orden). Los avisos (?ok=…) no se arrastran.
 * @param {URL} url
 * @param {Record<string, string | number | null | undefined>} changes
 */
export function hrefWith(url, changes) {
  const params = new URLSearchParams(url.search);
  for (const k of ['ok', 'aviso']) params.delete(k);
  if (!('pagina' in changes)) params.delete('pagina');
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined || v === '' || (k === 'pagina' && Number(v) === 1)) params.delete(k);
    else params.set(k, String(v));
  }
  const s = params.toString();
  return `${url.pathname}${s ? `?${s}` : ''}`;
}

/** Al pulsar la cabecera: la misma columna cambia de sentido; otra empieza en su sentido natural */
export function sortHref(url, state, col) {
  const dir = state.sort === col.key ? (state.dir === 'asc' ? 'desc' : 'asc') : (col.sort ?? 'asc');
  return hrefWith(url, { orden: col.key, dir });
}

/**
 * Las columnas elegidas en «Columnas», listas para guardar: sólo las que existen y puede ver (sin las fijas).
 * @param {any} def
 * @param {unknown[]} keys
 * @param {(permission: string) => boolean} can
 */
export function cleanColumns(def, keys, can) {
  const wanted = new Set(keys.map(String));
  return allowedColumns(def, can).filter((c) => !c.fixed && wanted.has(c.key)).map((c) => c.key);
}

/**
 * Ordenar en memoria (para las tablas que se calculan en el servidor sin SQL, p. ej. el estado de los contratos).
 * values: { columna: (fila) => valor }; los vacíos van siempre al final.
 */
export function sortRows(rows, values, sort, dir) {
  const get = values[sort];
  if (!get) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  const coll = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    const ex = x === null || x === undefined || x === '';
    const ey = y === null || y === undefined || y === '';
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
    return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : coll.compare(String(x), String(y)));
  });
}

/**
 * ORDER BY seguro para SQL: sólo columnas de la lista (`map`: columna → expresión SQL), con los vacíos al final
 * y un desempate fijo (para que la paginación no repita ni salte filas).
 * @param {Record<string, string>} map
 * @param {string} sort
 * @param {'asc' | 'desc'} dir
 * @param {string} fallback la columna por defecto
 * @param {string} tiebreak p. ej. 'c.id'
 */
export function orderBy(map, sort, dir, fallback, tiebreak) {
  const expr = map[sort] ?? map[fallback];
  const d = dir === 'desc' ? 'DESC' : 'ASC';
  return `(${expr}) IS NULL, ${expr} ${d}, ${tiebreak} ${d}`;
}
