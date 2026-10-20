// Documentos que no se pierden (src/services/files.js → keepUploads): si al guardar hay un error, el documento
// elegido se guarda como temporal y vuelve al formulario; al reenviar se recupera como si se acabara de elegir.
// Sólo lo recupera quien lo subió, caduca a las 24 horas y, si todo sale bien, se borra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, memoryBucket, EMAILS } from './helpers/context.mjs';
import { keepUploads, KEPT, STAGED_HOURS } from '../src/services/files.js';
import * as payments from '../src/services/payments.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const PDF = (name = 'factura.pdf') => new File([new TextEncoder().encode('%PDF-1.4\n%prueba\n')], name, { type: 'application/pdf' });
const FAKE = () => new File([new TextEncoder().encode('esto no es un pdf')], 'falso.pdf', { type: 'application/pdf' });

function form(fields, files = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) f.append(k, x);
  for (const [k, file] of Object.entries(files)) f.append(k, file);
  return f;
}

const setup = async () => {
  const db = await testDb({ demo: true });
  const bucket = memoryBucket();
  const as = (role) => contextFor(db, EMAILS[role], { bucket, now: '2026-10-19' });
  const staged = () => db.rows('SELECT * FROM files WHERE staged_token IS NOT NULL');
  return { db, bucket, as, staged };
};
// Un pago al Hotel Alfonso XIII en el expediente 3, con su factura
const NEW = { intent: 'add', supplier: 'Hotel Alfonso XIII', supplier_id: '9', concept: 'Coffee break', due_date: '2026-11-01', status: 'pendiente', vl_base: '1.000', vl_rate: '1000', vl_total: '', doc_kind: 'factura', invoice_number: 'F-1' };

test('error al guardar: el documento queda como temporal (sin expediente) y vuelve con su ficha', { skip }, async () => {
  const { bucket, as, staged } = await setup();
  const ctx = as('eventos');
  const f = form({ ...NEW, vl_base: '' }, { file: PDF() });
  const up = await keepUploads(ctx, f, ['file', 'receipt']);
  const r = await payments.create(ctx, 3, f);
  assert.equal(r.ok, false);
  const kept = await up.keep();
  assert.deepEqual(Object.keys(kept), ['file'], 'sólo el campo con archivo');
  assert.equal(kept.file.name, 'factura.pdf');
  assert.match(kept.file.token, /^[A-Za-z0-9_-]{16,64}$/);
  const [row] = staged();
  assert.deepEqual([row.id, row.expediente_id, row.uploaded_by, row.staged_token], [kept.file.id, null, ctx.user.id, kept.file.token]);
  assert.ok(row.key.startsWith(`tmp/${ctx.user.id}/`) && bucket.files.has(row.key));
});

test('al reenviar: se recupera, se guarda en su sitio y el temporal se borra', { skip }, async () => {
  const { db, bucket, as, staged } = await setup();
  const ctx = as('eventos');
  const first = form({ ...NEW, vl_base: '' }, { file: PDF() });
  const kept = await (await keepUploads(ctx, first, ['file'])).keep();
  // El navegador no reenvía el archivo: sólo su clave
  const again = form({ ...NEW, [`file${KEPT}`]: kept.file.token });
  const up = await keepUploads(ctx, again, ['file']);
  assert.ok(up.restored.file, 'recuperado');
  assert.equal(again.get('file').name, 'factura.pdf');
  const r = await payments.create(ctx, 3, again);
  assert.ok(r.ok && !r.value.docError);
  await up.done();
  assert.equal(staged().length, 0, 'el temporal ya no está');
  const doc = db.one('SELECT f.* FROM payment_documents pd JOIN supplier_invoices d ON d.id = pd.document_id JOIN files f ON f.id = d.file_id WHERE pd.payment_id = ?', r.value.id);
  assert.deepEqual([doc.name, doc.expediente_id, doc.staged_token], ['factura.pdf', 3, null]);
  assert.equal(bucket.files.size, 1, 'en el almacén sólo queda el documento guardado');
});

test('con otro error al reenviar, sigue el mismo temporal (no se duplica)', { skip }, async () => {
  const { as, staged } = await setup();
  const ctx = as('eventos');
  const kept = await (await keepUploads(ctx, form({ ...NEW }, { file: PDF() }), ['file'])).keep();
  const again = form({ ...NEW, vl_base: '', [`file${KEPT}`]: kept.file.token });
  const up = await keepUploads(ctx, again, ['file']);
  assert.equal((await payments.create(ctx, 3, again)).ok, false);
  const next = await up.keep();
  assert.equal(next.file.token, kept.file.token);
  assert.equal(staged().length, 1);
});

test('un archivo nuevo sustituye al guardado; uno que no vale no se guarda', { skip }, async () => {
  const { as, staged } = await setup();
  const ctx = as('eventos');
  const kept = await (await keepUploads(ctx, form({}, { file: PDF() }), ['file'])).keep();
  const f = form({ [`file${KEPT}`]: kept.file.token }, { file: PDF('otra.pdf') });
  const up = await keepUploads(ctx, f, ['file']);
  assert.equal(up.restored.file, undefined);
  assert.equal(f.get('file').name, 'otra.pdf');
  const fake = await (await keepUploads(ctx, form({}, { file: FAKE() }), ['file'])).keep();
  assert.deepEqual(fake, {}, 'un PDF falso no se guarda (su error ya sale en el campo)');
  assert.equal(staged().length, 1);
});

test('sólo lo recupera quien lo subió, con una clave válida y antes de que caduque', { skip }, async () => {
  const { db, as } = await setup();
  const kept = await (await keepUploads(as('eventos'), form({}, { file: PDF() }), ['file'])).keep();
  const other = form({ [`file${KEPT}`]: kept.file.token });
  assert.equal((await keepUploads(as('administracion'), other, ['file'])).restored.file, undefined, 'otra persona no');
  assert.equal(other.get('file'), null);
  for (const bad of ['corta', "x' OR 1=1 --________", '../../exp/3/abcdefghijklmnop']) {
    assert.equal((await keepUploads(as('eventos'), form({ [`file${KEPT}`]: bad }), ['file'])).restored.file, undefined, bad);
  }
  const old = new Date(Date.now() - (STAGED_HOURS + 1) * 3600e3).toISOString();
  db.raw.prepare('UPDATE files SET staged_at = ? WHERE id = ?').run(old, kept.file.id);
  assert.equal((await keepUploads(as('eventos'), form({ [`file${KEPT}`]: kept.file.token }), ['file'])).restored.file, undefined, 'caducado');
});
