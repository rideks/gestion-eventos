// El albarán de Business Travel (lógica pura y PDF): lo que dice (sin el fee), cuándo ha cambiado la reserva,
// los textos del documento, el número y el PDF de pdf-lib (que no se rompe con letras raras ni con muchas líneas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { albaranContent, sameContent, contentChanges, albaranView, albaranFileName, albaranCounterKey } from '../src/lib/albaranes.js';
import { numberParts, formatNumber, patternProblem } from '../src/lib/documents.js';
import { albaranPdf } from '../src/lib/albaran-pdf.js';

const flat = (s) => s.replace(/\s/g, ' ');
const booking = { reference: 'BT-2026-0009', title: 'Congreso en Sevilla' };
const client = { name: 'López', legal_name: 'María López Serrano', title: 'Dra.', kind: 'persona', tax_id: '12345678Z', fiscal_address: 'Calle Mayor 1, Sevilla', email: 'maria@example.com' };
const passengers = [{ id: 1, title: 'Dra.', first_name: 'María', last_name: 'López' }, { id: 2, title: null, first_name: 'Ana', last_name: 'Ruiz' }];
const lines = [
  { kind: 'alojamiento', supplier: 'Booking', description: 'Hotel Alfonso XIII', start_date: '2026-11-04', end_date: '2026-11-06', locator: '4412', details: null, base_cents: 20000, total_cents: 22000, fee_cents: 1500, pvp_cents: 23500, passenger_ids: [1, 2] },
  { kind: 'transporte', supplier: 'Iryo', description: 'Madrid → Sevilla', start_date: '2026-11-04', end_date: null, locator: 'IRY1', details: 'Clase Singular', base_cents: 9000, total_cents: 9900, fee_cents: 1000, pvp_cents: 10900, passenger_ids: [2, 1] },
];
const content = albaranContent({ booking, client, passengers, lines });

