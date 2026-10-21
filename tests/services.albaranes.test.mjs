// Albaranes de Business Travel contra una base SQLite en memoria con las migraciones y los datos de ejemplo:
// uno por reserva, número seguro que no se repite ni se reutiliza, revisiones cuando la reserva cambia, anular
// (también al cancelar la reserva), el documento sin el fee y el formato del número en Ajustes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, EMAILS } from './helpers/context.mjs';
import * as albaranes from '../src/services/albaranes.js';
import * as travel from '../src/services/travel.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const setup = async () => {
  const db = await testDb({ demo: true });
  const as = (role) => contextFor(db, EMAILS[role], { now: '2026-10-20' });
  return { db, as };
};
const flat = (s) => s.replace(/\s/g, ' ');
// BT-2026-0001 (ROCHE): Iryo, hotel, dos inscripciones y un traslado · BT-2026-0002 (ROCHE): vuelo y hotel en Sevilla
const ROCHE = 1;
const SEVILLA = 2;

test('emitir: número ALB-2026-000001, revisión 1 con lo que dice y sólo uno por reserva', { skip }, async () => {
  const { db, as } = await setup();
  const tania = as('administracion');
  const r = await albaranes.emit(tania, ROCHE);
  assert.ok(r.ok, r.message);
  assert.equal(r.value.number, 'ALB-2026-000001');
  const a = db.one('SELECT * FROM bt_albaranes WHERE id = ?', r.value.id);
  assert.equal(a.status, 'emitido');
  assert.equal(a.revision, 1);
  assert.equal(a.issued_on, '2026-10-20');
  // PVP de la reserva: 261 + 832 + 796,50 + 796,50 + 54,50 (con el fee dentro)
  assert.equal(a.total_cents, 274050);
  const content = JSON.parse(db.one('SELECT content FROM bt_albaran_revisions WHERE albaran_id = ? AND revision = 1', a.id).content);
  assert.deepEqual(content.groups.map((g) => [g.kind, g.lines.length, g.subtotal_cents]), [
    ['transporte', 1, 26100], ['alojamiento', 1, 83200], ['inscripcion', 2, 159300], ['otros', 1, 5450],
  ]);
  assert.deepEqual(content.groups[0].lines[0].passengers, ['Dra. María López Serrano', 'Dr. Carlos García Ruiz']);
  assert.equal(content.client.name, 'Roche Farma, S.A.', 'el nombre fiscal');
  // El fee no se guarda en el documento (ni el desglose de IVA)
  assert.doesNotMatch(JSON.stringify(content), /fee|base_cents|vat/);

  // Una reserva, un albarán: el segundo intento no da otro número
  const again = await albaranes.emit(tania, ROCHE);
  assert.equal(again.code, 'conflict');
  assert.match(again.message, /ya tiene su albarán/);
  assert.equal((await albaranes.emit(tania, SEVILLA)).value.number, 'ALB-2026-000002');
  assert.equal(db.one("SELECT value FROM counters WHERE key = 'bt_albaran:2026'").value, 2);
  assert.match(db.one("SELECT summary FROM change_log WHERE entity = 'bt_booking' AND entity_id = ? AND action = 'albaran'", ROCHE).summary,
    /^Albarán ALB-2026-000001 emitido · PVP 2\.740,50/);
});

test('emitir: con permiso, con servicios y sin cancelar (cerrada sí)', { skip }, async () => {
  const { as } = await setup();
  assert.equal((await albaranes.emit(as('eventos'), ROCHE)).code, 'forbidden');
  assert.ok((await albaranes.emit(as('tesoreria'), ROCHE)).ok);
  assert.ok((await albaranes.emit(as('jefes'), 6)).ok, 'la 6 está cerrada: el viaje ya se hizo');
  const cancelled = await albaranes.emit(as('administracion'), 5);
  assert.equal(cancelled.code, 'conflict');
  assert.match(cancelled.message, /cancelada/);
  const empty = (await travel.create(as('eventos'), { client: 'ELECNOR' })).value.id;
  assert.match((await albaranes.emit(as('administracion'), empty)).message, /todavía no tiene servicios/);
  assert.equal((await albaranes.emit(as('administracion'), 99999)).code, 'not_found');
});

