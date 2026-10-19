// Servicio de Business Travel contra una base SQLite en memoria con las migraciones y los datos de ejemplo:
// reservas con su referencia, pasajeros, los cuatro bloques de servicios, importes y fee oculto, permisos y
// historial. Los expedientes no se tocan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, sqliteAvailable } from './helpers/d1.mjs';
import { contextFor, EMAILS } from './helpers/context.mjs';
import * as travel from '../src/services/travel.js';

const skip = (await sqliteAvailable()) ? false : 'necesita Node 22.13 o superior (node:sqlite)';
const setup = async () => {
  const db = await testDb({ demo: true });
  const as = (role, { without = [] } = {}) => {
    const ctx = contextFor(db, EMAILS[role], { now: '2026-10-19' });
    for (const p of without) ctx.user.permissions.delete(p);
    return ctx;
  };
  const clientId = (name) => db.one('SELECT id FROM clients WHERE name = ?', name).id;
  const supplierId = (name) => db.one('SELECT id FROM suppliers WHERE name = ?', name).id;
  const line = (id) => db.one('SELECT * FROM bt_lines WHERE id = ?', id);
  return { db, as, clientId, supplierId, line };
};
const FLIGHT = { supplier: 'Ryanair', description: 'Madrid → Bilbao', start_date: '2026-12-01', end_date: '2026-12-02', locator: 'ABC123', base: '100', total: '', vat: '2100', fee: '15' };

test('reserva nueva: cliente de la lista y referencia correlativa que no se repite', { skip }, async () => {
  const { db, as, clientId } = await setup();
  const ctx = as('eventos');
  const r = await travel.create(ctx, { client: 'ELECNOR', client_id: String(clientId('ELECNOR')), title: 'Viaje a Bilbao' });
  assert.deepEqual(r.value.reference, 'BT-2026-0006'); // en la demo ya hay cinco
  const r2 = await travel.create(ctx, { client: 'elecnor' }); // sin JavaScript: el nombre exacto, sin distinguir mayúsculas
  assert.equal(r2.value.reference, 'BT-2026-0007');
  // Borrar una reserva vacía no libera su número
  assert.ok((await travel.remove(ctx, r2.value.id)).ok);
  assert.equal((await travel.create(ctx, { client: 'ELECNOR' })).value.reference, 'BT-2026-0008');
  const unknown = await travel.create(ctx, { client: 'Roche' });
  assert.equal(unknown.code, 'invalid');
  assert.match(unknown.fields.client, /«Roche» no está dado de alta\. ¿Es «ROCHE FARMA»\?/);
  assert.equal(db.one("SELECT summary FROM change_log WHERE entity = 'bt_booking' AND entity_id = ?", r.value.id).summary, 'Alta de la reserva para ELECNOR');
  assert.equal((await travel.create(as('tecnico'), { client: 'ELECNOR' })).code, 'forbidden');
});

test('pasajeros: tratamiento, datos y quitarlos también de sus servicios', { skip }, async () => {
  const { db, as } = await setup();
  const ctx = as('eventos');
  const id = (await travel.create(ctx, { client: 'ELECNOR' })).value.id;
  const p = await travel.addPassenger(ctx, id, { title: 'Dra.', first_name: 'Ana', last_name: 'Ruiz', email: 'ana@example.com' });
  assert.ok(p.ok);
  assert.equal((await travel.addPassenger(ctx, id, { first_name: '', last_name: 'X' })).code, 'invalid');
  const l = await travel.addLine(ctx, id, 'transporte', FLIGHT, [p.value.id]);
  assert.ok(l.ok);
  const same = await travel.updatePassenger(ctx, id, p.value.id, { title: 'Dra.', first_name: 'Ana', last_name: 'Ruiz', email: 'ana@example.com' });
  assert.equal(same.value.changed, false);
  assert.ok((await travel.updatePassenger(ctx, id, p.value.id, { title: 'Dra.', first_name: 'Ana', last_name: 'Ruiz Pérez', email: 'ana@example.com' })).value.changed);
  assert.ok((await travel.removePassenger(ctx, id, p.value.id)).ok);
  assert.equal(db.one('SELECT COUNT(*) n FROM bt_line_passengers WHERE line_id = ?', l.value.id).n, 0);
  assert.equal((await travel.removePassenger(ctx, id, 99999)).code, 'not_found');
});

