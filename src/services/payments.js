// @ts-check
// Servicio de pagos a proveedores: las líneas de coste de cada expediente (previstas o con factura), su pago
// (con el justificante bancario) y los documentos del proveedor (facturas y proformas; una factura puede cubrir
// varios pagos y un pago tener varios documentos). Las reglas de siempre, ahora en un solo sitio:
//   · El orden: ① factura o proforma → ② justificante y pago → ③ factura conforme (después del pago).
//   · Un pago hecho no se modifica ni se borra; Administración puede «Deshacer pagado» (payment.unpay).
//   · Por transferencia hace falta el justificante (payment.receipt lo sube); Eventos sólo marca pagos con
//     tarjeta (sin payment.any_method).
//   · Una factura conforme no se borra; si se sube otra, hay que explicar por qué.
//   · Un expediente cerrado o cancelado es de sólo lectura.
// Las liquidaciones de gastos (lo que alguien adelantó de su bolsillo, sin factura) son pagos de tipo 'liquidacion':
// a nombre de quien adelantó el dinero, con la hoja de liquidación; el reembolso es su pago (mismas reglas).
// Permisos: «expedientes» para trabajar en los pagos de un expediente; «pagos» para la bandeja y marcar pagado;
// «supplier.review» para conformar facturas; «delete» para borrar lo que han subido otras personas.
// Los formularios llegan como FormData: los importes por tipo de IVA y las filas de varios pagos son listas.
import * as repo from '../repos/payments.js';
import * as docsRepo from '../repos/supplier-docs.js';
import * as expedientes from '../repos/expedientes.js';
import * as rates from '../repos/rates.js';
import * as suppliers from './suppliers.js';
import { storeFile, deleteFiles } from './files.js';
import { can, activityStmt } from '../lib/app.js';
import { loadFinance, activeUsers } from '../lib/data.js';
import { isLocked, LOCKED_MSG, CARD_ONLY, paidProblem } from '../lib/actions.js';
import { docName, isConforme, hasConformeInvoice, canRemoveDocument } from '../lib/supplier.js';
import { PaymentSchema, LiquidationSchema, PaySchema, SupplierDocSchema, ConformSchema, forecastRowSchema, parseRows, validate, formToObject } from '../lib/validate.js';
import { parseVatLines } from '../lib/vat.js';
import { getFile, UploadError } from '../lib/files.js';
import { PAYMENT_METHODS, PAID_LOCKED, SOON_DAYS, conformBlocker, plural, isLiquidation } from '../lib/finance.js';
import { TABLES } from '../lib/tables.js';
import { allowedColumns } from '../lib/table.js';
import { eur } from '../lib/money.js';
import { formatDate, nowIso, addDays } from '../lib/dates.js';
import { done, fail, forbidden, notFound, invalid } from './result.js';

/** @typedef {import('./types').Context} Context */

const locked = () => fail('conflict', LOCKED_MSG);
const uploadFailed = (/** @type {UploadError} */ err, field = 'file', label = '') => fail('invalid', `${label}${err.message}`, { fields: { [field]: `${label}${err.message}` } });
const SHEET_MISSING = 'Adjunta la hoja de liquidación (PDF o foto de la hoja con los tiques).';
const NO_INVOICE = 'Una liquidación de gastos no lleva factura: su documento es la hoja de liquidación.';
// Quien sólo marca pagos con tarjeta (Eventos) no marca reembolsos: no se hacen con tarjeta
const REIMBURSE_ADMIN = 'El reembolso de una liquidación de gastos lo marca Administración.';
/** «el pago a Hotel X» · «la liquidación de gastos de Marta López» (para la actividad) */
const what = (/** @type {{ kind?: string, supplier: string }} */ p) => (isLiquidation(p) ? `la liquidación de gastos de ${p.supplier}` : `el pago a ${p.supplier}`);

/**
 * El expediente (que exista y se pueda tocar) y el pago de ese expediente
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {number} id
 * @param {{ write?: boolean }} [options]
 */
async function load(ctx, expedienteId, id, { write = true } = {}) {
  if (!can(ctx.user, 'expedientes')) return forbidden();
  const [exp, p] = await Promise.all([expedientes.header(ctx.db, expedienteId), repo.byId(ctx.db, expedienteId, id)]);
  if (!exp || !p) return notFound();
  if (write && isLocked(exp)) return locked();
  return done({ exp, p });
}

// ── Consultas ──────────────────────────────────────────────────────────────

/**
 * Pestaña Pagos de un expediente: el expediente, sus importes (todos sus pagos con sus documentos), los tipos de
 * IVA, la lista de proveedores para el selector y los nombres del equipo (quién adelantó una liquidación de gastos).
 * supplierId: el proveedor con el que se abre el formulario.
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {{ supplierId?: number | null }} [options]
 */
