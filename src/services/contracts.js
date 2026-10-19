// @ts-check
// Servicio de contratos de proveedor: ver (caducidades, los de un proveedor, uno con su historial),
// dar de alta, renovar, modificar, marcar la renovación, documento y borrar.
// Ver: permiso «contratos». Cambiar: «contratos.edit». Los importes de los expedientes en los que se
// aplicó un contrato sólo con «proveedores.gasto». Las reglas de estado (por fechas) están en src/lib/contracts.js.
import * as repo from '../repos/contracts.js';
import * as suppliersRepo from '../repos/suppliers.js';
import { can, activityStmt } from '../lib/app.js';
import { contractState, contractOn, contractDiff, renewalDraft, byUrgency, RENEWAL } from '../lib/contracts.js';
import { ContractSchema, RenewalSchema, validate } from '../lib/validate.js';
import { UploadError } from '../lib/files.js';
import { storeFile, deleteFiles } from './files.js';
import { addDays, formatDate } from '../lib/dates.js';
import { done, fail, forbidden, notFound, invalid } from './result.js';

/** @typedef {import('./types').Context} Context */

const withState = (now) => (c) => ({ ...c, state: contractState(c, now) });
const period = (d) => `${formatDate(d.starts_on)}${d.ends_on ? ` – ${formatDate(d.ends_on)}` : ' (indefinido)'}`;
const MONEY_FIELDS = ['contracted', 'this_year', 'invoiced', 'paid', 'pending', 'credits'];

// ── Consultas ──────────────────────────────────────────────────────────────

/**
 * Todos los contratos con su estado, primero lo que requiere atención.
 * @param {Context} ctx
 * @param {string} [q] busca en el proveedor, el nombre del contrato y la ciudad
 */
export async function list(ctx, q = '') {
  if (!can(ctx.user, 'contratos')) return forbidden();
  const rows = await repo.all(ctx.db, q.trim().slice(0, 80));
  return done(rows.map(withState(ctx.now)).sort(byUrgency));
}

/**
 * Los contratos de un proveedor, con su estado.
 * @param {Context} ctx
 * @param {number} supplierId
 */
export async function forSupplier(ctx, supplierId) {
  if (!can(ctx.user, 'contratos')) return forbidden();
  const rows = await repo.forSupplier(ctx.db, supplierId);
  return done(rows.map(withState(ctx.now)).sort(byUrgency));
}

/**
 * Los que requieren atención (próximos a caducar, pendientes de renovación o caducados sin renovar).
 * @param {Context} ctx
 */
export async function due(ctx) {
  if (!can(ctx.user, 'contratos')) return forbidden();
  return done((await repo.due(ctx.db, ctx.now)).map(withState(ctx.now)));
}

/**
 * Un contrato: su estado, su historial y los expedientes del proveedor en los que se aplicó
 * (los que tienen el evento dentro de sus fechas; sin importes si no hay permiso de gasto).
 * @param {Context} ctx
 * @param {number} supplierId
 * @param {number} id
 */
export async function detail(ctx, supplierId, id) {
  if (!can(ctx.user, 'contratos')) return forbidden();
  const d = await repo.detail(ctx.db, id);
  if (!d || d.contract.supplier_id !== supplierId) return notFound();
  const [ficha, siblings] = await Promise.all([suppliersRepo.ficha(ctx.db, supplierId), repo.forSupplier(ctx.db, supplierId)]);
  const money = can(ctx.user, 'proveedores.gasto');
  const applied = (ficha?.expedientes ?? [])
    .filter((e) => contractOn(siblings, e.start_date)?.id === id)
    .map((e) => (money ? e : Object.fromEntries(Object.entries(e).filter(([k]) => !MONEY_FIELDS.includes(k)))));
  return done({ contract: withState(ctx.now)(d.contract), history: d.history, applied, money, editable: can(ctx.user, 'contratos.edit') });
}

/**
 * Lo que necesita el formulario de un contrato nuevo o de una renovación (renewsId).
 * Si el contrato ya está renovado → code 'renewed' con el id de su renovación.
 * @param {Context} ctx
 * @param {number} supplierId
 * @param {number|null} [renewsId]
 */
