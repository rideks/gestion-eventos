// Servicio de pagos contra una base SQLite en memoria con las migraciones y los datos de ejemplo: el orden
// de un pago (documento → justificante y pago → conforme), quién puede hacer cada cosa, los expedientes
// cerrados y lo que queda en la base y en el almacenamiento de archivos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, memoryBucket, EMAILS } from './helpers/context.mjs';
import * as payments from '../src/services/payments.js';
import { CARD_ONLY, LOCKED_MSG } from '../src/lib/actions.js';
import { RECEIPT_MISSING, PAID_LOCKED, WAITING_PAYMENT } from '../src/lib/finance.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const PDF = () => new File([new TextEncoder().encode('%PDF-1.4\n%prueba\n')], 'factura.pdf', { type: 'application/pdf' });
const FAKE = () => new File([new TextEncoder().encode('esto no es un pdf')], 'falso.pdf', { type: 'application/pdf' });

/** FormData como el de los formularios: campos (los repetidos, en listas) y archivos */
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
  const pay = (id) => db.one('SELECT * FROM payments WHERE id = ?', id);
  const count = (sql, ...p) => db.one(`SELECT COUNT(*) AS n FROM ${sql}`, ...p).n;
  return { db, bucket, as, pay, count };
};
// Un pago nuevo al Hotel Alfonso XIII (de la lista) en el expediente 3, 1.000 € + 10 % de IVA
const NEW = { intent: 'add', supplier: 'Hotel Alfonso XIII', supplier_id: '9', concept: 'Coffee break', due_date: '2026-11-01', status: 'pendiente', vl_base: '1.000', vl_rate: '1000', vl_total: '' };

test('bandeja: pendientes por fecha, pagados sin factura, por revisar y pagados; Técnico no entra', { skip }, async () => {
  const { as } = await setup();
  const r = await payments.inbox(as('eventos'), 'pendientes');
  assert.ok(r.ok);
  const due = r.value.pending.map((p) => p.due_date).filter(Boolean);
  assert.deepEqual(due, [...due].sort());
  assert.ok(r.value.pending.every((p) => p.status === 'pendiente' && p.exp_status !== 'cancelado'));
  assert.ok(r.value.noInvoice.some((p) => p.supplier === 'Catering Lazo'));
  assert.deepEqual(r.value.paid, []);
  const found = await payments.inbox(as('administracion'), 'pagados', 'Beatriz');
  assert.ok(found.value.paid.length > 0 && found.value.paid.every((p) => p.supplier === 'Hotel Beatriz Toledo'));
  assert.ok((await payments.inbox(as('administracion'), 'revisar')).value.review.some((d) => d.supplier === 'Mentimeter'));
  assert.equal((await payments.inbox(as('tecnico'), 'pendientes')).code, 'forbidden');
});

test('alta: proveedor de la lista, desglose de IVA y su documento (la factura, pendiente de revisar)', { skip }, async () => {
  const { db, bucket, as, pay, count } = await setup();
  const ctx = as('eventos');
  const added = count("activity WHERE action = 'payment.add' AND expediente_id = 3");
  const r = await payments.create(ctx, 3, form({ ...NEW, doc_kind: 'factura', invoice_number: 'F-1' }, { file: PDF() }));
  assert.ok(r.ok);
  assert.equal(r.value.docError, null);
  const p = pay(r.value.id);
  assert.deepEqual([p.supplier, p.supplier_id, p.base_cents, p.total_cents, p.status, p.created_by], ['Hotel Alfonso XIII', 9, 100000, 110000, 'pendiente', ctx.user.id]);
  const doc = db.one('SELECT d.* FROM payment_documents pd JOIN supplier_invoices d ON d.id = pd.document_id WHERE pd.payment_id = ?', p.id);
  assert.deepEqual([doc.kind, doc.number, doc.review, doc.supplier_id], ['factura', 'F-1', 'pendiente', 9]);
  assert.equal(bucket.files.size, 1);
  assert.equal(count("activity WHERE action = 'payment.add' AND expediente_id = 3"), added + 1);
  // Un proveedor que no está en la lista no se crea al escribirlo
  const unknown = await payments.create(ctx, 3, form({ ...NEW, supplier: 'Proveedor Inventado', supplier_id: '' }));
  assert.equal(unknown.code, 'invalid');
  assert.match(unknown.fields.supplier, /no está dado de alta/);
  // Con documento hay que decir si es factura o proforma
  assert.equal((await payments.create(ctx, 3, form({ ...NEW, invoice_number: 'F-2' }))).fields.doc_kind, 'Indica si el documento es una factura o una proforma.');
  assert.equal((await payments.create(ctx, 3, form({ ...NEW, vl_base: '' }))).fields.amount, 'Importe: escribe el importe sin IVA o con IVA');
});