export async function tab(ctx, expedienteId, { supplierId = null } = {}) {
  if (!can(ctx.user, 'expedientes')) return forbidden();
  const exp = await expedientes.header(ctx.db, expedienteId);
  if (!exp) return notFound();
  const editable = !isLocked(exp);
  const [fin, vatRates, picker, preset, team] = await Promise.all([
    loadFinance(ctx.db, expedienteId, ctx.now),
    rates.list(ctx.db),
    editable ? suppliers.pickerData(ctx) : null,
    supplierId ? suppliers.resolveForPayment(ctx, { id: supplierId }) : null,
    editable ? activeUsers(ctx.db) : [],
  ]);
  return done({
    exp, fin, rates: vatRates, editable,
    options: picker?.ok ? picker.value.options : [], types: picker?.ok ? picker.value.types : [],
    preset: preset?.ok ? preset.value : null, people: team.map((/** @type {{ name: string }} */ u) => u.name),
  });
}

/**
 * Ficha de un pago: el pago, sus documentos, los demás documentos del expediente (para «ya está subido»),
 * los pagos que cubre cada documento compartido y, si se puede editar, la lista de proveedores.
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {number} id
 */
export async function ficha(ctx, expedienteId, id) {
  const r = await load(ctx, expedienteId, id, { write: false });
  if (!r.ok) return r;
  const { exp, p } = r.value;
  const editable = !isLocked(exp) && p.status !== 'pagado';
  const liq = isLiquidation(p);
  const [docs, all, coverage, vatRates, picker, team] = await Promise.all([
    docsRepo.forPayment(ctx.db, id), liq ? [] : docsRepo.forExpediente(ctx.db, expedienteId), docsRepo.coverage(ctx.db, id), rates.list(ctx.db),
    editable && !liq ? suppliers.pickerData(ctx) : null,
    editable && liq ? activeUsers(ctx.db) : [],
  ]);
  // Documentos ya subidos en el expediente que no están en este pago (los del mismo proveedor, primero)
  const linked = new Set(docs.map((d) => d.id));
  const choices = all.filter((d) => !linked.has(d.id)).sort((a, b) => Number(b.supplier === p.supplier) - Number(a.supplier === p.supplier));
  return done({
    exp, payment: p, docs, choices, coverage, rates: vatRates, editable,
    options: picker?.ok ? picker.value.options : [], types: picker?.ok ? picker.value.types : [],
    people: team.map((/** @type {{ name: string }} */ u) => u.name),
  });
}

/**
 * Bandeja de pagos de todos los expedientes: pendientes (y pagados sin factura), facturas por revisar y pagados.
 * @param {Context} ctx
 * @param {'pendientes' | 'revisar' | 'pagados'} view
 * @param {string} [q]
 */
export async function inbox(ctx, view, q = '') {
  if (!can(ctx.user, 'pagos')) return forbidden();
  const [pending, noInvoice, review, paid] = await Promise.all([
    view === 'pendientes' ? repo.pending(ctx.db, q) : [],
    view === 'pendientes' ? repo.paidWithoutInvoice(ctx.db, q) : [],
    docsRepo.toReview(ctx.db, view === 'revisar' ? q : ''),
    view === 'pagados' ? repo.paid(ctx.db, q) : [],
  ]);
  return done({ pending, noInvoice, review, paid });
}

/** La columna de orden (una que se pueda ordenar y ver) y su sentido @param {Context} ctx @param {string} table @param {string} order @param {string | null} dir */
function sortOf(ctx, table, order, dir) {
  const sortable = allowedColumns(TABLES[table], (p) => can(ctx.user, p)).filter((c) => c.sort);
  const col = sortable.find((c) => c.key === order) ?? sortable.find((c) => c.key === TABLES[table].sort) ?? sortable[0];
  return { sort: col.key, dir: /** @type {'asc' | 'desc'} */ (dir === 'asc' || dir === 'desc' ? dir : col.sort) };
}
const KINDS = ['proveedor', 'liquidacion'];

/**
 * Bandeja, pagos pendientes en tabla (por páginas) o, con un límite grande, todos para las tarjetas por plazos.
 * plazo: vencidos, semana, mes, luego, sinfecha o reembolsos · kind: proveedor o liquidacion.
 * Devuelve la página, el total y la suma de lo filtrado, y cuántos hay y cuánto suman en cada plazo.
 * @param {Context} ctx
 * @param {{ q?: string, plazo?: string, kind?: string, order?: string, dir?: string | null, limit?: number, offset?: number }} [o]
 */
export async function pendingTable(ctx, { q = '', plazo = '', kind = '', order = 'vence', dir = null, limit = 25, offset = 0 } = {}) {
  if (!can(ctx.user, 'pagos')) return forbidden();
  const s = sortOf(ctx, 'pagos', order, dir);
  const res = await repo.pendingTable(ctx.db, {
    q: q.trim().slice(0, 80), plazo, kind: KINDS.includes(kind) ? kind : '', today: ctx.now, soon: addDays(ctx.now, SOON_DAYS), month: addDays(ctx.now, 30),
    ...s, limit: Math.min(Math.max(1, limit), 1000), offset: Math.max(0, offset),
  });
  return done({ ...res, order: s.sort, dir: s.dir });
}

