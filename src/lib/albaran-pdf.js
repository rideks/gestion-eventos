// El albarán en PDF (pdf-lib, MIT): A4, con la misma información y el mismo orden que la vista imprimible.
// Recibe el albarán ya en textos (albaranView, src/lib/albaranes.js) y devuelve los bytes del PDF.
//
// Se genera en el navegador de quien lo descarga (la página carga este módulo sólo al pulsar «Descargar PDF»):
// así no gasta CPU del Worker de Cloudflare (en el plan gratuito, 10 ms por petición; un PDF cuesta bastante más
// la primera vez). El módulo no depende del navegador: se prueba en Node y podría ir en el servidor.
//
// Letra Helvetica de serie (sin incrustar fuentes): admite los acentos, la ñ, el € y los signos del castellano.
// Lo que no admite (→, emojis, otros alfabetos) se cambia por un equivalente o por «?».
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

const A4 = [595.28, 841.89];
const M = 40; // margen (14 mm)
const INK = rgb(0.067, 0.067, 0.067);
const MUTED = rgb(0.42, 0.42, 0.45);
const LINE = rgb(0.886, 0.886, 0.902);
const BRAND = rgb(1, 0.812, 0);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const DANGER = rgb(0.78, 0.12, 0.12);
const SWAP = { '→': '->', '←': '<-', ' ': ' ', ' ': ' ', ' ': ' ', '−': '-', '‑': '-' };

/**
 * @param {ReturnType<typeof import('./albaranes.js').albaranView>} view
 * @param {{ logo?: ArrayBuffer | Uint8Array | null }} [options] logo: el PNG de la marca (blanco y amarillo, para fondo negro)
 * @returns {Promise<Uint8Array>}
 */