export async function draft(ctx, supplierId, renewsId = null) {
  if (!can(ctx.user, 'contratos.edit')) return forbidden();
  const [supplier, prev] = await Promise.all([
    suppliersRepo.byId(ctx.db, supplierId),
    renewsId ? repo.ofSupplier(ctx.db, renewsId, supplierId) : null,
  ]);
  if (!supplier || (renewsId && !prev)) return notFound();
  if (prev?.renewed_by) return fail('renewed', 'Este contrato ya está renovado.', { renewedBy: prev.renewed_by });
  return done({ supplier, prev, values: prev ? renewalDraft(prev, addDays) : { alert_days: 60 } });
}

// ── Cambios ────────────────────────────────────────────────────────────────

/**
 * Contrato nuevo o renovación de uno (renewsId): la renovación es un contrato nuevo que apunta al
 * anterior; el anterior se conserva tal cual y su decisión de renovación queda cerrada.
 * @param {Context} ctx
 * @param {number} supplierId
 * @param {Record<string, any>} input
 * @param {{ renewsId?: number|null, file?: File|null }} [options]
 */
export async function create(ctx, supplierId, input, { renewsId = null, file = null } = {}) {
  const dr = await draft(ctx, supplierId, renewsId);
  if (!dr.ok) return dr;
  const { supplier, prev } = dr.value;
  const parsed = validate(ContractSchema, input);
  if (!parsed.ok) return invalid(parsed);
  const d = parsed.data;
  let fileId = null;
  try {
    if (file) fileId = await storeFile({ db: ctx.db, bucket: ctx.bucket, file, folder: `prov/${supplierId}`, userId: ctx.user?.id ?? null });
  } catch (err) {
    if (!(err instanceof UploadError)) throw err;
    return fail('invalid', err.message, { fields: { file: err.message } });
  }
  const userId = ctx.user?.id ?? null;
  const id = await repo.insert(ctx.db, supplierId, d, { replacesId: prev?.id ?? null, fileId, userId });
  await ctx.db.batch(prev ? [
    repo.changeStmt(ctx.db, id, userId, 'renovacion', `Renovación de «${prev.title}» · ${period(d)}`),
    repo.changeStmt(ctx.db, prev.id, userId, 'renovado', `Renovado por «${d.title}» · ${period(d)}`),
    repo.renewalStmt(ctx.db, prev.id, null),
    activityStmt(ctx.db, ctx.actor, null, 'contract.renew', `renovó el contrato «${d.title}» de ${supplier.name} (${period(d)})`),
  ] : [
    repo.changeStmt(ctx.db, id, userId, 'alta', `Alta del contrato · ${period(d)}${fileId ? ' · con documento' : ''}`),
    activityStmt(ctx.db, ctx.actor, null, 'contract.create', `dio de alta el contrato «${d.title}» de ${supplier.name} (${period(d)})`),
  ]);
  return done({ id, renewed: !!prev });
}

/** El contrato si existe, es de ese proveedor y el usuario lo puede cambiar */
async function editableContract(ctx, supplierId, id) {
  if (!can(ctx.user, 'contratos.edit')) return forbidden();
  const d = await repo.detail(ctx.db, id);
  return !d || d.contract.supplier_id !== supplierId ? notFound() : done(d.contract);
}

/**
 * Modificar un contrato: queda en su historial qué cambió (antes y después), quién y cuándo.
 * @param {Context} ctx
 * @param {number} supplierId
 * @param {number} id
 * @param {Record<string, any>} input
 */