test('servicios: proveedor del directorio, pasajeros de la reserva y lo obligatorio de cada bloque', { skip }, async () => {
  const { as, supplierId, line } = await setup();
  const ctx = as('administracion');
  const id = (await travel.create(ctx, { client: 'BMW Ibérica' })).value.id;
  const a = (await travel.addPassenger(ctx, id, { first_name: 'Javier', last_name: 'Martín' })).value.id;
  const b = (await travel.addPassenger(ctx, id, { first_name: 'Lucía', last_name: 'Fernández' })).value.id;
  // Transporte: proveedor obligatorio y de la lista; al menos un pasajero
  assert.equal((await travel.addLine(ctx, id, 'transporte', { ...FLIGHT, supplier: '' }, [a])).fields.supplier, 'Proveedor: elígelo de la lista');
  assert.match((await travel.addLine(ctx, id, 'transporte', { ...FLIGHT, supplier: 'Vueling' }, [a])).fields.supplier, /no está dado de alta/);
  assert.equal((await travel.addLine(ctx, id, 'transporte', FLIGHT, [])).fields.passengers, 'Pasajeros: elige al menos uno');
  const t = await travel.addLine(ctx, id, 'transporte', { ...FLIGHT, supplier_id: String(supplierId('Ryanair')) }, [a, b]);
  assert.ok(t.ok);
  assert.deepEqual([line(t.value.id).supplier, line(t.value.id).base_cents, line(t.value.id).total_cents, line(t.value.id).fee_cents, line(t.value.id).pvp_cents],
    ['Ryanair', 10000, 12100, 1500, 13600]);
  // Pasajeros de otra reserva no cuentan
  assert.equal((await travel.addLine(ctx, id, 'transporte', FLIGHT, [1])).code, 'invalid');
  // Inscripción: un asistente exactamente y sin proveedor
  const ins = { description: 'Congreso', start_date: '2026-12-01', base: '', total: '605', vat: '2100', fee: '' };
  assert.equal((await travel.addLine(ctx, id, 'inscripcion', ins, [a, b])).fields.passengers, 'Asistente: elige uno');
  const i = await travel.addLine(ctx, id, 'inscripcion', ins, [b]);
  assert.deepEqual([line(i.value.id).base_cents, line(i.value.id).total_cents, line(i.value.id).fee_cents, line(i.value.id).supplier], [50000, 60500, 0, null]);
  // Alojamiento: check-in y check-out
  assert.ok((await travel.addLine(ctx, id, 'alojamiento', { supplier: 'Restel', description: 'Hotel', start_date: '2026-12-01', base: '90', vat: '1000' }, [a])).fields.end_date);
  // Otros: sin pasajero, vale
  assert.ok((await travel.addLine(ctx, id, 'otros', { description: 'Seguro de viaje', base: '20', vat: '0' }, [])).ok);
  assert.equal((await travel.addLine(ctx, id, 'crucero', FLIGHT, [a])).code, 'invalid');
});