export async function albaranPdf(view, { logo = null } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${view.title} ${view.short}`);
  doc.setAuthor(view.issuer.name);
  doc.setCreator('Gestión de eventos');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const chars = new Set(font.getCharacterSet());
  const safe = (/** @type {unknown} */ text) => [...String(text ?? '')].map((c) => SWAP[c] ?? (chars.has(c.codePointAt(0) ?? 0) || c === '\n' ? c : '?')).join('');
  let image = null;
  if (logo) {
    try {
      image = await doc.embedPng(logo);
    } catch {
      image = null; // sin logo, mejor que sin PDF
    }
  }

  const [W, H] = A4;
  const pages = [];
  let page;
  let y = 0;

  /** Líneas de un texto que caben en ese ancho (corta por palabras; una palabra muy larga, por letras) */
  const wrap = (/** @type {string} */ text, f, /** @type {number} */ size, /** @type {number} */ width) => {
    const out = [];
    for (const para of safe(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) <= width) {
          line = next;
          continue;
        }
        if (line) out.push(line);
        line = word;
        while (f.widthOfTextAtSize(line, size) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && f.widthOfTextAtSize(line.slice(0, cut), size) > width) cut -= 1;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      out.push(line);
    }
    return out;
  };
  const text = (/** @type {string} */ s, /** @type {number} */ x, /** @type {number} */ yy, { f = font, size = 9, color = INK, align = 'left', width = 0 } = {}) => {
    const t = safe(s);
    const w = f.widthOfTextAtSize(t, size);
    const dx = align === 'right' ? width - w : align === 'center' ? (width - w) / 2 : 0;
    page.drawText(t, { x: x + dx, y: yy, size, font: f, color });
  };

  const newPage = (/** @type {boolean} */ first) => {
    page = doc.addPage(A4);
    pages.push(page);
    if (first) {
      // Cabecera negra con la marca y el número, como la de la vista imprimible
      page.drawRectangle({ x: 0, y: H - 84, width: W, height: 84, color: BLACK });
      page.drawRectangle({ x: 0, y: H - 87, width: W, height: 3, color: BRAND });
      if (image) {
        const h = 56;
        page.drawImage(image, { x: M, y: H - 14 - h, width: (image.width / image.height) * h, height: h });
      } else {
        text(view.issuer.name, M, H - 48, { f: bold, size: 14, color: WHITE });
      }
      text(view.title.toUpperCase(), M, H - 44, { f: bold, size: 24, color: BRAND, align: 'right', width: W - 2 * M });
      text(view.number, M, H - 64, { f: bold, size: 12, color: WHITE, align: 'right', width: W - 2 * M });
      y = H - 87 - 26;
    } else {
      text(`${view.title} ${view.short} · continuación`, M, H - M, { f: bold, size: 9, color: MUTED });
      y = H - M - 20;
    }
  };
  const room = (/** @type {number} */ h) => {
    if (y - h < 64) newPage(false);
  };

  newPage(true);

  // Emisor y cliente
  const colW = (W - 2 * M - 24) / 2;
  let bottom = y;
  for (const [i, [label, party]] of [['EMISOR', view.issuer], ['CLIENTE', view.client]].entries()) {
    const x = M + i * (colW + 24);
    let yy = y;
    text(label, x, yy, { f: bold, size: 7.5, color: MUTED });
    yy -= 14;
    for (const l of wrap(party.name, bold, 10, colW)) {
      text(l, x, yy, { f: bold, size: 10 });
      yy -= 13;
    }
    for (const line of party.lines) {
      for (const l of wrap(line, font, 9, colW)) {
        text(l, x, yy, { size: 9 });
        yy -= 12;
      }
    }
    bottom = Math.min(bottom, yy);
  }
  y = bottom - 8;

  // Fecha, reserva, revisión y pasajeros, en una caja
  const cellW = (W - 2 * M) / view.meta.length;
  page.drawRectangle({ x: M, y: y - 36, width: W - 2 * M, height: 36, borderColor: LINE, borderWidth: 1 });
  view.meta.forEach(([k, v], i) => {
    const x = M + i * cellW;
    if (i) page.drawLine({ start: { x, y }, end: { x, y: y - 36 }, thickness: 1, color: LINE });
    text(k.toUpperCase(), x + 9, y - 13, { size: 7, color: MUTED });
    text(v, x + 9, y - 27, { f: bold, size: 10 });
  });
  y -= 52;

  if (view.subject) {
    for (const l of wrap(view.subject, bold, 10.5, W - 2 * M)) {
      room(14);
      text(l, M, y, { f: bold, size: 10.5 });
      y -= 14;
    }
  }
  if (view.passengers) {
    for (const l of wrap(`Pasajeros: ${view.passengers}`, font, 9, W - 2 * M)) {
      room(12);
      text(l, M, y, { size: 9, color: MUTED });
      y -= 12;
    }
  }
  y -= 8;

  // Los servicios, por bloque: cada uno con su PVP y el subtotal del bloque
  const pvpW = 90;
  const conceptW = W - 2 * M - pvpW - 16;
  for (const g of view.groups) {
    room(22 + 34);
    page.drawRectangle({ x: M, y: y - 18, width: W - 2 * M, height: 18, color: INK });
    text(g.label.toUpperCase(), M + 8, y - 12.5, { f: bold, size: 8.5, color: WHITE });
    text('PVP', M, y - 12.5, { f: bold, size: 8.5, color: WHITE, align: 'right', width: W - 2 * M - 8 });
    y -= 18 + 13;
    for (const r of g.rows) {
      const concept = wrap(r.concept, bold, 9.5, conceptW);
      const details = [r.detail, r.who].filter(Boolean).flatMap((s) => wrap(s, font, 8.5, conceptW));
      room(concept.length * 12 + details.length * 11 + 8);
      text(r.pvp, M, y, { f: bold, size: 9.5, align: 'right', width: W - 2 * M - 8 });
      for (const l of concept) {
        text(l, M + 8, y, { f: bold, size: 9.5 });
        y -= 12;
      }
      for (const l of details) {
        text(l, M + 8, y, { size: 8.5, color: MUTED });
        y -= 11;
      }
      y -= 2;
      page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.6, color: LINE });
      y -= 7;
    }
    room(16);
    text(`Subtotal ${g.label.toLowerCase()}`, M, y, { f: bold, size: 9, color: MUTED, align: 'right', width: W - 2 * M - pvpW - 8 });
    text(g.subtotal, M, y, { f: bold, size: 9.5, align: 'right', width: W - 2 * M - 8 });
    y -= 24;
  }

  // PVP total, en amarillo, y a su izquierda la nota (y si está anulado, por qué)
  const boxW = 230;
  const noteW = W - 2 * M - boxW - 20;
  const notes = [
    ...(view.voided ? wrap(view.voided, bold, 9, noteW).map((l) => ({ l, f: bold, color: DANGER })) : []),
    ...wrap(view.note, font, 8.5, noteW).map((l) => ({ l, f: font, color: MUTED })),
  ];
  room(Math.max(34, notes.length * 11 + 4));
  page.drawRectangle({ x: W - M - boxW, y: y - 26, width: boxW, height: 30, color: BRAND });
  text('PVP total', W - M - boxW + 12, y - 15, { f: bold, size: 11 });
  text(view.total, W - M - boxW, y - 15, { f: bold, size: 13, align: 'right', width: boxW - 12 });
  notes.forEach(({ l, f, color }, i) => text(l, M, y - 6 - i * 11, { f, size: f === bold ? 9 : 8.5, color }));

  // Pie en todas las hojas y, si es un borrador o está anulado, el sello cruzado
  pages.forEach((p, i) => {
    page = p;
    page.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.6, color: LINE });
    for (const [j, l] of wrap(view.foot, font, 7.5, W - 2 * M - 80).entries()) text(l, M, 28 - j * 9, { size: 7.5, color: MUTED });
    text(`Página ${i + 1} de ${pages.length}`, M, 28, { size: 7.5, color: MUTED, align: 'right', width: W - 2 * M });
    if (view.stamp) {
      const s = safe(view.stamp.toUpperCase());
      const size = 96;
      const w = bold.widthOfTextAtSize(s, size);
      const a = (24 * Math.PI) / 180;
      page.drawText(s, {
        x: W / 2 - (w / 2) * Math.cos(a) - (size / 3) * Math.sin(a), y: H * 0.46 + (w / 2) * Math.sin(a) - (size / 3) * Math.cos(a),
        size, font: bold, color: DANGER, opacity: 0.12, rotate: degrees(-24),
      });
    }
  });
  return doc.save();
}