test('dos personas emiten a la vez: un solo albarán y un solo número gastado', { skip }, async () => {
  const { db, as } = await setup();
  const [a, b] = await Promise.all([albaranes.emit(as('administracion'), ROCHE), albaranes.emit(as('jefes'), ROCHE)]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(db.one('SELECT COUNT(*) n FROM bt_albaranes WHERE booking_id = ?', ROCHE).n, 1);
  assert.equal(db.one("SELECT value FROM counters WHERE key = 'bt_albaran:2026'").value, 1);
});

test('la reserva cambia: la ficha lo avisa, la revisión 2 lo recoge y la 1 se conserva tal cual', { skip }, async () => {
  const { db, as } = await setup();
  const tania = as('administracion');
  const marta = as('eventos');
  const { number } = (await albaranes.emit(tania, SEVILLA)).value;
  let f = (await travel.detail(marta, SEVILLA)).value;
  assert.equal(f.albaran.live.number, number);
  assert.equal(f.albaran.live.changed, false);
  assert.equal(f.albaran.canEmit, false, 'Eventos ve el albarán pero no lo emite');
  assert.equal((await albaranes.revise(tania, SEVILLA)).code, 'conflict', 'sin cambios no hay revisión');

  // Cambia el PVP del hotel (el fee no lo ve Eventos, pero el PVP sí cambia: con IVA de 231 → 250)
  const hotel = db.one("SELECT * FROM bt_lines WHERE booking_id = ? AND kind = 'alojamiento'", SEVILLA);
  const passengers = db.rows('SELECT passenger_id FROM bt_line_passengers WHERE line_id = ?', hotel.id).map((p) => p.passenger_id);
  assert.ok((await travel.updateLine(marta, SEVILLA, hotel.id, { supplier: 'Booking', supplier_id: String(hotel.supplier_id), description: hotel.description,
    start_date: hotel.start_date, end_date: hotel.end_date, locator: hotel.locator, base: '', total: '250', vat: '1000' }, passengers)).ok);
  f = (await travel.detail(marta, SEVILLA)).value;
  assert.equal(f.albaran.live.changed, true);
  assert.deepEqual(f.albaran.live.changes.map(flat), ['los servicios', 'el PVP total: 452,40 € → 471,40 €']);

  // Cambiar los datos de la empresa en Ajustes no es un cambio de la reserva
  db.prepare("UPDATE settings SET value = 'B99999999' WHERE key = 'company_tax_id'").run();

  assert.equal((await albaranes.revise(marta, SEVILLA)).code, 'forbidden');
  const r = await albaranes.revise(tania, SEVILLA);
  assert.ok(r.ok, r.message);
  assert.deepEqual(r.value, { number, revision: 2 });
  const a = db.one('SELECT * FROM bt_albaranes WHERE booking_id = ?', SEVILLA);
  assert.equal(a.number, number, 'la revisión conserva el número');
  assert.equal(a.total_cents, 47140);
  const totals = db.rows('SELECT revision, total_cents FROM bt_albaran_revisions WHERE albaran_id = ? ORDER BY revision', a.id);
  assert.deepEqual(totals.map((x) => [x.revision, x.total_cents]), [[1, 45240], [2, 47140]]);

  // Cada revisión saca su documento: la 1 con su PVP y su CIF de entonces
  const one = (await albaranes.document(marta, SEVILLA, { albaranId: a.id, revision: 1 })).value;
  const two = (await albaranes.document(marta, SEVILLA)).value;
  assert.equal(flat(one.view.total), '452,40 €');
  assert.equal(flat(two.view.total), '471,40 €');
  assert.equal(one.current, false);
  assert.ok(two.view.meta.some(([k, v]) => k === 'Revisión' && v === '2'));
  assert.equal(one.view.issuer.lines[0], 'CIF: B00000000');
  assert.equal(one.view.client.lines[0], 'NIF/CIF: [pendiente]');
  assert.equal(two.view.issuer.lines[0], 'CIF: B99999999');
  assert.equal(two.view.fileName, `Albaran-${number}-rev2.pdf`);
  assert.match(db.one("SELECT summary FROM change_log WHERE action = 'albaran' AND summary LIKE '%revisión 2%'").summary, /cambian los servicios, el PVP total/);
  assert.equal((await albaranes.document(marta, SEVILLA, { albaranId: a.id, revision: 7 })).code, 'not_found');
});

test('el documento: PVP por servicio y bloque, sin fee; sin albarán, el borrador sin número', { skip }, async () => {
  const { as } = await setup();
  const draft = (await albaranes.document(as('eventos'), ROCHE)).value;
  assert.equal(draft.draft, true);
  assert.equal(draft.view.stamp, 'Borrador');
  assert.equal(draft.view.number, 'Sin número (borrador)');
  assert.equal(draft.view.fileName, 'Albaran-borrador-BT-2026-0001.pdf');
  assert.deepEqual(draft.view.groups.map((g) => [g.label, flat(g.subtotal)]), [
    ['Transporte', '261,00 €'], ['Alojamiento', '832,00 €'], ['Inscripción', '1.593,00 €'], ['Otros servicios', '54,50 €'],
  ]);
  const train = draft.view.groups[0].rows[0];
  assert.equal(train.concept, 'Iryo · Barcelona Sants → Madrid Atocha · ida y vuelta');
  assert.equal(train.detail, 'Fecha de ida 18/11/2026 · Fecha de vuelta 20/11/2026 · Localizador IRY7Q2K · Clase Singular, plazas 5A y 5B');
  assert.equal(train.who, 'Pasajeros: Dra. María López Serrano, Dr. Carlos García Ruiz');
  assert.equal(flat(draft.view.total), '2.740,50 €');
  // Ni rastro del fee (15 €, 40 €…) ni de los importes sin IVA
  assert.doesNotMatch(JSON.stringify(draft.view), /[Ff]ee|223,64|720,00/);
  const { value } = await albaranes.emit(as('administracion'), ROCHE);
  const issued = (await albaranes.document(as('eventos'), ROCHE)).value;
  assert.equal(issued.view.number, value.number);
  assert.equal(issued.view.stamp, null);
  assert.ok(issued.view.meta.some(([k, v]) => k === 'Fecha de emisión' && v === '20/10/2026'));
  assert.equal((await albaranes.document(as('tecnico'), ROCHE)).code, 'forbidden');
});

test('anular: con motivo, se conserva su número y el siguiente albarán lleva otro', { skip }, async () => {
  const { db, as } = await setup();
  const tania = as('administracion');
  const first = (await albaranes.emit(tania, ROCHE)).value;
  assert.equal((await albaranes.voidAlbaran(tania, ROCHE, { void_reason: '' })).code, 'invalid');
  assert.equal((await albaranes.voidAlbaran(as('eventos'), ROCHE, { void_reason: 'Por error' })).code, 'forbidden');
  assert.ok((await albaranes.voidAlbaran(tania, ROCHE, { void_reason: 'Emitido al cliente equivocado' })).ok);
  const old = db.one('SELECT * FROM bt_albaranes WHERE id = ?', first.id);
  assert.equal(old.status, 'anulado');
  assert.equal(old.void_reason, 'Emitido al cliente equivocado');
  let f = (await travel.detail(tania, ROCHE)).value.albaran;
  assert.equal(f.live, null);
  assert.equal(f.state.key, 'pendiente');
  assert.equal(f.voided.length, 1);
  const second = (await albaranes.emit(tania, ROCHE)).value;
  assert.equal(second.number, 'ALB-2026-000002', 'el número anulado no se reutiliza');
  // El anulado sigue saliendo como documento, marcado
  const doc = (await albaranes.document(tania, ROCHE, { albaranId: first.id })).value;
  assert.equal(doc.view.stamp, 'Anulado');
  assert.match(doc.view.voided, /cliente equivocado/);
  f = (await travel.detail(tania, ROCHE)).value.albaran;
  assert.equal(f.live.number, 'ALB-2026-000002');
});

test('cancelar la reserva anula su albarán; reabierta, queda pendiente; con albarán no se borra', { skip }, async () => {
  const { db, as } = await setup();
  const tania = as('administracion');
  const { number } = (await albaranes.emit(tania, SEVILLA)).value;
  assert.ok((await travel.cancel(tania, SEVILLA, { cancel_by: 'cliente', cancel_reason: 'fechas' })).ok);
  assert.equal(db.one('SELECT status, void_reason FROM bt_albaranes WHERE number = ?', number).status, 'anulado');
  assert.ok(db.one("SELECT 1 AS x FROM change_log WHERE entity_id = ? AND summary = ?", SEVILLA, `Albarán ${number} anulado · la reserva se ha cancelado`));
  let f = (await travel.detail(tania, SEVILLA)).value.albaran;
  assert.equal(f.state, null);
  assert.match(f.problem, /cancelada/);
  assert.ok((await travel.reopen(tania, SEVILLA)).ok);
  f = (await travel.detail(tania, SEVILLA)).value.albaran;
  assert.equal(f.state.key, 'pendiente');

  // Una reserva vacía que tuvo albarán no se borra (su número no se puede perder)
  const ctx = as('administracion');
  const id = (await travel.create(ctx, { client: 'ELECNOR' })).value.id;
  const p = (await travel.addPassenger(ctx, id, { first_name: 'Ana', last_name: 'Ruiz' })).value.id;
  const l = (await travel.addLine(ctx, id, 'otros', { description: 'Traslado', start_date: '2026-12-01', base: '', total: '50', vat: '1000' }, [p])).value.id;
  assert.ok((await albaranes.emit(ctx, id)).ok);
  assert.ok((await albaranes.voidAlbaran(ctx, id, { void_reason: 'Ya no sigue' })).ok);
  await travel.removeLine(ctx, id, l);
  await travel.removePassenger(ctx, id, p);
  const removed = await travel.remove(ctx, id);
  assert.equal(removed.code, 'conflict');
  assert.match(removed.message, /Ha tenido albarán/);
});

test('un albarán facturado no se revisa, no se anula y no deja cancelar la reserva', { skip }, async () => {
  const { db, as } = await setup();
  const tania = as('administracion');
  const { id, number } = (await albaranes.emit(tania, SEVILLA)).value;
  db.prepare("UPDATE bt_albaranes SET status = 'facturado' WHERE id = ?").bind(id).run();
  db.prepare('UPDATE bt_lines SET pvp_cents = pvp_cents + 100 WHERE booking_id = ?').bind(SEVILLA).run();
  assert.match((await albaranes.revise(tania, SEVILLA)).message, /facturado/);
  assert.match((await albaranes.voidAlbaran(tania, SEVILLA, { void_reason: 'Prueba' })).message, /facturado/);
  const c = await travel.cancel(tania, SEVILLA, { cancel_by: 'cliente', cancel_reason: 'fechas' });
  assert.equal(c.code, 'conflict');
  assert.match(c.message, new RegExp(`${number} está facturado`));
  assert.equal(db.one('SELECT status FROM bt_bookings WHERE id = ?', SEVILLA).status, 'abierta');
});

test('Ajustes: formato del número, próximo número y un número que ya existe se salta', { skip }, async () => {
  const { db, as } = await setup();
  const tania = as('administracion');
  assert.deepEqual((await albaranes.numbering(tania)).value, { pattern: 'ALB-{yyyy}-{n}', next: 'ALB-2026-000001', yearly: true });
  assert.equal((await albaranes.numbering(as('eventos'))).code, 'forbidden');
  assert.equal((await albaranes.saveNumbering(tania, { albaran_pattern: 'ALB-{yyyy}' })).code, 'invalid');
  assert.match((await albaranes.saveNumbering(tania, { albaran_pattern: 'ALB-{mes}-{n}' })).fields.albaran_pattern, /sólo se puede usar/);
  assert.equal((await albaranes.emit(tania, ROCHE)).value.number, 'ALB-2026-000001');
  // Sin el año como variable: otro contador, que empieza en 1… y ALB-2026-000001 ya existe → se salta
  assert.ok((await albaranes.saveNumbering(tania, { albaran_pattern: 'ALB-2026-{n}' })).ok);
  assert.equal((await albaranes.numbering(tania)).value.next, 'ALB-2026-000001');
  assert.equal((await albaranes.emit(tania, SEVILLA)).value.number, 'ALB-2026-000002');
  assert.equal(db.one("SELECT value FROM counters WHERE key = 'bt_albaran'").value, 2);
});

test('la lista de reservas enseña el albarán de cada una y ordena por él', { skip }, async () => {
  const { as } = await setup();
  const tania = as('administracion');
  await albaranes.emit(tania, SEVILLA);
  const { rows } = (await travel.list(tania, { order: 'albaran', dir: 'asc', limit: 50 })).value;
  const sevilla = rows.find((r) => r.id === SEVILLA);
  assert.equal(sevilla.albaran_number, 'ALB-2026-000001');
  assert.equal(sevilla.albaran_status, 'emitido');
  // Primero las que tienen servicios y no tienen albarán; la cancelada (sin albarán) al final
  assert.equal(rows[0].albaran_number, null);
  assert.equal(rows.at(-1).status, 'cancelada');
});
