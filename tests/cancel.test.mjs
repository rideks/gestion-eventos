// Cancelar con motivo: la lista, la validación (con «Otros», comentario) y el texto para el historial
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANCEL_REASONS, CANCEL_SIDES, cancelSummary, countsAsCancellation } from '../src/lib/cancel.js';
import { CancelSchema, validate } from '../src/lib/validate.js';

test('motivos: la lista acaba en «Otros»; quién: el cliente o nosotros', () => {
  assert.equal(Object.keys(CANCEL_REASONS).at(-1), 'otros');
  assert.deepEqual(Object.keys(CANCEL_SIDES), ['cliente', 'agencia']);
});

test('validación: quién y motivo obligatorios; con «Otros», también el comentario', () => {
  assert.deepEqual(Object.keys(validate(CancelSchema, {}).errors).sort(), ['cancel_by', 'cancel_reason']);
  assert.equal(validate(CancelSchema, { cancel_by: 'cliente', cancel_reason: 'otros', cancel_notes: '  ' }).errors.cancel_notes, 'Con «Otros», explica el motivo en el comentario');
  assert.equal(validate(CancelSchema, { cancel_by: 'nadie', cancel_reason: 'precio' }).errors.cancel_by, '¿Quién cancela? Elige el cliente o nosotros');
  const ok = validate(CancelSchema, { cancel_by: 'agencia', cancel_reason: 'precio', cancel_notes: '' });
  assert.deepEqual(ok.data, { cancel_by: 'agencia', cancel_reason: 'precio', cancel_notes: null });
  assert.equal(validate(CancelSchema, { cancel_by: 'cliente', cancel_reason: 'precio', cancel_notes: 'x'.repeat(1001) }).ok, false);
});

test('resumen para el historial y qué cuenta en las cifras del cliente', () => {
  assert.equal(cancelSummary({ cancel_by: 'cliente', cancel_reason: 'competencia', cancel_notes: 'Agencia de Lisboa' }),
    'El cliente · Eligió otra agencia o proveedor · «Agencia de Lisboa»');
  assert.equal(cancelSummary({ cancel_by: 'agencia', cancel_reason: 'precio' }), 'Nosotros · Precio o presupuesto');
  assert.equal(cancelSummary({}), 'sin motivo apuntado'); // las canceladas antes de esta versión
  assert.equal(countsAsCancellation('duplicado'), false);
  assert.equal(countsAsCancellation('precio'), true);
  assert.equal(countsAsCancellation(null), true);
});