test('lo que dice: bloques en su orden, PVP con el fee dentro y sin rastro del fee ni del IVA', () => {
  assert.deepEqual(content.groups.map((g) => [g.kind, g.subtotal_cents]), [['transporte', 10900], ['alojamiento', 23500]]);
  assert.equal(content.total_cents, 34400);
  assert.deepEqual(content.groups[0].lines[0].passengers, ['Ana Ruiz', 'Dra. María López']);
  assert.deepEqual(content.client, { name: 'Dra. María López Serrano', tax_id: '12345678Z', address: 'Calle Mayor 1, Sevilla', email: 'maria@example.com' });
  assert.doesNotMatch(JSON.stringify(content), /fee|base_cents|total_cents":(9900|22000)/);
  // Una empresa: su nombre fiscal, sin tratamiento; el email de facturación antes que el de contacto
  const company = albaranContent({ booking, client: { name: 'ROCHE FARMA', legal_name: 'Roche Farma, S.A.', kind: 'empresa', title: 'Dr.', billing_email: 'fact@roche.example', email: 'x@roche.example' }, passengers, lines });
  assert.equal(company.client.name, 'Roche Farma, S.A.');
  assert.equal(company.client.email, 'fact@roche.example');
});

test('¿ha cambiado la reserva? Sólo cuenta lo que sale en el documento', () => {
  const stored = { company: { name: 'Antes, S.L.' }, ...content };
  assert.ok(sameContent(stored, { company: { name: 'Después, S.L.' }, ...content }), 'el emisor no es un cambio de la reserva');
  // Cambiar el fee sin tocar el PVP, o el importe sin IVA, no cambia el albarán
  assert.ok(sameContent(stored, albaranContent({ booking, client, passengers, lines: lines.map((l) => ({ ...l, fee_cents: 0, base_cents: 1 })) })));
  const pricier = albaranContent({ booking, client, passengers, lines: lines.map((l, i) => (i ? l : { ...l, pvp_cents: 25000 })) });
  assert.equal(sameContent(stored, pricier), false);
  assert.deepEqual(contentChanges(stored, pricier).map(flat), ['los servicios', 'el PVP total: 344,00 € → 359,00 €']);
  const renamed = albaranContent({ booking: { ...booking, title: 'Otro' }, client: { ...client, tax_id: 'X' }, passengers: passengers.slice(0, 1), lines });
  assert.deepEqual(contentChanges(stored, renamed), ['los datos del cliente', 'la descripción de la reserva', 'los pasajeros', 'los servicios']);
});

test('los textos del documento', () => {
  const v = albaranView({ company: { name: 'Seven Worlds, S.L.', taxId: 'B1', address: 'Madrid' }, ...content }, { number: 'ALB-2026-000007', revision: 2, issued_on: '2026-10-20', status: 'emitido' });
  assert.equal(v.number, 'ALB-2026-000007');
  assert.equal(v.stamp, null);
  assert.deepEqual(v.meta, [['Fecha de emisión', '20/10/2026'], ['Reserva', 'BT-2026-0009'], ['Revisión', '2'], ['Pasajeros', '2']]);
  assert.deepEqual({ ...v.groups[0].rows[0], pvp: flat(v.groups[0].rows[0].pvp) }, {
    concept: 'Iryo · Madrid → Sevilla', detail: 'Fecha de ida 04/11/2026 · Localizador IRY1 · Clase Singular', who: 'Pasajeros: Ana Ruiz, Dra. María López', pvp: '109,00 €',
  });
  assert.equal(v.groups[1].rows[0].detail, 'Check-in 04/11/2026 · Check-out 06/11/2026 · Nº de reserva 4412');
  assert.equal(flat(v.total), '344,00 €');
  assert.equal(v.fileName, 'Albaran-ALB-2026-000007-rev2.pdf');
  const draft = albaranView({ ...content, company: {} }, { draft: true });
  assert.equal(draft.stamp, 'Borrador');
  assert.equal(draft.issuer.name, 'Seven Worlds Events & Congresses');
  assert.equal(draft.issuer.lines[0], 'CIF: [pendiente]');
  assert.equal(albaranView(content, { number: 'X', status: 'anulado', void_reason: 'Duplicado' }).voided, 'Albarán anulado: Duplicado.');
  assert.equal(albaranFileName({ number: 'A26/000004' }), 'Albaran-A26-000004.pdf');
});

test('el número: formato, contador por año y las partes para componerlo en la base de datos', () => {
  assert.equal(formatNumber('ALB-{yyyy}-{n}', 1, 2026), 'ALB-2026-000001');
  assert.deepEqual(numberParts('ALB-{yyyy}-{n}', 2026), { prefix: 'ALB-2026-', suffix: '', digits: 6 });
  assert.deepEqual(numberParts('A{yy}/{n}/BT', 2027), { prefix: 'A27/', suffix: '/BT', digits: 6 });
  assert.equal(albaranCounterKey('ALB-{yyyy}-{n}', 2026), 'bt_albaran:2026');
  assert.equal(albaranCounterKey('ALB-{n}', 2026), 'bt_albaran');
  assert.match(patternProblem('', 'ALB-{yyyy}-{n}'), /por ejemplo ALB-\{yyyy\}-\{n\}/);
  assert.equal(patternProblem('ALB-{yyyy}-{n}'), null);
});

test('el PDF: A4 con su título, varias hojas si hace falta y sin romperse con letras que Helvetica no tiene', async () => {
  const view = albaranView({ company: { name: 'Seven Worlds, S.L.' }, ...content }, { number: 'ALB-2026-000007', issued_on: '2026-10-20', status: 'emitido' });
  const logo = readFileSync(new URL('../public/brand/logo.png', import.meta.url));
  const one = await PDFDocument.load(await albaranPdf(view, { logo }));
  assert.equal(one.getPageCount(), 1);
  assert.equal(one.getTitle(), 'Albarán ALB-2026-000007');
  assert.deepEqual(one.getPage(0).getSize(), { width: 595.28, height: 841.89 });
  // Muchos servicios, nombres en otros alfabetos y emojis; un logo que no es un PNG
  const many = { ...view, stamp: 'Borrador', groups: [{ ...view.groups[0], rows: Array.from({ length: 60 }, (_, i) => ({ ...view.groups[0].rows[0], concept: `Вокзал ✈️ 北京 ${i} ${'texto '.repeat(30)}` })) }] };
  const bytes = await albaranPdf(many, { logo: new Uint8Array([1, 2, 3]) });
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), '%PDF-');
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 3);
});