/**
 * Bandeja, pagos hechos en tabla (por páginas) o, con un límite, los últimos para las tarjetas por meses.
 * month: 'YYYY-MM' · method: la forma de pago · kind: proveedor o liquidacion.
 * @param {Context} ctx
 * @param {{ q?: string, month?: string, method?: string, kind?: string, order?: string, dir?: string | null, limit?: number, offset?: number }} [o]
 */
export async function paidTable(ctx, { q = '', month = '', method = '', kind = '', order = 'pagado', dir = null, limit = 25, offset = 0 } = {}) {
  if (!can(ctx.user, 'pagos')) return forbidden();
  const s = sortOf(ctx, 'pagados', order, dir);
  const res = await repo.paidTable(ctx.db, {
    q: q.trim().slice(0, 80), month: /^\d{4}-\d{2}$/.test(month) ? month : '', method: Object.hasOwn(PAYMENT_METHODS, method) ? method : '',
    kind: KINDS.includes(kind) ? kind : '', ...s, limit: Math.min(Math.max(1, limit), 1000), offset: Math.max(0, offset),
  });
  return done({ ...res, order: s.sort, dir: s.dir });
}

/** Bandeja: pagos hechos de los que falta la factura del proveedor @param {Context} ctx @param {string} [q] */
export async function paidWithoutInvoice(ctx, q = '') {
  if (!can(ctx.user, 'pagos')) return forbidden();
  return done(await repo.paidWithoutInvoice(ctx.db, q));
}

// ── Pagos ──────────────────────────────────────────────────────────────────

/**
 * Pago nuevo (aunque no estuviera previsto), con su desglose de IVA y, si se tienen, su factura o proforma y,
 * si ya está pagado, la forma de pago y el justificante. El proveedor, de la lista.
 * Si el pago se guarda pero su documento no se puede subir, devuelve docError (el pago queda; se reintenta en su ficha).
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {FormData} form
 */
export async function create(ctx, expedienteId, form) {
  if (!can(ctx.user, 'expedientes')) return forbidden();
  const exp = await expedientes.header(ctx.db, expedienteId);
  if (!exp) return notFound();
  if (isLocked(exp)) return locked();
  const input = formToObject(form);
  const parsed = validate(PaymentSchema, input);
  if (!parsed.ok) return invalid(parsed);
  // El proveedor tiene que ser uno de la lista (no se crea al escribirlo)
  const picked = await suppliers.resolveForPayment(ctx, { id: parsed.data.supplier_id, name: parsed.data.supplier });
  if (!picked.ok) return picked;
  const amounts = parseVatLines(form, await rates.list(ctx.db));
  if (!amounts.ok) return fail('invalid', amounts.message, { fields: { amount: amounts.message } });
  const d = parsed.data;
  const paid = d.status === 'pagado';
  // El justificante sólo lo sube quien tiene ese permiso (a los demás no se les ofrece: se ignora)
  const receipt = can(ctx.user, 'payment.receipt') ? getFile(form, 'receipt') : null;
  if (paid) {
    const problem = paidProblem({ method: d.method, hasReceipt: !!receipt, cardOnly: !can(ctx.user, 'payment.any_method') });
    if (problem) return fail('invalid', problem, { fields: d.method && problem !== CARD_ONLY ? { receipt: problem } : { method: problem } });
  }
  const doc = validate(SupplierDocSchema, input);
  if (!doc.ok) return invalid(doc);
  const file = getFile(form, 'file');
  if ((file || doc.data.number) && !doc.data.kind) {
    return fail('invalid', 'Indica si el documento es una factura o una proforma.', { fields: { doc_kind: 'Indica si el documento es una factura o una proforma.' } });
  }
  // El justificante se guarda antes: si no se puede subir, no se crea nada
  let receiptId = null;
  try {
    if (paid && receipt) receiptId = await storeFile({ db: ctx.db, bucket: ctx.bucket, file: receipt, expedienteId, userId: ctx.user?.id ?? null });
  } catch (err) {
    if (!(err instanceof UploadError)) throw err;
    return uploadFailed(err, 'receipt', 'Justificante · ');
  }
  const sup = picked.value;
  const payment = await repo.insert(ctx.db, expedienteId, {
    supplier: sup, concept: d.concept, amounts, due_date: d.due_date, status: d.status,
    paid_on: paid ? d.paid_on : null, method: paid ? d.method : null, receipt_file_id: receiptId, notes: d.notes,
  }, ctx.user?.id ?? null);
  await activityStmt(ctx.db, ctx.actor, expedienteId, 'payment.add', `añadió un pago a ${sup.name} (${eur(amounts.total)})${paid ? ' ya pagado' : ''}`).run();
  // El documento (si se ha adjuntado o se sabe su número): la factura queda pendiente de revisar
  if (file || doc.data.number) {
    try {
      await attach(ctx, payment, file, doc.data);
    } catch (err) {
      if (!(err instanceof UploadError)) throw err;
      return done({ id: payment.id, docError: err.message });
    }
  }
  return done({ id: payment.id, docError: null });
}