test('ficha: resumen económico; sin «viajes.fee» no llega el fee y no se puede cambiar', { skip }, async () => {
  const { db, as, line } = await setup();
  const adm = (await travel.detail(as('administracion'), 1)).value;
  assert.deepEqual([adm.summary.count, adm.summary.base, adm.summary.total, adm.summary.fee, adm.summary.pvp], [5, 228864, 266050, 8000, 274050]);
  assert.equal(adm.summary.byKind.inscripcion.count, 2);
  assert.equal(adm.lines.find((l) => l.kind === 'transporte').passenger_ids.length, 2);
  assert.ok(adm.fee && adm.editable && adm.options.length > 0 && adm.clients.length > 0);
  // Eventos: ve todo menos el fee
  const ev = as('eventos');
  const d = (await travel.detail(ev, 1)).value;
  assert.equal(d.fee, false);
  assert.ok(d.lines.every((l) => !('fee_cents' in l)));
  assert.equal(d.summary.fee, undefined);
  assert.equal(d.summary.pvp, 274050);
  assert.ok((await travel.list(ev)).value.rows.every((r) => !('fee_cents' in r)));
  // Si Eventos cambia el servicio, el fee que tenía se conserva (aunque lo intente cambiar)
  const before = line(1);
  assert.ok((await travel.updateLine(ev, 1, 1, { supplier: 'Iryo', description: before.description, start_date: before.start_date, end_date: before.end_date,
    base: '', total: '250', vat: '1000', fee: '999' }, [1, 2])).ok);
  assert.deepEqual([line(1).total_cents, line(1).fee_cents, line(1).pvp_cents], [25000, 1500, 26500]);
  // Uno nuevo de Eventos va sin fee
  const n = await travel.addLine(ev, 1, 'otros', { description: 'Parking', base: '10', vat: '2100', fee: '50' }, []);
  assert.equal(line(n.value.id).fee_cents, 0);
  assert.match(db.one("SELECT summary FROM change_log WHERE entity = 'bt_booking' AND entity_id = 1 ORDER BY id DESC LIMIT 1").summary, /^Añadido: Otros servicios · Parking · PVP 12,10/);
});

test('cancelada: sólo lectura hasta reabrirla; una reserva con servicios no se borra', { skip }, async () => {
  const { as } = await setup();
  const ctx = as('eventos');
  assert.deepEqual((await travel.addPassenger(ctx, 5, { first_name: 'X', last_name: 'Y' })).code, 'conflict');
  assert.equal((await travel.detail(ctx, 5)).value.editable, false);
  assert.ok((await travel.setStatus(ctx, 5, 'abierta')).ok);
  assert.ok((await travel.addPassenger(ctx, 5, { first_name: 'X', last_name: 'Y' })).ok);
  assert.equal((await travel.remove(ctx, 5)).code, 'conflict');
  assert.ok((await travel.setStatus(ctx, 5, 'cancelada')).ok);
  assert.equal((await travel.list(ctx, { status: 'cancelada' })).value.rows.length, 1);
});

test('listado: buscar por pasajero, localizador o proveedor y filtrar por mes', { skip }, async () => {
  const { as } = await setup();
  const ctx = as('eventos');
  const refs = async (f) => (await travel.list(ctx, f)).value.rows.map((r) => r.reference).sort();
  assert.deepEqual(await refs({ q: 'López Serrano' }), ['BT-2026-0001', 'BT-2026-0002']);
  assert.deepEqual(await refs({ q: 'IB9HQ3' }), ['BT-2026-0003']);
  assert.deepEqual(await refs({ q: 'iryo' }), ['BT-2026-0001', 'BT-2026-0004']);
  assert.deepEqual(await refs({ month: '2026-10' }), ['BT-2026-0002']);
  assert.deepEqual(await refs({ month: 'mal' }), ['BT-2026-0001', 'BT-2026-0002', 'BT-2026-0003', 'BT-2026-0004', 'BT-2026-0005']);
  assert.equal((await travel.forClient(ctx, 2)).value.length, 3); // ROCHE FARMA: tres reservas
});

test('cambiar el cliente o la descripción queda en el historial; los expedientes no se tocan', { skip }, async () => {
  const { db, as } = await setup();
  const ctx = as('jefes');
  const exps = db.rows('SELECT id, company, client_id, fee_bp FROM expedientes ORDER BY id');
  const r = await travel.update(ctx, 2, { client: 'GLENMARK', title: 'Reunión de expertos · Sevilla (aplazada)' });
  assert.ok(r.value.changed);
  assert.match(db.one("SELECT summary FROM change_log WHERE entity = 'bt_booking' AND entity_id = 2 AND action = 'datos'").summary, /^Cliente: ROCHE FARMA → GLENMARK · Descripción:/);
  assert.equal((await travel.update(ctx, 2, { client: 'GLENMARK', title: 'Reunión de expertos · Sevilla (aplazada)' })).value.changed, false);
  assert.deepEqual(db.rows('SELECT id, company, client_id, fee_bp FROM expedientes ORDER BY id'), exps);
  assert.equal((await travel.detail(ctx, 999)).code, 'not_found');
  assert.equal((await travel.detail(as('tecnico'), 1)).code, 'forbidden');
});