test('alta ya pagada: Eventos sólo con tarjeta; por transferencia hace falta el justificante (y tiene que ser válido)', { skip }, async () => {
  const { bucket, as, pay, count } = await setup();
  const paid = { ...NEW, status: 'pagado', paid_on: '2026-10-18' };
  const before = count('payments');
  const ev = await payments.create(as('eventos'), 3, form({ ...paid, method: 'transferencia' }, { receipt: PDF() }));
  assert.deepEqual([ev.code, ev.message, ev.fields.method], ['invalid', CARD_ONLY, CARD_ONLY]);
  assert.ok((await payments.create(as('eventos'), 3, form({ ...paid, method: 'tarjeta' }))).ok);
  const ctx = as('administracion');
  const noReceipt = await payments.create(ctx, 3, form({ ...paid, method: 'transferencia' }));
  assert.deepEqual([noReceipt.message, noReceipt.fields.receipt], [RECEIPT_MISSING, RECEIPT_MISSING]);
  const fake = await payments.create(ctx, 3, form({ ...paid, method: 'transferencia' }, { receipt: FAKE() }));
  assert.equal(fake.code, 'invalid');
  assert.match(fake.fields.receipt, /^Justificante · «falso\.pdf» no parece un PDF/);
  assert.equal(count('payments'), before + 1); // ni el pago con el justificante falso
  const ok = await payments.create(ctx, 3, form({ ...paid, method: 'transferencia' }, { receipt: PDF() }));
  assert.ok(ok.ok);
  const p = pay(ok.value.id);
  assert.deepEqual([p.status, p.method, p.paid_on, typeof p.receipt_file_id], ['pagado', 'transferencia', '2026-10-18', 'number']);
  assert.equal(bucket.files.size, 1);
});

test('alta con un documento que no se puede subir: el pago queda y se avisa para reintentarlo en su ficha', { skip }, async () => {
  const { as, pay } = await setup();
  const r = await payments.create(as('eventos'), 3, form({ ...NEW, doc_kind: 'factura' }, { file: FAKE() }));
  assert.ok(r.ok);
  assert.match(r.value.docError, /no parece un PDF/);
  assert.equal(pay(r.value.id).supplier, 'Hotel Alfonso XIII');
});

test('varios pagos previstos de golpe', { skip }, async () => {
  const { db, as, count } = await setup();
  const ctx = as('eventos');
  const before = count('payments WHERE expediente_id = 3');
  const rows = { fc_supplier: ['Autocares Sevilla', 'Catering Lazo'], fc_supplier_id: ['2', '4'], fc_concept: ['2º autocar', 'Cena'], fc_due_date: ['', '2026-11-10'], fc_total: ['1.070', '2.200'], fc_rate: ['700', '1000'] };
  const r = await payments.createPlanned(ctx, 3, form(rows));
  assert.deepEqual(r.value, { count: 2 });
  assert.equal(count('payments WHERE expediente_id = 3'), before + 2);
  assert.equal(db.one("SELECT base_cents FROM payments WHERE concept = '2º autocar'").base_cents, 100000);
  assert.match(db.one("SELECT text FROM activity WHERE action = 'payment.add' ORDER BY id DESC LIMIT 1").text, /añadió 2 pagos previstos \(3\.270,00\s€\): Autocares Sevilla, Catering Lazo/);
  assert.equal((await payments.createPlanned(ctx, 3, form({ fc_supplier: [''], fc_total: [''], fc_rate: ['2100'] }))).message, 'Escribe al menos un pago (proveedor e importe).');
});