export async function update(ctx, supplierId, id, input) {
  const r = await editableContract(ctx, supplierId, id);
  if (!r.ok) return r;
  const c = r.value;
  const parsed = validate(ContractSchema, input);
  if (!parsed.ok) return invalid(parsed);
  const diff = contractDiff(c, parsed.data);
  if (!diff.summary) return done({ changed: false });
  await ctx.db.batch([
    repo.updateStmt(ctx.db, id, parsed.data),
    repo.changeStmt(ctx.db, id, ctx.user?.id ?? null, 'cambio', diff.summary, diff.changes),
    activityStmt(ctx.db, ctx.actor, null, 'contract.update', `modificó el contrato «${parsed.data.title}» de ${c.supplier_name}: ${diff.summary}`),
  ]);
  return done({ changed: true, summary: diff.summary });
}

/**
 * Decisión sobre la renovación: 'pendiente' (hay que negociarla), 'no' (no se renueva) o sin decidir.
 * @param {Context} ctx
 * @param {number} supplierId
 * @param {number} id
 * @param {Record<string, any>} input
 */
export async function setRenewal(ctx, supplierId, id, input) {
  const r = await editableContract(ctx, supplierId, id);
  if (!r.ok) return r;
  const c = r.value;
  if (c.renewed_by) return fail('conflict', 'Este contrato ya está renovado.');
  const parsed = validate(RenewalSchema, input);
  if (!parsed.ok) return invalid(parsed);
  const value = parsed.data.renewal;
  const text = value ? RENEWAL[value] : 'Sin decidir la renovación';
  await ctx.db.batch([
    repo.renewalStmt(ctx.db, id, value),
    repo.changeStmt(ctx.db, id, ctx.user?.id ?? null, 'marca', text),
    activityStmt(ctx.db, ctx.actor, null, 'contract.renewal', `marcó el contrato «${c.title}» de ${c.supplier_name}: ${text.toLowerCase()}`),
  ]);
  return done({ renewal: value });
}

/**
 * Subir (o sustituir) el documento del contrato.
 * @param {Context} ctx
 * @param {number} supplierId
 * @param {number} id
 * @param {File|null} file
 */
export async function replaceDocument(ctx, supplierId, id, file) {
  const r = await editableContract(ctx, supplierId, id);
  if (!r.ok) return r;
  const c = r.value;
  if (!file) return fail('invalid', 'Elige el documento del contrato.', { fields: { file: 'Elige el documento del contrato.' } });
  let fileId;
  try {
    fileId = await storeFile({ db: ctx.db, bucket: ctx.bucket, file, folder: `prov/${supplierId}`, userId: ctx.user?.id ?? null });
  } catch (err) {
    if (!(err instanceof UploadError)) throw err;
    return fail('invalid', err.message, { fields: { file: err.message } });
  }
  await ctx.db.batch([
    repo.fileStmt(ctx.db, id, fileId),
    repo.changeStmt(ctx.db, id, ctx.user?.id ?? null, 'documento', `${c.file_id ? 'Sustituyó el documento' : 'Subió el documento'}: ${file.name}`),
  ]);
  if (c.file_id) await deleteFiles(ctx.db, ctx.bucket, [c.file_id]);
  return done({ fileId });
}

/**
 * Borrar un contrato (con su documento y su historial). No si ya tiene renovación: es el historial de esa renovación.
 * @param {Context} ctx
 * @param {number} supplierId
 * @param {number} id
 */
export async function remove(ctx, supplierId, id) {
  const r = await editableContract(ctx, supplierId, id);
  if (!r.ok) return r;
  const c = r.value;
  if (c.renewed_by) return fail('conflict', 'Tiene una renovación: no se puede borrar (es el historial de la renovación).');
  await ctx.db.batch([
    repo.deleteStmt(ctx.db, id),
    // El contrato al que renovaba vuelve a estar sin renovar: que quede en su historial
    ...(c.replaces_id ? [repo.changeStmt(ctx.db, c.replaces_id, ctx.user?.id ?? null, 'renovado', `Se borró su renovación «${c.title}»: vuelve a estar sin renovar`)] : []),
    activityStmt(ctx.db, ctx.actor, null, 'contract.delete', `borró el contrato «${c.title}» de ${c.supplier_name}`),
  ]);
  if (c.file_id) await deleteFiles(ctx.db, ctx.bucket, [c.file_id]);
  return done({ id });
}