/**
 * Liquidación de gastos nueva: quién adelantó el dinero, concepto, fecha de los gastos, importe por tipos de IVA y la
 * hoja de liquidación (obligatoria). Queda por reembolsar; si ya se ha reembolsado, como un pago hecho (fecha, forma
 * y, si es por transferencia, el justificante).
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {FormData} form advanced_by, concept, spent_on, vl_*, status, paid_on, method, notes · archivos sheet y receipt
 */
export async function createLiquidation(ctx, expedienteId, form) {
  if (!can(ctx.user, 'expedientes')) return forbidden();
  const exp = await expedientes.header(ctx.db, expedienteId);
  if (!exp) return notFound();
  if (isLocked(exp)) return locked();
  const parsed = validate(LiquidationSchema, formToObject(form));
  if (!parsed.ok) return invalid(parsed);
  const amounts = parseVatLines(form, await rates.list(ctx.db));
  if (!amounts.ok) return fail('invalid', amounts.message, { fields: { amount: amounts.message } });
  const d = parsed.data;
  const sheet = getFile(form, 'sheet');
  if (!sheet) return fail('invalid', SHEET_MISSING, { fields: { sheet: SHEET_MISSING } });
  const paid = d.status === 'pagado';
  const receipt = can(ctx.user, 'payment.receipt') ? getFile(form, 'receipt') : null;
  if (paid && !can(ctx.user, 'payment.any_method')) return fail('invalid', REIMBURSE_ADMIN, { fields: { method: REIMBURSE_ADMIN } });
  if (paid) {
    const problem = paidProblem({ method: d.method, hasReceipt: !!receipt, cardOnly: !can(ctx.user, 'payment.any_method') });
    if (problem) return fail('invalid', problem, { fields: d.method && problem !== CARD_ONLY ? { receipt: problem } : { method: problem } });
  }
  // Los archivos, antes: si alguno no vale, no se crea nada
  const userId = ctx.user?.id ?? null;
  const stored = [];
  try {
    stored.push(await storeFile({ db: ctx.db, bucket: ctx.bucket, file: sheet, expedienteId, userId }));
  } catch (err) {
    if (!(err instanceof UploadError)) throw err;
    return uploadFailed(err, 'sheet', 'Hoja de liquidación · ');
  }
  try {
    if (paid && receipt) stored.push(await storeFile({ db: ctx.db, bucket: ctx.bucket, file: receipt, expedienteId, userId }));
  } catch (err) {
    if (!(err instanceof UploadError)) throw err;
    await deleteFiles(ctx.db, ctx.bucket, stored);
    return uploadFailed(err, 'receipt', 'Justificante · ');
  }
  const payment = await repo.insert(ctx.db, expedienteId, {
    kind: 'liquidacion', supplier: { id: null, name: d.advanced_by }, concept: d.concept, amounts, due_date: null, spent_on: d.spent_on,
    status: d.status, paid_on: paid ? d.paid_on : null, method: paid ? d.method : null, sheet_file_id: stored[0], receipt_file_id: stored[1] ?? null, notes: d.notes,
  }, userId);
  await activityStmt(ctx.db, ctx.actor, expedienteId, 'payment.add',
    `añadió una liquidación de gastos de ${d.advanced_by} (${eur(amounts.total)}: ${d.concept})${paid ? ' ya reembolsada' : ''}`).run();
  return done({ id: payment.id });
}

/**
 * Varios pagos previstos de golpe (al mismo proveedor o a varios): proveedor, concepto, fecha límite e importe.
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {FormData} form filas fc_supplier, fc_supplier_id, fc_concept, fc_due_date, fc_total, fc_rate
 */
export async function createPlanned(ctx, expedienteId, form) {
  if (!can(ctx.user, 'expedientes')) return forbidden();
  const exp = await expedientes.header(ctx.db, expedienteId);
  if (!exp) return notFound();
  if (isLocked(exp)) return locked();
  const rows = parseRows(form, 'fc', ['supplier', 'supplier_id', 'concept', 'due_date', 'total', 'rate'], forecastRowSchema(await rates.list(ctx.db)), { ignore: ['rate', 'supplier_id'] });
  if (!rows.ok) return fail('invalid', rows.message);
  if (!rows.rows.length) return fail('invalid', 'Escribe al menos un pago (proveedor e importe).');
  const sups = await suppliers.resolveRowsForPayment(ctx, rows.rows);
  if (!sups.ok) return sups;
  const supOf = sups.value.of;
  const sum = rows.rows.reduce((a, r) => a + r.total, 0);
  await ctx.db.batch([
    ...rows.rows.map((r) => repo.insertPlannedStmt(ctx.db, expedienteId, { ...r, supplier: supOf(r) }, ctx.user?.id ?? null)),
    activityStmt(ctx.db, ctx.actor, expedienteId, 'payment.add',
      `añadió ${plural(rows.rows.length, 'pago previsto', 'pagos previstos')} (${eur(sum)}): ${[...new Set(rows.rows.map((r) => supOf(r).name))].join(', ')}`),
  ]);
  return done({ count: rows.rows.length });
}