test('un expediente cerrado es de sólo lectura', { skip }, async () => {
  const { as } = await setup();
  const ctx = as('administracion');
  for (const r of [
    await payments.create(ctx, 2, form(NEW)),
    await payments.createPlanned(ctx, 2, form({ fc_supplier: 'Sonido Toledo', fc_total: '100', fc_rate: '2100' })),
    await payments.update(ctx, 2, 15, form(NEW)),
    await payments.addDocument(ctx, 2, 15, { doc_kind: 'proforma', invoice_number: 'P-1' }, null),
    await payments.unpay(ctx, 2, 15),
  ]) assert.deepEqual([r.code, r.message], ['conflict', LOCKED_MSG]);
  assert.equal((await payments.ficha(ctx, 2, 15)).value.editable, false);
});

test('marcar pagado: Eventos sólo con tarjeta y sin justificante; por transferencia, con justificante', { skip }, async () => {
  const { bucket, as, pay } = await setup();
  const ev = as('eventos');
  const body = { payment_id: '23', paid_on: '2026-10-18', method: 'transferencia' };
  assert.deepEqual([(await payments.markPaid(ev, body)).message], [CARD_ONLY]);
  assert.equal((await payments.markPaid(ev, { ...body, method: 'tarjeta' }, { receipt: PDF() })).code, 'forbidden');
  assert.ok((await payments.markPaid(ev, { ...body, method: 'tarjeta' })).ok);
  assert.deepEqual([pay(23).status, pay(23).method], ['pagado', 'tarjeta']);
  const adm = as('administracion');
  const hotel = { payment_id: '21', paid_on: '2026-10-18', method: 'transferencia' };
  assert.equal((await payments.markPaid(adm, hotel)).message, RECEIPT_MISSING);
  assert.equal((await payments.markPaid(adm, hotel, { expedienteId: 1, receipt: PDF() })).message, 'Ese pago ya no existe.');
  const r = await payments.markPaid(adm, hotel, { expedienteId: 3, receipt: PDF() });
  assert.deepEqual(r.value, { expedienteId: 3, kind: 'proveedor' });
  assert.equal(pay(21).status, 'pagado');
  assert.ok(pay(21).receipt_file_id && bucket.files.size === 1);
  assert.ok((await payments.markPaid(adm, hotel)).ok); // ya estaba pagado: no hace nada
  assert.equal((await payments.markPaid(adm, { payment_id: '15', paid_on: '2026-10-18', method: 'tarjeta' })).message, LOCKED_MSG);
  assert.equal((await payments.markPaid(adm, { payment_id: '25', paid_on: '' , method: 'tarjeta' })).code, 'invalid');
  assert.equal((await payments.markPaid(as('tecnico'), body)).code, 'forbidden');
});

test('un pago hecho no se modifica ni se borra; «Deshacer pagado» sólo con su permiso', { skip }, async () => {
  const { as, pay } = await setup();
  const ev = as('eventos');
  assert.deepEqual([(await payments.update(ev, 3, 24, form(NEW))).message], [PAID_LOCKED]);
  assert.deepEqual([(await payments.remove(ev, 3, 24)).message], [PAID_LOCKED]);
  assert.equal((await payments.unpay(ev, 3, 24)).code, 'forbidden');
  const r = await payments.unpay(as('administracion'), 3, 24);
  assert.ok(r.ok);
  assert.deepEqual([pay(24).status, pay(24).paid_on, pay(24).method], ['pendiente', null, null]);
  // Ya por pagar, sí se corrige
  const upd = await payments.update(ev, 3, 24, form({ ...NEW, supplier: 'Catering Lazo', supplier_id: '4', vl_base: '', vl_total: '2.420', vl_rate: '1000' }));
  assert.ok(upd.ok);
  assert.deepEqual([pay(24).total_cents, pay(24).base_cents], [242000, 220000]);
});

