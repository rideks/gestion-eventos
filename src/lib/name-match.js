// Comparar nombres de proveedores y clientes: para buscar en los selectores y para avisar, antes de dar
// de alta uno nuevo, de los que ya existen con un nombre parecido («Barceló Valladolid», «Hotel Barcelo
// Valladolid S.L.», «Barcelo Valadolid»; «BMW», «BMW Ibérica S.A.»…). Sin dependencias: se usa en el
// servidor y en el navegador.

/** Minúsculas, sin acentos ni signos, espacios simples */
export const fold = (text) => String(text ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

// Palabras que no distinguen a uno de otro (tipo de negocio, forma jurídica, país, artículos)
const GENERIC = new Set([
  'hotel', 'hoteles', 'hostal', 'apartamentos', 'aparthotel', 'restaurante', 'rest', 'catering',
  'grupo', 'group', 'sl', 'slu', 'sa', 'sau', 'sll', 'scp', 'cb', 's', 'l', 'u', 'a', 'iberica', 'espana', 'spain',
  'el', 'la', 'los', 'las', 'de', 'del', 'y', 'e', 'en', 'the', 'and',
]);

/** Las palabras que identifican al proveedor (si todas son genéricas, se quedan todas) */
export function nameTokens(name) {
  const all = fold(name).split(' ').filter(Boolean);
  const own = all.filter((t) => !GENERIC.has(t));
  return own.length ? own : all;
}

/** Distancia de edición (letras que hay que cambiar, quitar o poner) */
export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Erratas que se aceptan según lo largo que sea lo comparado
const slack = (len) => (len >= 9 ? 2 : len >= 5 ? 1 : 0);
const close = (a, b) => levenshtein(a, b) <= slack(Math.min(a.length, b.length));

/**
 * Cuánto se parecen dos nombres: 3 = el mismo escrito de otra forma (acentos, mayúsculas, «Hotel»,
 * «S.L.», orden de las palabras) · 2 = una errata · 1 = uno contiene al otro (le falta o le sobra
 * alguna palabra, aunque tenga alguna errata) · 0 = distintos.
 */
export function nameSimilarity(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const sa = [...ta].sort().join(' ');
  const sb = [...tb].sort().join(' ');
  if (sa === sb || ta.join('') === tb.join('')) return 3;
  if (close(ta.join(''), tb.join(''))) return 2;
  // Cada palabra del nombre más corto está (o casi) en el otro
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const words = short.filter((t) => t.length >= 3);
  if (words.length && words.length === short.length && words.every((t) => long.some((u) => u === t || (t.length >= 5 && close(t, u))))) return 1;
  return 0;
}

/**
 * Los que tienen un nombre parecido a `name`, los más parecidos primero.
 * candidates: [{ id, name, aliases?: string[] }] → [{ ...candidato, score, via? }] (via = el nombre anterior que se parece)
 */
export function similarNames(name, candidates, limit = 5) {
  const out = [];
  for (const c of candidates) {
    let best = { score: nameSimilarity(name, c.name), via: null };
    for (const alias of c.aliases ?? []) {
      const score = nameSimilarity(name, alias);
      if (score > best.score) best = { score, via: alias };
    }
    if (best.score > 0) out.push({ ...c, score: best.score, via: best.via });
  }
  return out.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name, 'es')).slice(0, limit);
}

/** ¿Encaja con lo escrito en el buscador? (todas las palabras, en el nombre, nombres anteriores, tipo o ciudad) */
export function matchesQuery(option, query) {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = fold([option.name, ...(option.aliases ?? []), option.type, option.city].filter(Boolean).join(' '));
  return words.every((w) => hay.includes(w));
}