/**
 * Cambiar los datos del pago (proveedor, concepto, importe, fecha límite, notas); se paga en su paso, no aquí.
 * El proveedor, de la lista; el que ya tenía se puede mantener aunque ahora esté en «No contratar».
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {number} id
 * @param {FormData} form
 */
export async function update(ctx, expedienteId, id, form) {
  const r = await load(ctx, expedienteId, id);
  if (!r.ok) return r;
  const { p } = r.value;
  if (p.status === 'pagado') return fail('conflict', PAID_LOCKED);
  const input = formToObject(form);
  if (isLiquidation(p)) return updateLiquidation(ctx, expedienteId, p, input, form);
  const parsed = validate(PaymentSchema, { ...input, status: 'pendiente' });
  if (!parsed.ok) return invalid(parsed);
  const picked = await suppliers.resolveForPayment(ctx, { id: parsed.data.supplier_id, name: parsed.data.supplier }, { keepId: p.supplier_id });
  if (!picked.ok) return picked;
  const amounts = parseVatLines(form, await rates.list(ctx.db));
  if (!amounts.ok) return fail('invalid', amounts.message, { fields: { amount: amounts.message } });
  const d = parsed.data;
  const sup = picked.value;
  await ctx.db.batch([
    repo.updateStmt(ctx.db, id, { supplier: sup, concept: d.concept, amounts, due_date: d.due_date, notes: d.notes }, nowIso()),
    activityStmt(ctx.db, ctx.actor, expedienteId, 'payment.update',
      `${amounts.total !== p.total_cents ? `importe ${eur(p.total_cents)} → ${eur(amounts.total)}` : 'editó el pago'} · ${sup.name}`),
  ]);
  return done({ id });
}

/**
 * Cambiar los datos de una liquidación de gastos (quién, concepto, fecha, importe, notas); no su hoja ni su reembolso
 * @param {Context} ctx @param {number} expedienteId @param {any} p @param {Record<string, any>} input @param {FormData} form
 */
async function updateLiquidation(ctx, expedienteId, p, input, form) {
  const parsed = validate(LiquidationSchema, { ...input, status: 'pendiente' });
  if (!parsed.ok) return invalid(parsed);
  const amounts = parseVatLines(form, await rates.list(ctx.db));
  if (!amounts.ok) return fail('invalid', amounts.message, { fields: { amount: amounts.message } });
  const d = parsed.data;
  await ctx.db.batch([
    repo.updateStmt(ctx.db, p.id, { supplier: { id: null, name: d.advanced_by }, concept: d.concept, amounts, due_date: null, spent_on: d.spent_on, notes: d.notes }, nowIso()),
    activityStmt(ctx.db, ctx.actor, expedienteId, 'payment.update',
      `${amounts.total !== p.total_cents ? `importe ${eur(p.total_cents)} → ${eur(amounts.total)}` : 'editó la liquidación de gastos'} · ${d.advanced_by}`),
  ]);
  return done({ id: p.id });
}

/**
 * Sustituir la hoja de una liquidación de gastos (una vez reembolsada, ya no se cambia)
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {number} id
 * @param {File | null} file
 */
export async function replaceSheet(ctx, expedienteId, id, file) {
  const r = await load(ctx, expedienteId, id);
  if (!r.ok) return r;
  const { p } = r.value;
  if (!isLiquidation(p)) return fail('invalid', 'Este pago no es una liquidación de gastos.');
  if (p.status === 'pagado' && p.sheet_file_id) return fail('conflict', PAID_LOCKED);
  if (!file) return fail('invalid', SHEET_MISSING, { fields: { sheet: SHEET_MISSING } });
  let fileId;
  try {
    fileId = await storeFile({ db: ctx.db, bucket: ctx.bucket, file, expedienteId, userId: ctx.user?.id ?? null });
  } catch (err) {
    if (!(err instanceof UploadError)) throw err;
    return uploadFailed(err, 'sheet', 'Hoja de liquidación · ');
  }
  await ctx.db.batch([
    repo.sheetStmt(ctx.db, id, fileId, nowIso()),
    activityStmt(ctx.db, ctx.actor, expedienteId, 'payment.sheet', `${p.sheet_file_id ? 'cambió' : 'subió'} la hoja de ${what(p)} (${eur(p.total_cents)})`),
  ]);
  if (p.sheet_file_id) await deleteFiles(ctx.db, ctx.bucket, [p.sheet_file_id]);
  return done({ id });
}

/**
 * Borrar un pago: no si está hecho ni si tiene una factura conforme. Lo borra quien lo añadió o quien tiene «delete».
 * Los documentos que no cubrían otros pagos se borran también (con su archivo), y el justificante.
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {number} id
 */
