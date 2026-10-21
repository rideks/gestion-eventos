import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, REQUIRES, normalizePermissions, permissionDiff, roleKey, sectionPermission, managersAfter } from '../src/lib/permissions.js';
import { can } from '../src/lib/app.js';

test('can(): lista blanca con los permisos de la sesión', () => {
  const eventos = { id: 2, permissions: new Set(['expedientes', 'pagos']) };
  assert.equal(can(eventos, 'pagos'), true);
  assert.equal(can(eventos, 'cobros'), false);
  assert.equal(can(eventos, 'algo-que-no-existe'), false);
  assert.equal(can(null, 'expedientes'), false);
  assert.equal(can({ id: 9 }, 'expedientes'), false); // sin permisos cargados: nada
});

test('el catálogo no tiene claves repetidas y cada dependencia existe', () => {
  const keys = PERMISSIONS.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const [k, base] of Object.entries(REQUIRES)) {
    assert.ok(keys.includes(k), k);
    assert.ok(keys.includes(base), base);
  }
});

test('normalizePermissions: quita lo desconocido y lo que no tiene su base (en cadena)', () => {
  assert.deepEqual(normalizePermissions(['cobros', 'invoice.issue', 'inventado']), { permissions: [], dropped: ['cobros', 'invoice.issue'] });
  const ok = normalizePermissions(['invoice.issue', 'cobros', 'expedientes']);
  assert.deepEqual(ok.permissions, ['expedientes', 'cobros', 'invoice.issue']); // en el orden del catálogo
  assert.deepEqual(ok.dropped, []);
  // Sin «pagos» no hay transferencias ni justificante
  assert.deepEqual(normalizePermissions(['expedientes', 'payment.any_method', 'payment.receipt']).permissions, ['expedientes']);
  assert.deepEqual(normalizePermissions(['users']).permissions, ['users']);
});

test('permissionDiff y roleKey', () => {
  assert.deepEqual(permissionDiff(['a', 'b'], ['b', 'c']), { added: ['c'], removed: ['a'] });
  assert.equal(roleKey('Ventas y Tesorería'), 'ventas_y_tesoreria');
  assert.equal(roleKey('  Técnico  '), 'tecnico');
  assert.equal(roleKey('¡¡!!'), 'rol');
});

test('sectionPermission: cada parte pide su permiso y lo desconocido queda cerrado', () => {
  assert.equal(sectionPermission('/'), '');
  assert.equal(sectionPermission('/cuenta'), '');
  assert.equal(sectionPermission('/expedientes'), 'expedientes');
  assert.equal(sectionPermission('/expedientes/3/cierre.csv'), 'expedientes');
  assert.equal(sectionPermission('/archivos/12/factura.pdf'), 'expedientes');
  assert.equal(sectionPermission('/buscar'), 'expedientes');
  assert.equal(sectionPermission('/pagos'), 'pagos');
  assert.equal(sectionPermission('/cobros'), 'cobros');
  assert.equal(sectionPermission('/usuarios/roles/2'), 'users');
  assert.equal(sectionPermission('/ajustes'), 'settings');
  assert.equal(sectionPermission('/expedientesX'), null);
  assert.equal(sectionPermission('/pagina-nueva'), null);
});

test('managersAfter: siempre tiene que quedar alguien que gestione usuarios', () => {
  // Técnico (rol 5) con 'users'; Tania (1) Administración, Soporte (5) Técnico
  const users = [{ id: 1, role_id: 2, active: 1 }, { id: 5, role_id: 5, active: 1 }, { id: 6, role_id: 5, active: 0 }];
  const managers = [5];
  assert.equal(managersAfter(users, managers), 1);
  assert.equal(managersAfter(users, managers, { userId: 5, newRoleId: 2 }), 0); // se le quita el rol al único
  assert.equal(managersAfter(users, managers, { userId: 5, active: false }), 0); // se le desactiva
  assert.equal(managersAfter(users, managers, { userId: 6, active: true }), 2); // se reactiva otro técnico
  assert.equal(managersAfter(users, managers, { roleId: 5, hasUsersPerm: false }), 0); // se quita el permiso al rol
  assert.equal(managersAfter(users, managers, { roleId: 2, hasUsersPerm: true }), 2); // se da a Administración
  assert.equal(managersAfter(users, managers, { userId: 1, newRoleId: 5 }), 2); // Tania pasa a Técnico
});

test('applyPermissionChanges: sólo lo cambiado, sobre lo guardado ahora, y sin quitar nada a escondidas', async () => {
  const { applyPermissionChanges } = await import('../src/lib/permissions.js');
  // Se abrió con expedientes + pagos + cobros; entre tanto otra persona quitó «pagos»; ahora se añade «invoice.issue»
  const r = applyPermissionChanges({ current: ['expedientes', 'cobros'], original: ['expedientes', 'pagos', 'cobros'], wanted: ['expedientes', 'pagos', 'cobros', 'invoice.issue'] });
  assert.deepEqual(r, { permissions: ['expedientes', 'cobros', 'invoice.issue'], added: ['invoice.issue'], removed: [], missing: [] });
  // Quitar la base y dejar el que depende de ella: se avisa, no se quita en silencio
  const m = applyPermissionChanges({ current: ['expedientes', 'cobros', 'invoice.issue'], original: ['expedientes', 'cobros', 'invoice.issue'], wanted: ['expedientes', 'invoice.issue'] });
  assert.deepEqual(m.missing, [{ key: 'invoice.issue', base: 'cobros' }]);
  // Lo desconocido no entra; sin original, lo enviado sustituye
  assert.deepEqual(applyPermissionChanges({ current: ['expedientes'], wanted: ['pagos', 'inventado', 'expedientes'] }).permissions, ['expedientes', 'pagos']);
});
