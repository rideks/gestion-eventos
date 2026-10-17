// Importes: siempre en CÉNTIMOS (enteros). 2.381,82 € → 238182.
// Así las sumas del cierre cuadran al céntimo (con decimales, 0,1 + 0,2 ≠ 0,3).

const MAX_CENTS = 99_999_999_999; // 999.999.999,99 €

/** ¿Los grupos de miles están bien escritos? '21.400' sí · '2.14' no */
const validGroups = (int, sep) => {
  const parts = int.split(sep);
  return parts[0].length >= 1 && parts[0].length <= 3 && parts.slice(1).every((p) => p.length === 3);
};

/**
 * Lee un importe tal y como lo escribe la gente → céntimos.
 *   '21.400' · '21400' · '21.400,50' · '1983.47' · '-232,55' · '2.620,00 €'
 * '' → null · algo que no es un importe → NaN
 */
export function parseAmount(value) {
  let s = String(value ?? '').trim().replace(/[\s €]/g, '');
  if (s === '') return null;
  let sign = 1;
  if (/^[-−]/.test(s)) {
    sign = -1;
    s = s.slice(1);
  }
  if (!/^\d[\d.,]*$/.test(s)) return Number.NaN;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let int = s;
  let dec = '';

  if (lastComma >= 0 && lastDot >= 0) {
    // Los dos: el último es el decimal (español: 1.983,47 · inglés: 1,983.47)
    const decSep = lastComma > lastDot ? ',' : '.';
    const thouSep = decSep === ',' ? '.' : ',';
    int = s.slice(0, s.lastIndexOf(decSep));
    dec = s.slice(s.lastIndexOf(decSep) + 1);
    if (int.includes(decSep) || !validGroups(int, thouSep)) return Number.NaN;
    int = int.split(thouSep).join('');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    if (parts.length === 2 && tail.length >= 1 && tail.length <= 2) {
      // Un separador con 1-2 cifras detrás: decimales ('1983,47' · '1983.5')
      [int, dec] = parts;
    } else if (validGroups(s, sep)) {
      // Separadores de miles ('21.400' · '1.250.000')
      int = parts.join('');
    } else {
      return Number.NaN;
    }
  }
  if (!/^\d+$/.test(int) || !/^\d{0,2}$/.test(dec)) return Number.NaN;
  const cents = Number(int) * 100 + Number(dec.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return Number.NaN;
  return sign * cents;
}

const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const NUM = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });

/** 238182 → '2.381,82 €' */
export const eur = (cents) => EUR.format((cents ?? 0) / 100);

/** 238182 → '2.381,82' (sin símbolo, para tablas) */
export const num = (cents) => NUM.format((cents ?? 0) / 100);

/** Para el valor de un <input>: 238182 → '2381,82' · 240000 → '2400' · null → '' */
export function amountInput(cents) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '';
  const abs = Math.abs(cents);
  const txt = abs % 100 ? (abs / 100).toFixed(2).replace('.', ',') : String(abs / 100);
  return cents < 0 ? `-${txt}` : txt;
}

/** Para exportar a Excel en español: 238182 → '2381,82' */
export const csvAmount = (cents) => ((cents ?? 0) / 100).toFixed(2).replace('.', ',');

// El IVA (tipos y desglose por líneas) está en src/lib/vat.js

/** Porcentaje con una cifra decimal: 0.6347 → '63,5 %' */
export function pct(part, whole) {
  if (!whole) return '—';
  return `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format((part / whole) * 100)} %`;
}

/** Proporción acotada entre 0 y 1 (para barras de progreso) */
export const ratio = (part, whole) => (whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0);