test('borrar: quien lo añadió o con permiso; nunca con una factura conforme; se llevan sus documentos sueltos', { skip }, async () => {
  const { db, bucket, as, count } = await setup();
  const ev = as('eventos');
  const adm = as('administracion');
  assert.equal((await payments.remove(ev, 1, 11)).message, 'Este pago tiene una factura conforme: no se puede borrar.');
  // Uno que ha añadido Administración: Eventos no lo puede borrar
  const mine = (await payments.create(adm, 3, form({ ...NEW, doc_kind: 'proforma' }, { file: PDF() }))).value.id;
  assert.equal((await payments.remove(ev, 3, mine)).code, 'forbidden');
  assert.equal(bucket.files.size, 1);
  assert.ok((await payments.remove(adm, 3, mine)).ok);
  assert.equal(count('payments WHERE id = ?', mine), 0);
  assert.equal(count("supplier_invoices WHERE kind = 'proforma' AND expediente_id = 3 AND file_id IS NOT NULL AND id NOT IN (SELECT document_id FROM payment_documents)"), 0);
  assert.equal(bucket.files.size, 0);
  // Y el suyo, Eventos sí
  assert.ok((await payments.remove(ev, 3, 22)).ok);
  assert.equal(db.one("SELECT COUNT(*) n FROM activity WHERE action = 'payment.delete'").n, 2);
  assert.equal((await payments.remove(ev, 3, 999)).code, 'not_found');
});

test('documentos: factura conforme al subirla quien revisa (con número y el pago hecho); otra después, con motivo', { skip }, async () => {
  const { db, as } = await setup();
  const adm = as('administracion');
  const docOf = (id) => db.one('SELECT * FROM supplier_invoices WHERE id = ?', id);
  // Catering Lazo (24): pagado y sin factura
  const first = await payments.addDocument(adm, 3, 24, { doc_kind: 'factura', invoice_number: 'CL-77' }, PDF());
  assert.equal(docOf(first.value.id).review, 'conforme');
  const again = await payments.addDocument(adm, 3, 24, { doc_kind: 'factura', invoice_number: 'CL-78' }, PDF());
  assert.equal(again.fields.doc_comment, 'Este pago ya tiene una factura conforme: explica en el comentario por qué se sube otra.');
  assert.ok((await payments.addDocument(adm, 3, 24, { doc_kind: 'factura', invoice_number: 'CL-78', doc_comment: 'La anterior tenía mal el CIF' }, PDF())).ok);
  // Eventos sube una factura: queda pendiente; sin archivo ni número, nada
  const ev = as('eventos');
  const pending = await payments.addDocument(ev, 3, 22, { doc_kind: 'factura' }, PDF());
  assert.equal(docOf(pending.value.id).review, 'pendiente');
  assert.equal((await payments.addDocument(ev, 3, 22, { doc_kind: 'proforma' }, null)).message, 'Adjunta el documento (o escribe al menos su número).');
  assert.equal((await payments.addDocument(ev, 3, 22, { doc_kind: '' }, PDF())).fields.doc_kind, 'Indica si el documento es una factura o una proforma.');
  assert.match((await payments.addDocument(ev, 3, 22, { doc_kind: 'factura' }, FAKE())).fields.file, /no parece un PDF/);
});

test('documentos: cubrir otro pago con uno ya subido (del mismo expediente) y quitarlo', { skip }, async () => {
  const { db, as, count } = await setup();
  const ev = as('eventos');
  // La proforma del hotel (18) cubre también el 2º pago al hotel (21)
  assert.ok((await payments.linkDocument(ev, 3, 21, 18)).ok);
  assert.equal(count('payment_documents WHERE document_id = 18'), 2);
  assert.equal((await payments.linkDocument(ev, 3, 21, 5)).message, 'Ese documento no es de este expediente.');
  const f = (await payments.ficha(ev, 3, 21)).value;
  assert.deepEqual(f.docs.map((d) => d.id), [18]);
  assert.ok(f.coverage.get(18).length === 2 && !f.choices.some((d) => d.id === 18));
  // Quitarlo de un pago no lo borra si cubre otro
  assert.ok((await payments.removeDocument(ev, 3, 21, 18)).ok);
  assert.equal(count('supplier_invoices WHERE id = 18'), 1);
  // Una factura conforme no se quita; la de otra persona, sólo quien revisa
  assert.match((await payments.removeDocument(ev, 1, 11, 1)).message, /conforme no se puede borrar/);
  const adminDoc = (await payments.addDocument(as('administracion'), 3, 22, { doc_kind: 'proforma', invoice_number: 'P-9' }, null)).value.id;
  assert.equal((await payments.removeDocument(ev, 3, 22, adminDoc)).code, 'forbidden');
  assert.ok((await payments.removeDocument(as('administracion'), 3, 22, adminDoc)).ok);
  assert.equal(db.one('SELECT COUNT(*) n FROM supplier_invoices WHERE id = ?', adminDoc).n, 0); // ya no cubría nada: se borra
  assert.equal((await payments.removeDocument(ev, 3, 22, 9999)).message, 'Ese documento ya no está en este pago.');
});