export async function remove(ctx, expedienteId, id) {
  const r = await load(ctx, expedienteId, id);
  if (!r.ok) return r;
  const { p } = r.value;
  if (p.status === 'pagado') return fail('conflict', PAID_LOCKED);
  const docs = await docsRepo.forPayment(ctx.db, id);
  if (hasConformeInvoice(docs)) return fail('conflict', 'Este pago tiene una factura conforme: no se puede borrar.');
  if (!can(ctx.user, 'delete') && p.created_by !== ctx.user?.id) return forbidden('Sólo Administración o quien añadió el pago puede borrarlo.');
  await ctx.db.batch([
    ...repo.deleteStmts(ctx.db, id),
    activityStmt(ctx.db, ctx.actor, expedienteId, 'payment.delete', `borró ${what(p)} (${eur(p.total_cents)})`),
  ]);
  for (const d of docs) await dropIfOrphan(ctx, d.id);
  await deleteFiles(ctx.db, ctx.bucket, [p.receipt_file_id, p.sheet_file_id]);
  return done({ id });
}

/**
 * Marcar un pago como hecho (desde la ficha, la pestaña, la bandeja o el inicio). Si es por transferencia, con su
 * justificante: el que ya tiene o el que se adjunta en ese momento (receipt).
 * expedienteId: si se marca desde un expediente, el pago tiene que ser de ese expediente.
 * @param {Context} ctx
 * @param {Record<string, any>} input payment_id, paid_on, method
 * @param {{ expedienteId?: number | null, receipt?: File | null }} [options]
 */
export async function markPaid(ctx, input, { expedienteId = null, receipt = null } = {}) {
  if (!can(ctx.user, 'pagos')) return forbidden('No tienes permiso para registrar pagos.');
  const parsed = validate(PaySchema, input);
  if (!parsed.ok) return invalid(parsed);
  const id = Number(input.payment_id);
  const p = Number.isInteger(id) ? await repo.forPaying(ctx.db, id) : null;
  // Desde una lista: si mientras tanto lo han borrado, se avisa (no es una página que no exista)
  if (!p || (expedienteId && p.expediente_id !== expedienteId)) return fail('invalid', 'Ese pago ya no existe.');
  if (isLocked({ status: p.exp_status })) return locked();
  if (p.status === 'pagado') return done({ expedienteId: p.expediente_id, kind: p.kind });
  if (isLiquidation(p) && !can(ctx.user, 'payment.any_method')) return forbidden(REIMBURSE_ADMIN);
  const { paid_on, method } = parsed.data;
  // El justificante sólo lo sube quien tiene ese permiso (a Eventos no se le ofrece)
  if (receipt && !can(ctx.user, 'payment.receipt')) return forbidden('No tienes permiso para subir el justificante.');
  const problem = paidProblem({ method, hasReceipt: !!(p.receipt_file_id || receipt), cardOnly: !can(ctx.user, 'payment.any_method') });
  if (problem) return fail('invalid', problem);
  if (receipt) {
    const saved = await storeReceipt(ctx, p, receipt);
    if (!saved.ok) return saved;
  }
  await ctx.db.batch([
    repo.paidStmt(ctx.db, id, paid_on, method, nowIso()),
    activityStmt(ctx.db, ctx.actor, p.expediente_id, 'payment.paid',
      `${isLiquidation(p) ? `marcó como reembolsada la liquidación de gastos de ${p.supplier}` : `marcó como pagado ${p.supplier}`} (${eur(p.total_cents)}) el ${formatDate(paid_on)}${method ? ` por ${PAYMENT_METHODS[method].toLowerCase()}` : ''}`),
  ]);
  return done({ expedienteId: p.expediente_id, kind: p.kind });
}

/**
 * «Deshacer pagado»: vuelve a estar por pagar (para corregir un error; queda en la actividad)
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {number} id
 */
export async function unpay(ctx, expedienteId, id) {
  if (!can(ctx.user, 'payment.unpay')) return forbidden('Sólo Administración puede deshacer un pago hecho.');
  const r = await load(ctx, expedienteId, id);
  if (!r.ok) return r;
  const { p } = r.value;
  if (p.status !== 'pagado') return done({ id, kind: p.kind });
  await ctx.db.batch([
    repo.unpaidStmt(ctx.db, id, nowIso()),
    activityStmt(ctx.db, ctx.actor, expedienteId, 'payment.unpaid',
      `deshizo ${isLiquidation(p) ? `el reembolso de la liquidación de gastos de ${p.supplier}` : `el pago a ${p.supplier}`} (${eur(p.total_cents)}) del ${formatDate(p.paid_on)}: vuelve a estar ${isLiquidation(p) ? 'por reembolsar' : 'por pagar'}`),
  ]);
  return done({ id, kind: p.kind });
}

// ── Justificante ───────────────────────────────────────────────────────────

/**
 * Guarda el justificante (y borra el anterior, si lo había)
 * @param {Context} ctx
 * @param {{ id: number, expediente_id: number, supplier: string, kind?: string, total_cents: number, receipt_file_id: number | null }} p
 * @param {File} file
 */
async function storeReceipt(ctx, p, file) {
  let fileId;
  try {
    fileId = await storeFile({ db: ctx.db, bucket: ctx.bucket, file, expedienteId: p.expediente_id, userId: ctx.user?.id ?? null });
  } catch (err) {
    if (!(err instanceof UploadError)) throw err;
    return uploadFailed(err, 'receipt', 'Justificante · ');
  }
  await ctx.db.batch([
    repo.receiptStmt(ctx.db, p.id, fileId, nowIso()),
    activityStmt(ctx.db, ctx.actor, p.expediente_id, 'payment.receipt',
      `${p.receipt_file_id ? 'cambió' : 'subió'} el justificante ${isLiquidation(p) ? `del reembolso de ${p.supplier}` : `del pago a ${p.supplier}`} (${eur(p.total_cents)})`),
  ]);
  if (p.receipt_file_id) await deleteFiles(ctx.db, ctx.bucket, [p.receipt_file_id]);
  return done({ fileId });
}

/**
 * Subir (o cambiar) el justificante bancario. En un pago hecho se puede añadir el que falte, pero no cambiarlo.
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {number} id
 * @param {File | null} file
 */
export async function saveReceipt(ctx, expedienteId, id, file) {
  if (!can(ctx.user, 'payment.receipt')) return forbidden('El justificante lo sube Administración.');
  const r = await load(ctx, expedienteId, id);
  if (!r.ok) return r;
  const { p } = r.value;
  if (p.status === 'pagado' && p.receipt_file_id) return fail('conflict', PAID_LOCKED);
  if (!file) return fail('invalid', 'Elige el justificante (PDF o foto).', { fields: { receipt: 'Elige el justificante (PDF o foto).' } });
  return storeReceipt(ctx, p, file);
}

/**
 * Quitar el justificante (no de un pago hecho)
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {number} id
 */
export async function removeReceipt(ctx, expedienteId, id) {
  if (!can(ctx.user, 'payment.receipt')) return forbidden('El justificante lo sube Administración.');
  const r = await load(ctx, expedienteId, id);
  if (!r.ok) return r;
  const { p } = r.value;
  if (!p.receipt_file_id) return done({ id });
  if (p.status === 'pagado') return fail('conflict', PAID_LOCKED);
  await ctx.db.batch([
    repo.receiptStmt(ctx.db, id, null, nowIso()),
    activityStmt(ctx.db, ctx.actor, expedienteId, 'payment.receipt', `quitó el justificante ${isLiquidation(p) ? `del reembolso de ${p.supplier}` : `del pago a ${p.supplier}`}`),
  ]);
  await deleteFiles(ctx.db, ctx.bucket, [p.receipt_file_id]);
  return done({ id });
}

// ── Documentos del proveedor (facturas y proformas) ────────────────────────

/**
 * Sube un documento a un pago (con archivo, con número o con las dos cosas). Lanza UploadError si el archivo no vale.
 * Factura: si la sube quien revisa (supplier.review) con su número y el pago ya está hecho, queda conforme;
 * si no, pendiente de revisar. Proforma: no se revisa.
 * @param {Context} ctx
 * @param {{ id: number, expediente_id: number, supplier: string, total_cents: number, status: string }} payment
 * @param {File | null} file
 * @param {{ kind: string, number: string | null, issued_on: string | null, total: number | null, comment: string | null }} data
 */
async function attach(ctx, payment, file, data) {
  const userId = ctx.user?.id ?? null;
  const fileId = file ? await storeFile({ db: ctx.db, bucket: ctx.bucket, file, expedienteId: payment.expediente_id, userId }) : null;
  const invoice = data.kind === 'factura';
  const conforme = invoice && can(ctx.user, 'supplier.review') && !!data.number && payment.status === 'pagado';
  const at = nowIso();
  const id = await docsRepo.insert(ctx.db, payment, { ...data, total: data.total ?? null, fileId, conforme, userId, at });
  const what = docName({ kind: data.kind, number: data.number });
  await ctx.db.batch([
    docsRepo.linkStmt(ctx.db, payment.id, id),
    repo.touchStmt(ctx.db, payment.id, at),
    activityStmt(ctx.db, ctx.actor, payment.expediente_id, invoice ? 'supplier_invoice.add' : 'supplier_proforma.add',
      `subió la ${what} de ${payment.supplier} (${eur(payment.total_cents)})${invoice && !conforme ? ' · pendiente de revisar' : ''}`
      + `${data.comment ? `. Comentario: ${data.comment}` : ''}`),
  ]);
  return id;
}

/**
 * Factura o proforma nueva en la ficha del pago. Si el pago ya tiene una factura conforme y se sube otra
 * factura, hay que explicar por qué en el comentario.
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {number} id
 * @param {Record<string, any>} input doc_kind, invoice_number, invoice_date, invoice_total, doc_comment
 * @param {File | null} file
 */
export async function addDocument(ctx, expedienteId, id, input, file) {
  const r = await load(ctx, expedienteId, id);
  if (!r.ok) return r;
  const { p } = r.value;
  if (isLiquidation(p)) return fail('invalid', NO_INVOICE);
  const parsed = validate(SupplierDocSchema, input);
  if (!parsed.ok) return invalid(parsed);
  const d = parsed.data;
  if (!d.kind) return fail('invalid', 'Indica si el documento es una factura o una proforma.', { fields: { doc_kind: 'Indica si el documento es una factura o una proforma.' } });
  if (!file && !d.number) return fail('invalid', 'Adjunta el documento (o escribe al menos su número).');
  if (d.kind === 'factura' && !d.comment && hasConformeInvoice(await docsRepo.forPayment(ctx.db, id))) {
    const message = 'Este pago ya tiene una factura conforme: explica en el comentario por qué se sube otra.';
    return fail('invalid', message, { fields: { doc_comment: message } });
  }
  try {
    return done({ id: await attach(ctx, p, file, /** @type {any} */ (d)), kind: d.kind });
  } catch (err) {
    if (!(err instanceof UploadError)) throw err;
    return uploadFailed(err);
  }
}