test('conformar: sólo quien revisa, con número y con todos los pagos que cubre hechos', { skip }, async () => {
  const { db, as } = await setup();
  const adm = as('administracion');
  assert.equal((await payments.conform(as('eventos'), 10, { invoice_number: 'M-1' })).code, 'forbidden');
  assert.equal((await payments.conform(adm, 10, { invoice_number: '' })).code, 'invalid');
  // La de Gráficas Mercurio (4): su pago aún no está hecho
  assert.deepEqual([(await payments.conform(adm, 4, { invoice_number: 'GM-1' })).message], [WAITING_PAYMENT]);
  assert.equal((await payments.conform(adm, 18, { invoice_number: 'P-1' })).message, 'Las proformas no se revisan.');
  // La de Mentimeter (10): pagada con tarjeta → conforme
  const r = await payments.conform(adm, 10, { invoice_number: 'M-2026-1', invoice_date: '2026-08-20' });
  assert.deepEqual(r.value, { expedienteId: 1 });
  assert.deepEqual(db.one('SELECT number, issued_on, review, reviewed_by FROM supplier_invoices WHERE id = 10'), { number: 'M-2026-1', issued_on: '2026-08-20', review: 'conforme', reviewed_by: adm.user.id });
  assert.equal((await payments.conform(adm, 9999, { invoice_number: 'X' })).message, 'Esa factura ya no existe.');
});

test('justificante: lo sube y lo quita quien tiene el permiso; el de un pago hecho no se cambia', { skip }, async () => {
  const { bucket, as, pay } = await setup();
  const adm = as('administracion');
  assert.equal((await payments.saveReceipt(as('eventos'), 3, 21, PDF())).code, 'forbidden');
  assert.equal((await payments.saveReceipt(adm, 3, 21, null)).fields.receipt, 'Elige el justificante (PDF o foto).');
  assert.ok((await payments.saveReceipt(adm, 3, 21, PDF())).ok);
  const first = pay(21).receipt_file_id;
  assert.ok((await payments.saveReceipt(adm, 3, 21, PDF())).ok); // cambiarlo borra el anterior
  assert.ok(pay(21).receipt_file_id !== first && bucket.files.size === 1);
  assert.ok((await payments.removeReceipt(adm, 3, 21)).ok);
  assert.equal(pay(21).receipt_file_id, null);
  assert.equal(bucket.files.size, 0);
  // Pagado por transferencia con su justificante: ni se cambia ni se quita
  assert.ok((await payments.markPaid(adm, { payment_id: '21', paid_on: '2026-10-18', method: 'transferencia' }, { receipt: PDF() })).ok);
  assert.equal((await payments.saveReceipt(adm, 3, 21, PDF())).message, PAID_LOCKED);
  assert.equal((await payments.removeReceipt(adm, 3, 21)).message, PAID_LOCKED);
});

test('ficha y pestaña: el pago de otro expediente no existe; la lista de proveedores sólo si se puede editar', { skip }, async () => {
  const { as } = await setup();
  const ev = as('eventos');
  assert.equal((await payments.ficha(ev, 1, 21)).code, 'not_found');
  const f = (await payments.ficha(ev, 3, 21)).value;
  assert.ok(f.editable && f.options.length > 0 && f.rates.length > 0);
  assert.deepEqual((await payments.ficha(ev, 3, 24)).value.options, []); // pagado: no se edita
  const t = (await payments.tab(ev, 3, { supplierId: 9 })).value;
  assert.deepEqual([t.preset.name, t.editable, t.fin.payments.length > 0], ['Hotel Alfonso XIII', true, true]);
  assert.equal((await payments.tab(ev, 999)).code, 'not_found');
  assert.equal((await payments.tab(as('tecnico'), 3)).code, 'forbidden');
});