/**
 * El pago lo cubre también un documento que ya está subido (del mismo expediente)
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {number} id
 * @param {number} documentId
 */
export async function linkDocument(ctx, expedienteId, id, documentId) {
  const r = await load(ctx, expedienteId, id);
  if (!r.ok) return r;
  const { p } = r.value;
  if (isLiquidation(p)) return fail('invalid', NO_INVOICE);
  const d = Number.isInteger(documentId) ? await docsRepo.byId(ctx.db, documentId) : null;
  if (!d || d.expediente_id !== expedienteId) return fail('invalid', 'Ese documento no es de este expediente.');
  await ctx.db.batch([
    docsRepo.linkStmt(ctx.db, id, d.id),
    activityStmt(ctx.db, ctx.actor, expedienteId, 'supplier_invoice.link',
      `indicó que la ${docName(d)} de ${d.supplier} también cubre el pago de ${p.supplier} (${eur(p.total_cents)})`),
  ]);
  return done({ id: d.id });
}

/**
 * Quita el documento del pago (si ya no cubre ningún otro pago, se borra con su archivo). Nunca una factura
 * conforme; las demás, quien revisa o quien la subió.
 * @param {Context} ctx
 * @param {number} expedienteId
 * @param {number} id
 * @param {number} documentId
 */
export async function removeDocument(ctx, expedienteId, id, documentId) {
  const r = await load(ctx, expedienteId, id);
  if (!r.ok) return r;
  const { p } = r.value;
  const d = (await docsRepo.forPayment(ctx.db, id)).find((x) => x.id === documentId);
  if (!d) return fail('invalid', 'Ese documento ya no está en este pago.');
  if (isConforme(d)) return fail('conflict', 'Una factura conforme no se puede borrar: si hay que cambiarla, sube otra explicando por qué.');
  if (!ctx.user || !canRemoveDocument(ctx.user, d)) return forbidden('Sólo Administración o quien subió el documento puede quitarlo.');
  await ctx.db.batch([
    docsRepo.unlinkStmt(ctx.db, id, d.id),
    activityStmt(ctx.db, ctx.actor, expedienteId, 'supplier_invoice.remove', `quitó la ${docName(d)} del pago de ${p.supplier}`),
  ]);
  await dropIfOrphan(ctx, d.id);
  return done({ id: d.id });
}

/** Borra el documento (y su archivo) si ya no cubre ningún pago @param {Context} ctx @param {number} documentId */
async function dropIfOrphan(ctx, documentId) {
  if (await docsRepo.isUsed(ctx.db, documentId)) return;
  const d = await docsRepo.byId(ctx.db, documentId);
  if (!d) return;
  await docsRepo.deleteStmt(ctx.db, documentId).run();
  if (d.file_id) await deleteFiles(ctx.db, ctx.bucket, [d.file_id]);
}

/**
 * Quien revisa da la factura por buena: anota su número (y fecha) y queda «Con factura». Sólo cuando están
 * hechos todos los pagos que cubre.
 * @param {Context} ctx
 * @param {number} documentId
 * @param {Record<string, any>} input invoice_number, invoice_date
 */
export async function conform(ctx, documentId, input) {
  if (!can(ctx.user, 'supplier.review')) return forbidden('Sólo Administración puede dar una factura por revisada.');
  const parsed = validate(ConformSchema, input);
  if (!parsed.ok) return invalid(parsed);
  const si = Number.isInteger(documentId) ? await docsRepo.byId(ctx.db, documentId) : null;
  if (!si) return fail('invalid', 'Esa factura ya no existe.');
  if (si.kind !== 'factura') return fail('invalid', 'Las proformas no se revisan.');
  const blocked = conformBlocker(await docsRepo.coveredStatuses(ctx.db, si.id));
  if (blocked) return fail('conflict', blocked);
  const exp = await expedientes.header(ctx.db, si.expediente_id);
  if (exp && isLocked(exp)) return locked();
  const d = parsed.data;
  await ctx.db.batch([
    docsRepo.conformStmt(ctx.db, si.id, { number: d.number, issued_on: d.issued_on ?? si.issued_on }, ctx.user?.id ?? null, nowIso()),
    activityStmt(ctx.db, ctx.actor, si.expediente_id, 'supplier_invoice.conform',
      `revisó la factura ${d.number} de ${si.supplier}${d.issued_on ? ` del ${formatDate(d.issued_on)}` : ''}: conforme`),
  ]);
  return done({ expedienteId: si.expediente_id });
}
