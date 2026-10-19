-- ════════════════════════════════════════════════════════════════════════════
-- Datos de EJEMPLO para desarrollo local (npm run db:demo). NUNCA en producción.
-- Borra todo (también los tipos de IVA y de proveedor, que vuelven a los de serie) y carga cuatro expedientes basados en casos reales:
--   · EXP 1287 Workshop BMW (Valladolid)      → celebrado, por cerrar (como el Excel de cierre)
--   · EXP 1285 Jornadas de trabajo ELECNOR    → cerrado
--   · EXP 1289 Convención anual ROCHE         → en curso, con pagos urgentes y una factura pedida
--   · Lanzamiento Winlevi GLENMARK            → solicitud pendiente de abrir
-- Cuentas, una por rol (contraseña de todas: demo-gestion-2026):
--   tania@example.com (Administración) · marta@example.com (Eventos) · direccion@example.com (Jefes)
--   tesoreria@example.com (Tesorería) · tecnico@example.com (Técnico)
-- Los roles vuelven al reparto inicial de permisos (los roles creados a mano se borran).
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM activity; DELETE FROM invoice_pos; DELETE FROM invoices; DELETE FROM purchase_orders;
DELETE FROM payment_documents; DELETE FROM payments; DELETE FROM supplier_invoices; DELETE FROM budgets; DELETE FROM files; DELETE FROM expedientes;
DELETE FROM bt_line_passengers; DELETE FROM bt_lines; DELETE FROM bt_passengers; DELETE FROM bt_bookings; DELETE FROM counters;
DELETE FROM change_log; DELETE FROM client_entities; DELETE FROM client_aliases; DELETE FROM clients;
DELETE FROM supplier_contract_changes; DELETE FROM supplier_contracts;
DELETE FROM supplier_aliases; DELETE FROM suppliers; DELETE FROM supplier_types;
INSERT INTO supplier_types (name, sort) VALUES
  ('Hotel', 10), ('Venue / espacio', 20), ('Restaurante', 30), ('Catering', 40), ('Actividades', 50),
  ('Formación', 60), ('Transporte', 70), ('Aerolínea', 72), ('Tren', 74), ('Central de reservas', 76), ('Inscripciones y congresos', 78),
  ('Audiovisuales', 80), ('Otros', 90);
DELETE FROM sessions; DELETE FROM invites; DELETE FROM login_attempts; DELETE FROM user_prefs; DELETE FROM users;
DELETE FROM role_permissions; DELETE FROM roles WHERE system = 0;
-- Reparto inicial (el de migrations/0008_roles_y_permisos.sql más los de 0009, 0010 y 0011)
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.value FROM roles r, json_each(CASE r.key
  WHEN 'jefes' THEN '["expedientes","expediente.open","expediente.close","pagos","payment.any_method","payment.receipt","payment.unpay","supplier.review","cobros","invoice.issue","po.manage","delete","settings","proveedores","proveedores.create","proveedores.edit","proveedores.gasto","contratos","contratos.edit","clientes","clientes.create","clientes.edit","clientes.economia","viajes","viajes.fee","viajes.close"]'
  WHEN 'administracion' THEN '["expedientes","expediente.open","expediente.close","pagos","payment.any_method","payment.receipt","payment.unpay","supplier.review","cobros","invoice.issue","po.manage","delete","settings","proveedores","proveedores.create","proveedores.edit","proveedores.gasto","contratos","contratos.edit","clientes","clientes.create","clientes.edit","clientes.economia","viajes","viajes.fee","viajes.close"]'
  WHEN 'tesoreria' THEN '["expedientes","pagos","payment.any_method","payment.receipt","payment.unpay","supplier.review","cobros","invoice.issue","po.manage","proveedores","proveedores.create","proveedores.edit","proveedores.gasto","contratos","contratos.edit","clientes","clientes.create","clientes.edit","clientes.economia","viajes","viajes.fee"]'
  WHEN 'eventos' THEN '["expedientes","pagos","proveedores","proveedores.create","clientes","clientes.create","viajes"]'
  WHEN 'tecnico' THEN '["users"]'
END) p;
DELETE FROM vat_rates;
INSERT INTO vat_rates (label, rate_bp, is_default) VALUES
  ('IVA 21 %', 2100, 1), ('IVA 10 %', 1000, 0), ('IGIC 7 %', 700, 0), ('IVA 4 %', 400, 0), ('Exento 0 %', 0, 0);

INSERT INTO users (id, name, email, password_hash, role_id) VALUES
  (1, 'Tania Ruiz', 'tania@example.com', 'pbkdf2_sha256$100000$__QfineYgXfs8JUGqQApDA$jbnAas9k3TpwoirVVEFv0zAry4JzQmwl9irBZYiV78o', (SELECT id FROM roles WHERE key = 'administracion')),
  (2, 'Marta López', 'marta@example.com', 'pbkdf2_sha256$100000$__QfineYgXfs8JUGqQApDA$jbnAas9k3TpwoirVVEFv0zAry4JzQmwl9irBZYiV78o', (SELECT id FROM roles WHERE key = 'eventos')),
  (3, 'Carlos Vidal', 'direccion@example.com', 'pbkdf2_sha256$100000$__QfineYgXfs8JUGqQApDA$jbnAas9k3TpwoirVVEFv0zAry4JzQmwl9irBZYiV78o', (SELECT id FROM roles WHERE key = 'jefes')),
  (4, 'Elena Martín', 'tesoreria@example.com', 'pbkdf2_sha256$100000$__QfineYgXfs8JUGqQApDA$jbnAas9k3TpwoirVVEFv0zAry4JzQmwl9irBZYiV78o', (SELECT id FROM roles WHERE key = 'tesoreria')),
  (5, 'Soporte técnico', 'tecnico@example.com', 'pbkdf2_sha256$100000$__QfineYgXfs8JUGqQApDA$jbnAas9k3TpwoirVVEFv0zAry4JzQmwl9irBZYiV78o', (SELECT id FROM roles WHERE key = 'tecnico'));

INSERT INTO expedientes (id, number, name, company, contact_name, contact_email, contact_phone, destination, start_date, end_date, attendees, notes,
                         status, manager_id, requested_by, requested_at, opened_by, opened_at, closed_by, closed_at) VALUES
  (1, 1287, 'Workshop BMW', 'BMW Ibérica', 'Laura Gómez', 'laura.gomez@example.com', '+34 600 111 222', 'Valladolid', '2026-08-26', '2026-08-27', 120,
   'Los concesionarios (Grunblau, Celtamotor…) pagan su parte con factura propia.', 'abierto', 2, 2, '2026-06-10T09:12:00Z', 1, '2026-06-10T11:40:00Z', NULL, NULL),
  (2, 1285, 'Jornadas de trabajo', 'ELECNOR', 'Ana Fernández', 'ana.fernandez@example.com', NULL, 'Toledo', '2026-05-06', '2026-05-07', 50,
   NULL, 'cerrado', 2, 2, '2026-03-02T08:30:00Z', 1, '2026-03-02T10:05:00Z', 1, '2026-06-15T16:20:00Z'),
  (3, 1289, 'Convención anual', 'ROCHE FARMA', 'Javier Molina', 'javier.molina@example.com', '+34 600 333 444', 'Sevilla', '2026-11-12', '2026-11-14', 220,
   'Anticipo del 50 % con PO; el resto, a la vuelta.', 'abierto', 2, 2, '2026-09-20T10:00:00Z', 1, '2026-09-21T08:15:00Z', NULL, NULL),
  (4, NULL, 'Lanzamiento Winlevi', 'GLENMARK', 'Josephin Malade', 'josephin.malade@example.com', NULL, 'Marbella', '2027-04-20', '2027-04-22', 180,
   'El cliente quiere la factura del hotel separada del resto.', 'solicitado', 2, 2, '2026-10-16T15:42:00Z', NULL, NULL, NULL, NULL);

-- Presupuestos con su desglose por tipos de IVA (alojamiento al 10 %, servicios al 21 %)
INSERT INTO budgets (expediente_id, version, base_cents, total_cents, vat_lines, note, created_by, created_at) VALUES
  (1, 1, 5850000, 6890000, '[{"rate":1000,"label":"IVA 10 %","base":1713636,"total":1885000},{"rate":2100,"label":"IVA 21 %","base":4136364,"total":5005000}]', 'Presupuesto aprobado por el cliente', 2, '2026-06-10T09:12:00Z'),
  (1, 2, 6300000, 7415000, '[{"rate":1000,"label":"IVA 10 %","base":1890909,"total":2080000},{"rate":2100,"label":"IVA 21 %","base":4409091,"total":5335000}]', 'Cena para concesionarios y merchandising', 2, '2026-07-28T12:00:00Z'),
  (2, 1, 1894000, 2151240, '[{"rate":1000,"label":"IVA 10 %","base":1277273,"total":1405000},{"rate":2100,"label":"IVA 21 %","base":616727,"total":746240}]', 'Presupuesto aprobado por el cliente', 2, '2026-03-02T08:30:00Z'),
  (3, 1, 9640000, 11086000, '[{"rate":1000,"label":"IVA 10 %","base":5258182,"total":5784000},{"rate":2100,"label":"IVA 21 %","base":4381818,"total":5302000}]', 'Presupuesto aprobado por el cliente', 2, '2026-09-20T10:00:00Z'),
  (4, 1, 13000000, 15020000, '[{"rate":1000,"label":"IVA 10 %","base":6454546,"total":7100001},{"rate":2100,"label":"IVA 21 %","base":6545454,"total":7919999}]', 'Presupuesto aprobado por el cliente', 2, '2026-10-16T15:42:00Z');

-- ── EXP 1287 · lado izquierdo del Excel de cierre ─────────────────────────
INSERT INTO payments (expediente_id, supplier, concept, invoice_number, invoice_date, base_cents, total_cents, vat, due_date, status, paid_on, method, planned, created_by) VALUES
  (1, 'Hotel Barceló Valladolid', 'Alojamiento', '10000001225', '2026-08-01', 238182, 262000, '10', '2026-08-10', 'pagado', '2026-08-08', 'transferencia', 1, 2),
  (1, 'Hotel Barceló Valladolid', 'Sala y coffee break', '10000002019', '2026-08-27', 280492, 330360, 'mixto', '2026-09-15', 'pagado', '2026-09-10', 'transferencia', 1, 2),
  (1, 'Hotel Barceló Valladolid', 'Extras', '10000003052', '2026-08-28', 33000, 36300, '10', '2026-09-15', 'pagado', '2026-09-10', 'transferencia', 0, 2),
  (1, 'Hotel Barceló Valladolid', 'Factura de comisión', 'NT/000086/26', '2026-09-05', -23255, -39150, 'mixto', NULL, 'pagado', '2026-09-20', 'transferencia', 0, 1),
  (1, 'La Parrilla de San Lorenzo', 'Cena · transferencia', 'F000102/596', '2026-08-26', 279545, 307500, '10', '2026-08-25', 'pagado', '2026-08-24', 'transferencia', 1, 2),
  (1, 'La Parrilla de San Lorenzo', 'Cena · tarjeta', 'F000102/596', '2026-08-26', 36655, 40320, '10', NULL, 'pagado', '2026-08-26', 'tarjeta', 0, 2),
  (1, 'Bolsas Chino', NULL, '496', '2026-08-18', 3164, 3828, '21', NULL, 'pagado', '2026-08-18', 'tarjeta', 0, 2),
  (1, 'Bolsas Chino', 'Devolución', '498', '2026-08-20', -2669, -3229, '21', NULL, 'pagado', '2026-08-20', 'tarjeta', 0, 2),
  (1, 'Mentimeter', 'Licencia votaciones', '33C5526E-962314', '2026-08-12', 16800, 20328, '21', NULL, 'pagado', '2026-08-12', 'tarjeta', 0, 2),
  (1, 'Panteleón Muñoz', 'Fotógrafo', '134', '2026-08-27', 44500, 48950, '10', NULL, 'pagado', '2026-08-27', 'tarjeta', 0, 2),
  (1, 'AV Sistemas', 'Audiovisuales', '238', '2026-08-30', 277406, 335661, '21', '2026-10-10', 'pendiente', NULL, NULL, 1, 2),
  (1, 'Work Center', 'Impresión', 'AP26009610', '2026-08-21', 29552, 35758, '21', NULL, 'pagado', '2026-08-21', 'tarjeta', 0, 2),
  (1, 'Work Center', 'Impresión', 'AP26009612', '2026-08-22', 8415, 10182, '21', NULL, 'pagado', '2026-08-22', 'tarjeta', 0, 2),
  (1, 'Gráficas Mercurio', 'Merchandising', '0234 / 2026', '2026-09-20', 39100, 47311, '21', '2026-10-21', 'pendiente', NULL, NULL, 0, 2);

UPDATE payments SET vat_lines = '[{"rate":1000,"label":"IVA 10 %","base":82145,"total":90360},{"rate":2100,"label":"IVA 21 %","base":198347,"total":240000}]'
 WHERE invoice_number = '10000002019';

INSERT INTO purchase_orders (id, expediente_id, number, billed_to, amount_cents, issued_on, notes, created_by) VALUES
  (1, 1, '4500881200', 'BMW Ibérica', 1452046, '2026-07-20', 'Alojamiento y sala', 1),
  (2, 1, '4500881201', 'BMW Ibérica', 1998000, '2026-07-31', 'Restauración y audiovisuales', 1),
  (3, 1, '4500890045', 'BMW Ibérica', 1392220, '2026-09-15', 'Cena concesionarios', 1),
  (4, 1, '4500890046', 'BMW Ibérica', 1351700, '2026-08-20', 'Merchandising y extras', 1);

INSERT INTO invoices (id, expediente_id, number, billed_to, concept, base_cents, total_cents, vat, status, issued_on, due_date, collected_on, created_by) VALUES
  (1, 1, 'G/000808/26/01', 'BMW Ibérica', 'Alojamiento y sala', 1452046, 1667777, 'mixto', 'cobrada', '2026-07-25', '2026-08-24', '2026-08-24', 2),
  (2, 1, 'G/000852/26/01', 'BMW Ibérica', 'Restauración y audiovisuales', 1998000, 2292198, 'mixto', 'cobrada', '2026-08-05', '2026-09-04', '2026-09-03', 2),
  (3, 1, NULL, 'BMW Ibérica', 'Cena concesionarios', 1392220, 1684586, '21', 'por_emitir', NULL, NULL, NULL, 2),
  (4, 1, 'G/000903/26/01', 'BMW Ibérica', 'Merchandising y extras', 1351700, 1528923, 'mixto', 'emitida', '2026-09-01', '2026-10-01', NULL, 2),
  (5, 1, 'G/000835/26/01', 'Grunblau', 'Plaza concesionario', 14515, 16000, 'mixto', 'cobrada', '2026-08-28', '2026-09-27', '2026-09-20', 1),
  (6, 1, 'G/000836/26/01', 'Celtamotor', 'Plazas concesionario', 43636, 48000, '10', 'cobrada', '2026-08-28', '2026-09-27', '2026-09-22', 1),
  (7, 1, 'G/000837/26/01', 'Triocar', 'Plaza concesionario', 14515, 16000, 'mixto', 'cobrada', '2026-08-28', '2026-09-27', '2026-09-25', 1),
  (8, 1, 'G/000840/26/01', 'Amiocar', 'Plazas concesionario', 29091, 32000, '10', 'cobrada', '2026-08-28', '2026-09-27', '2026-09-19', 1),
  (9, 1, 'G/000838/26/01', 'Burgocar', 'Plaza concesionario', 14515, 16000, 'mixto', 'cobrada', '2026-08-28', '2026-09-27', '2026-09-26', 1),
  (10, 1, 'G/000841/26/01', 'Burgocar', 'Plazas concesionario', 29091, 32000, '10', 'cobrada', '2026-08-28', '2026-09-27', '2026-09-26', 1),
  (11, 1, 'G/000842/26/01', 'Marmotor', 'Plazas concesionario', 67273, 74000, '10', 'cobrada', '2026-08-28', '2026-09-27', '2026-09-24', 1),
  (12, 1, 'G/000843/26/01', 'Canario Alemana', 'Plaza concesionario', 13455, 14800, '10', 'cobrada', '2026-08-28', '2026-09-27', '2026-09-23', 1),
  (13, 1, 'G/000844/26/01', 'Bymycar', 'Plaza concesionario', 13455, 14800, '10', 'emitida', '2026-09-30', '2026-10-30', NULL, 1);

INSERT INTO invoice_pos (invoice_id, po_id, amount_cents) VALUES
  (1, 1, 1452046), (2, 2, 1998000), (3, 3, 1392220), (4, 4, 1351700);

-- ── EXP 1285 · ELECNOR (cerrado) ──────────────────────────────────────────
INSERT INTO payments (expediente_id, supplier, concept, invoice_number, invoice_date, base_cents, total_cents, vat, due_date, status, paid_on, method, planned, created_by) VALUES
  (2, 'Hotel Beatriz Toledo', 'Alojamiento 05/05 y 06/05', 'FB-2026-0412', '2026-05-07', 657200, 722920, '10', '2026-04-20', 'pagado', '2026-04-18', 'transferencia', 1, 2),
  (2, 'Hotel Beatriz Toledo', 'Sala plenaria', 'FB-2026-0412', '2026-05-07', 109500, 132495, '21', '2026-04-20', 'pagado', '2026-04-18', 'transferencia', 1, 2),
  (2, 'Hotel Beatriz Toledo', 'Restauración', 'FB-2026-0430', '2026-05-08', 310000, 341000, '10', '2026-05-30', 'pagado', '2026-05-28', 'transferencia', 1, 2),
  (2, 'Hotel 1881 Madrid', 'Alojamiento 05/05', 'H1881-7781', '2026-05-06', 224545, 247000, '10', '2026-04-30', 'pagado', '2026-04-29', 'transferencia', 1, 2),
  (2, 'Sonido Toledo', 'Audiovisuales y técnico', 'ST-118', '2026-05-08', 264350, 319864, '21', '2026-06-08', 'pagado', '2026-06-05', 'transferencia', 0, 2);
INSERT INTO purchase_orders (id, expediente_id, number, billed_to, amount_cents, issued_on, created_by) VALUES
  (5, 2, '4100223344', 'ELECNOR', 1894000, '2026-03-10', 1);
INSERT INTO invoices (id, expediente_id, number, billed_to, concept, base_cents, total_cents, vat, status, issued_on, due_date, collected_on, created_by) VALUES
  (14, 2, 'G/000412/26/01', 'ELECNOR', 'Jornadas de trabajo Toledo', 1894000, 2151240, 'mixto', 'cobrada', '2026-05-08', '2026-06-07', '2026-06-05', 1);
INSERT INTO invoice_pos (invoice_id, po_id, amount_cents) VALUES (14, 5, 1894000);

-- ── EXP 1289 · ROCHE (en curso) ───────────────────────────────────────────
INSERT INTO payments (expediente_id, supplier, concept, invoice_number, invoice_date, base_cents, total_cents, vat, due_date, status, paid_on, method, planned, created_by) VALUES
  (3, 'Hotel Alfonso XIII', '1er pago alojamiento', NULL, NULL, 3181818, 3500000, '10', '2026-10-15', 'pendiente', NULL, NULL, 1, 2),
  (3, 'Hotel Alfonso XIII', '2º pago alojamiento', NULL, NULL, 3636364, 4000000, '10', '2026-11-05', 'pendiente', NULL, NULL, 1, 2),
  (3, 'Fluge Audiovisuales', 'Escenario y streaming', NULL, NULL, 1200000, 1452000, '21', '2026-11-20', 'pendiente', NULL, NULL, 1, 2),
  (3, 'Autocares Sevilla', 'Traslados aeropuerto', NULL, NULL, 250000, 302500, '21', '2026-10-22', 'pendiente', NULL, NULL, 1, 2),
  (3, 'Catering Lazo', 'Señal cena de gala', NULL, NULL, 200000, 220000, '10', NULL, 'pagado', '2026-10-01', 'tarjeta', 0, 2);
INSERT INTO purchase_orders (id, expediente_id, number, billed_to, amount_cents, issued_on, notes, created_by) VALUES
  (6, 3, '4700112233', 'ROCHE FARMA', 4820000, '2026-10-05', 'Anticipo 50 %', 1);
INSERT INTO invoices (id, expediente_id, number, billed_to, concept, base_cents, total_cents, vat, vat_lines, status, created_by, created_at) VALUES
  (15, 3, NULL, 'ROCHE FARMA', 'Anticipo 50 % convención', 4820000, 5502200, 'mixto',
   '[{"rate":1000,"label":"IVA 10 %","base":3000000,"total":3300000},{"rate":2100,"label":"IVA 21 %","base":1820000,"total":2202200}]',
   'por_emitir', 2, '2026-10-16T09:30:00Z');
INSERT INTO invoice_pos (invoice_id, po_id, amount_cents) VALUES (15, 6, 4820000);

-- ── Solicitud · GLENMARK (por abrir) ──────────────────────────────────────
INSERT INTO payments (expediente_id, supplier, concept, base_cents, total_cents, vat, due_date, planned, created_by) VALUES
  (4, 'Hotel Puente Romano', '1er pago (lo exige el hotel)', 1945455, 2140000, '10', '2027-01-29', 1, 2),
  (4, 'Hotel Puente Romano', '2º pago', 2600000, 2860000, '10', '2027-02-28', 1, 2),
  (4, 'DMC Marbella', 'Traslados y actividades', 500000, 605000, '21', '2027-04-01', 1, 2);

-- ── Documentos del proveedor ──────────────────────────────────────────────
-- Arriba los pagos llevan su nº de factura; aquí pasan a ser facturas aparte (como hacen las
-- migraciones 0003 y 0005). La de La Parrilla (F000102/596) cubre DOS pagos: transferencia y tarjeta.
INSERT INTO supplier_invoices (expediente_id, kind, supplier, number, issued_on, review, reviewed_by, reviewed_at, uploaded_by, uploaded_at)
SELECT expediente_id, 'factura', supplier, invoice_number, MIN(invoice_date), 'conforme', 1, MIN(created_at), MIN(created_by), MIN(created_at)
  FROM payments WHERE invoice_number IS NOT NULL
 GROUP BY expediente_id, supplier, invoice_number;
INSERT INTO payment_documents (payment_id, document_id)
SELECT p.id, si.id FROM payments p JOIN supplier_invoices si
    ON si.expediente_id = p.expediente_id AND si.supplier = p.supplier AND si.number = p.invoice_number
 WHERE p.invoice_number IS NOT NULL;
UPDATE payments SET invoice_number = NULL, invoice_date = NULL, file_id = NULL;
-- Proforma del hotel para el 1er pago de ROCHE (las proformas no se revisan ni avisan)
INSERT INTO supplier_invoices (expediente_id, kind, supplier, number, issued_on, total_cents, uploaded_by, uploaded_at, notes)
VALUES (3, 'proforma', 'Hotel Alfonso XIII', 'PF-2026-118', '2026-09-25', 3500000, 2, '2026-09-26T09:00:00Z', 'Proforma del 1er pago: el hotel la pide pagada antes del 15/10');
INSERT INTO payment_documents (payment_id, document_id)
SELECT p.id, si.id FROM payments p, supplier_invoices si WHERE p.concept = '1er pago alojamiento' AND si.number = 'PF-2026-118';
UPDATE supplier_invoices SET total_cents = 347820 WHERE number = 'F000102/596';
-- Recién subida por Marta: le sale a Tania en la campana para revisarla
UPDATE supplier_invoices SET review = 'pendiente', reviewed_by = NULL, reviewed_at = NULL, uploaded_by = 2, uploaded_at = '2026-10-16T10:00:00Z'
 WHERE number = '0234 / 2026';
-- Pago ya hecho (con tarjeta) cuya factura acaba de llegar: lista para conformar (sale en la campana).
-- La de Gráficas Mercurio, en cambio, espera a que se haga su pago.
UPDATE supplier_invoices SET review = 'pendiente', reviewed_by = NULL, reviewed_at = NULL, uploaded_by = 2, uploaded_at = '2026-10-17T09:30:00Z'
 WHERE number = '33C5526E-962314';

-- ── Facturas al cliente: datos fiscales, envío y numeración ───────────────
-- Las emitidas ya se enviaron (fuera de la aplicación). Datos fiscales y de la empresa: de EJEMPLO.
UPDATE invoices SET billed_tax_id = 'A00000001', billed_address = 'Avenida de Ejemplo 1, 28000 Madrid', billed_email = 'facturas.bmw@example.com'
 WHERE billed_to = 'BMW Ibérica' AND status <> 'por_emitir';
UPDATE invoices SET billed_tax_id = 'A00000002', billed_address = 'Calle de Ejemplo 2, 28000 Madrid', billed_email = 'facturas.elecnor@example.com'
 WHERE billed_to = 'ELECNOR';
UPDATE invoices SET billed_tax_id = 'B00000' || printf('%03d', id), billed_address = 'Polígono de Ejemplo, 47000 Valladolid'
 WHERE expediente_id = 1 AND billed_to <> 'BMW Ibérica';
UPDATE invoices SET sent_at = issued_on || 'T10:00:00Z' WHERE status IN ('emitida', 'cobrada');
DELETE FROM settings WHERE key = 'invoice_pattern' OR key LIKE 'invoice_next%' OR key LIKE 'company_%';
INSERT INTO settings (key, value) VALUES
  ('invoice_pattern', 'G/{n}/{yy}/01'),
  ('company_legal_name', 'Seven Worlds Events & Congresses, S.L.'),
  ('company_tax_id', 'B00000000'),
  ('company_address', 'Calle de Ejemplo 7, 28001 Madrid'),
  ('company_iban', 'ES00 0000 0000 0000 0000 0000'),
  ('company_email', 'administracion@example.com');

-- ── Actividad ─────────────────────────────────────────────────────────────
INSERT INTO activity (expediente_id, user_id, user_name, action, text, at) VALUES
  (1, 2, 'Marta López', 'expediente.request', 'pidió el expediente con un presupuesto de 58.500,00 € sin IVA y 4 pagos previstos', '2026-06-10T09:12:00Z'),
  (1, 1, 'Tania Ruiz', 'expediente.open', 'abrió el expediente con el número 1287', '2026-06-10T11:40:00Z'),
  (1, 2, 'Marta López', 'budget.add', 'subió la versión 2 del presupuesto: 63.000,00 € sin IVA (+4.500,00 €). Cena para concesionarios y merchandising', '2026-07-28T12:00:00Z'),
  (1, 1, 'Tania Ruiz', 'invoice.issue', 'emitió la factura G/000903/26/01 a BMW Ibérica (15.289,23 €) con la PO 4500890046', '2026-09-01T10:00:00Z'),
  (1, 1, 'Tania Ruiz', 'po.add', 'subió la PO 4500890045 de BMW Ibérica (13.922,20 € sin IVA)', '2026-09-15T08:20:00Z'),
  (1, 2, 'Marta López', 'invoice.request', 'pidió una factura a BMW Ibérica por 16.845,86 € con la PO 4500890045', '2026-10-15T09:00:00Z'),
  (1, 2, 'Marta López', 'note', 'BMW confirma que la PO de la cena ya está aprobada en su sistema: se puede facturar.', '2026-10-15T09:05:00Z'),
  (1, 2, 'Marta López', 'supplier_invoice.add', 'subió la factura 0234 / 2026 de Gráficas Mercurio (473,11 €) · pendiente de revisar', '2026-10-16T10:00:00Z'),
  (1, 2, 'Marta López', 'supplier_invoice.add', 'subió la factura 33C5526E-962314 de Mentimeter (203,28 €) · pendiente de revisar', '2026-10-17T09:30:00Z'),
  (2, 1, 'Tania Ruiz', 'expediente.close', 'cerró el expediente: ventas 18.940,00 €, costes 15.655,95 €, beneficio 3.284,05 €', '2026-06-15T16:20:00Z'),
  (3, 2, 'Marta López', 'expediente.request', 'pidió el expediente con un presupuesto de 96.400,00 € sin IVA y 4 pagos previstos', '2026-09-20T10:00:00Z'),
  (3, 1, 'Tania Ruiz', 'expediente.open', 'abrió el expediente con el número 1289', '2026-09-21T08:15:00Z'),
  (3, 2, 'Marta López', 'supplier_proforma.add', 'subió la proforma PF-2026-118 de Hotel Alfonso XIII (35.000,00 €). Comentario: Proforma del 1er pago: el hotel la pide pagada antes del 15/10', '2026-09-26T09:00:00Z'),
  (3, 2, 'Marta López', 'payment.add', 'añadió un pago a Catering Lazo (2.200,00 €)', '2026-10-01T13:00:00Z'),
  (3, 1, 'Tania Ruiz', 'po.add', 'subió la PO 4700112233 de ROCHE FARMA (48.200,00 € sin IVA)', '2026-10-05T09:40:00Z'),
  (3, 2, 'Marta López', 'invoice.request', 'pidió una factura a ROCHE FARMA por 55.022,00 € con la PO 4700112233', '2026-10-16T09:30:00Z'),
  (4, 2, 'Marta López', 'expediente.request', 'pidió el expediente con un presupuesto de 130.000,00 € sin IVA y 3 pagos previstos', '2026-10-16T15:42:00Z');

-- ── Proveedores: el directorio sale de los nombres de los pagos; algunas fichas, completas ─────────
INSERT INTO suppliers (name, created_by)
SELECT TRIM(supplier), 1 FROM payments WHERE TRIM(supplier) <> ''
UNION
SELECT TRIM(supplier), 1 FROM supplier_invoices WHERE TRIM(supplier) <> ''
ON CONFLICT (name) DO NOTHING;
UPDATE payments SET supplier_id = (SELECT s.id FROM suppliers s WHERE s.name = TRIM(payments.supplier));
UPDATE supplier_invoices SET supplier_id = (SELECT s.id FROM suppliers s WHERE s.name = TRIM(supplier_invoices.supplier));

UPDATE suppliers SET type_id = (SELECT id FROM supplier_types WHERE name = 'Hotel') WHERE name LIKE 'Hotel %';
UPDATE suppliers SET type_id = (SELECT id FROM supplier_types WHERE name = 'Restaurante') WHERE name = 'La Parrilla de San Lorenzo';
UPDATE suppliers SET type_id = (SELECT id FROM supplier_types WHERE name = 'Catering') WHERE name = 'Catering Lazo';
UPDATE suppliers SET type_id = (SELECT id FROM supplier_types WHERE name = 'Audiovisuales') WHERE name IN ('AV Sistemas', 'Fluge Audiovisuales', 'Sonido Toledo');
UPDATE suppliers SET type_id = (SELECT id FROM supplier_types WHERE name = 'Transporte') WHERE name = 'Autocares Sevilla';
UPDATE suppliers SET type_id = (SELECT id FROM supplier_types WHERE name = 'Actividades') WHERE name = 'DMC Marbella';
UPDATE suppliers SET city = 'Valladolid', contact_name = 'Departamento de grupos', phone = '+34 983 000 000', email = 'grupos.valladolid@example.com',
       max_capacity = 400, since_on = '2025-02-01',
       economic_terms = 'Tarifa de grupos 2026: habitación doble 118 € · sala plenaria 1.200 €/día. 10 % de comisión sobre alojamiento.',
       payment_terms = '50 % a la confirmación y el resto 7 días antes del evento. Factura de comisión al cierre.',
       notes = 'Muy buena respuesta en eventos de concesionarios. Pedir siempre la factura de comisión.'
 WHERE name = 'Hotel Barceló Valladolid';
UPDATE suppliers SET city = 'Sevilla', contact_name = 'Eventos y congresos', email = 'eventos.sevilla@example.com', max_capacity = 600,
       payment_terms = 'Proforma del 1er pago antes del 15/10; 2º pago antes del evento.'
 WHERE name = 'Hotel Alfonso XIII';
UPDATE suppliers SET city = 'Toledo' WHERE name IN ('Hotel Beatriz Toledo', 'Sonido Toledo');
UPDATE suppliers SET city = 'Madrid' WHERE name IN ('Hotel 1881 Madrid', 'Catering Lazo');
UPDATE suppliers SET city = 'Marbella' WHERE name IN ('Hotel Puente Romano', 'DMC Marbella');
UPDATE suppliers SET city = 'Sevilla' WHERE name = 'Autocares Sevilla';
UPDATE suppliers SET city = 'Valladolid' WHERE name = 'La Parrilla de San Lorenzo';

-- ── Contratos de proveedor (fechas relativas a hoy: así siempre hay uno de cada estado) ────────────
-- Barceló: el de 2024 se renovó (historial) y el actual está dentro de su aviso de 60 días
INSERT INTO supplier_contracts (id, supplier_id, title, signed_on, starts_on, ends_on, rates, discounts, payment_terms, credit_terms, conditions, alert_days, created_by, created_at)
SELECT 9001, id, 'Tarifa de grupos 2024', '2024-01-20', '2024-02-01', '2025-01-31',
       'Habitación doble 105 € · sala plenaria 1.050 €/día', '8 % a partir de 40 habitaciones', '50 % a la confirmación, resto 7 días antes',
       NULL, NULL, 60, (SELECT id FROM users WHERE email = 'tania@example.com'), '2024-01-20T10:00:00Z'
  FROM suppliers WHERE name = 'Hotel Barceló Valladolid';
INSERT INTO supplier_contracts (id, supplier_id, title, signed_on, starts_on, ends_on, rates, discounts, payment_terms, credit_terms, conditions, notes, alert_days, replaces_id, created_by, created_at)
SELECT 9002, id, 'Acuerdo de grupos 2025-2026', '2025-01-15', '2025-02-01', date('now', '+45 days'),
       'Habitación doble 118 € (uso individual 102 €)
Sala plenaria 1.200 €/día · salas de trabajo 350 €/día
Menú de grupo 38 € + IVA',
       '10 % a partir de 50 habitaciones · 1 gratuidad cada 25 habitaciones de pago',
       '50 % a la confirmación y el resto 7 días antes del evento',
       'Crédito a 30 días fecha factura hasta 20.000 €',
       'Cancelación sin gastos hasta 30 días antes; después, 50 % del alojamiento contratado.',
       'Negociar la renovación con el volumen de 2026 (concesionarios BMW).',
       60, 9001, (SELECT id FROM users WHERE email = 'tania@example.com'), '2025-01-15T09:30:00Z'
  FROM suppliers WHERE name = 'Hotel Barceló Valladolid';
-- Alfonso XIII: vigente hasta 2027, con aviso de 90 días
INSERT INTO supplier_contracts (id, supplier_id, title, signed_on, starts_on, ends_on, rates, discounts, payment_terms, alert_days, created_by, created_at)
SELECT 9003, id, 'Convenio congresos Sevilla', '2025-12-10', '2026-01-01', '2027-12-31',
       'Habitación doble 165 € · salón Real 3.400 €/día', '12 % sobre alojamiento en congresos de más de 150 personas',
       'Proforma del 1er pago antes de 15 días de la firma; 2º pago antes del evento', 90,
       (SELECT id FROM users WHERE email = 'direccion@example.com'), '2025-12-10T12:00:00Z'
  FROM suppliers WHERE name = 'Hotel Alfonso XIII';
-- Catering Lazo: caducó hace 10 días y nadie lo ha renovado (el evento de noviembre queda fuera)
INSERT INTO supplier_contracts (id, supplier_id, title, signed_on, starts_on, ends_on, rates, payment_terms, alert_days, created_by, created_at)
SELECT 9004, id, 'Acuerdo catering Madrid 2026', '2025-12-20', '2026-01-01', date('now', '-10 days'),
       'Coffee break 9,50 € · cóctel 32 € · cena de gala 68 € por persona', 'Pago a 15 días fecha factura', 30,
       (SELECT id FROM users WHERE email = 'tania@example.com'), '2025-12-20T11:00:00Z'
  FROM suppliers WHERE name = 'Catering Lazo';
-- Fluge: marcado como pendiente de renovación (se está negociando)
INSERT INTO supplier_contracts (id, supplier_id, title, signed_on, starts_on, ends_on, rates, discounts, alert_days, renewal, created_by, created_at)
SELECT 9005, id, 'Tarifa audiovisuales', '2025-05-20', '2025-06-01', date('now', '+150 days'),
       'Técnico 280 €/jornada · pantalla LED 6x3 1.900 €/día', '15 % en eventos de más de 3 días', 60, 'pendiente',
       (SELECT id FROM users WHERE email = 'tesoreria@example.com'), '2025-05-20T16:00:00Z'
  FROM suppliers WHERE name = 'Fluge Audiovisuales';
-- Puente Romano: acuerdo marco sin fecha de fin
INSERT INTO supplier_contracts (id, supplier_id, title, signed_on, starts_on, ends_on, rates, conditions, created_by, created_at)
SELECT 9006, id, 'Acuerdo marco Marbella', '2026-02-15', '2026-03-01', NULL,
       'Tarifa neta de grupos: 15 % sobre la tarifa pública', 'Revisión anual de tarifas en enero.',
       (SELECT id FROM users WHERE email = 'direccion@example.com'), '2026-02-15T10:00:00Z'
  FROM suppliers WHERE name = 'Hotel Puente Romano';
-- DMC Marbella: firmado, empieza el año que viene
INSERT INTO supplier_contracts (id, supplier_id, title, signed_on, starts_on, ends_on, rates, alert_days, created_by, created_at)
SELECT 9007, id, 'Programa de actividades 2027', date('now', '-5 days'), date('now', 'start of year', '+1 year'), date('now', 'start of year', '+2 years', '-1 day'),
       'Actividad de team building 45 €/persona · guías 220 €/jornada', 45,
       (SELECT id FROM users WHERE email = 'direccion@example.com'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 days')
  FROM suppliers WHERE name = 'DMC Marbella';
-- Autocares Sevilla: terminó y se decidió no renovarlo
INSERT INTO supplier_contracts (id, supplier_id, title, signed_on, starts_on, ends_on, rates, alert_days, renewal, created_by, created_at)
SELECT 9008, id, 'Tarifa traslados 2025', '2024-12-15', '2025-01-01', '2025-12-31',
       'Autocar 55 plazas 480 €/día · traslado aeropuerto 190 €', 30, 'no',
       (SELECT id FROM users WHERE email = 'tania@example.com'), '2024-12-15T10:00:00Z'
  FROM suppliers WHERE name = 'Autocares Sevilla';

INSERT INTO supplier_contract_changes (contract_id, user_id, action, summary, at)
SELECT c.id, c.created_by, 'alta', 'Alta del contrato', c.created_at FROM supplier_contracts c WHERE c.replaces_id IS NULL;
INSERT INTO supplier_contract_changes (contract_id, user_id, action, summary, at) VALUES
  (9002, (SELECT id FROM users WHERE email = 'tania@example.com'), 'renovacion', 'Renovación de «Tarifa de grupos 2024»', '2025-01-15T09:30:00Z'),
  (9001, (SELECT id FROM users WHERE email = 'tania@example.com'), 'renovado', 'Renovado por «Acuerdo de grupos 2025-2026»', '2025-01-15T09:30:00Z'),
  (9002, (SELECT id FROM users WHERE email = 'direccion@example.com'), 'cambio', 'Aviso: 30 días → 60 días', '2026-03-02T08:15:00Z'),
  (9005, (SELECT id FROM users WHERE email = 'tesoreria@example.com'), 'marca', 'Pendiente de renovación', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 days')),
  (9008, (SELECT id FROM users WHERE email = 'tania@example.com'), 'marca', 'No se renueva', '2025-11-20T10:00:00Z');

-- ── Clientes: salen de los expedientes; sus datos fiscales y condiciones, completos ─────────────────
INSERT INTO clients (name, created_by, created_at, updated_at) SELECT TRIM(company), (SELECT id FROM users WHERE email = 'tania@example.com'),
       '2026-01-10T09:00:00Z', '2026-01-10T09:00:00Z'
  FROM expedientes WHERE TRIM(company) <> '' ORDER BY id DESC ON CONFLICT (name) DO NOTHING;
UPDATE expedientes SET client_id = (SELECT c.id FROM clients c WHERE c.name = TRIM(expedientes.company));
UPDATE clients SET legal_name = 'BMW Ibérica, S.A.', tax_id = 'A00000001', fiscal_address = 'Avenida de Ejemplo 1, 28000 Madrid',
       billing_email = 'facturas.bmw@example.com', city = 'Madrid', phone = '+34 910 000 001', email = 'eventos.bmw@example.com',
       payment_terms = '50 % a la firma del presupuesto y el resto a 30 días de la factura final.', fee_bp = 1000, since_on = '2023-03-01',
       notes = 'Factura a sus concesionarios por separado (ver entidades). Pedir siempre la PO antes de facturar.'
 WHERE name = 'BMW Ibérica';
UPDATE clients SET legal_name = 'ELECNOR, S.A.', tax_id = 'A00000002', fiscal_address = 'Calle de Ejemplo 2, 28000 Madrid',
       billing_email = 'facturas.elecnor@example.com', city = 'Madrid', payment_terms = 'Pago a 60 días fecha factura.', fee_bp = 750
 WHERE name = 'ELECNOR';
UPDATE clients SET legal_name = 'Roche Farma, S.A.', city = 'Madrid', payment_terms = '30 % de anticipo; el resto al terminar el evento.', fee_bp = 1200
 WHERE name = 'ROCHE FARMA';
UPDATE clients SET city = 'Barcelona' WHERE name = 'GLENMARK';
-- El fee que se aplicó en cada expediente (el de BMW se negoció al 8 % antes de subirlo al 10 %)
UPDATE expedientes SET fee_bp = 800 WHERE company = 'BMW Ibérica';
UPDATE expedientes SET fee_bp = 750 WHERE company = 'ELECNOR';
UPDATE expedientes SET fee_bp = 1200 WHERE company = 'ROCHE FARMA';
-- Entidades a las que se factura (los concesionarios de BMW), con los datos de sus facturas
INSERT INTO client_entities (client_id, legal_name, tax_id, fiscal_address, email)
SELECT e.client_id, i.billed_to, i.billed_tax_id, i.billed_address, i.billed_email
  FROM invoices i JOIN expedientes e ON e.id = i.expediente_id
 WHERE i.billed_tax_id IS NOT NULL AND i.billed_tax_id <> COALESCE((SELECT c.tax_id FROM clients c WHERE c.id = e.client_id), '')
 GROUP BY e.client_id, i.billed_tax_id
ON CONFLICT DO NOTHING;
INSERT INTO change_log (entity, entity_id, user_id, action, summary, at)
SELECT 'client', c.id, c.created_by, 'alta', 'Alta del cliente (con los expedientes que ya había)', '2026-01-10T09:00:00Z' FROM clients c;
INSERT INTO change_log (entity, entity_id, user_id, action, summary, changes, at)
SELECT 'client', id, (SELECT id FROM users WHERE email = 'direccion@example.com'), 'condiciones', 'Fee: 8 % → 10 %',
       '{"fee_bp":[800,1000]}', '2026-09-15T10:30:00Z' FROM clients WHERE name = 'BMW Ibérica';

-- ── Business Travel: reservas de ejemplo (ROCHE con tres reservas, BMW con un viaje a Múnich, una cancelada y
--    dos de ELECNOR ya viajadas: una cerrada y otra por cerrar, a la que le falta el localizador del hotel) ──
INSERT INTO suppliers (name, type_id, city, created_by) VALUES
  ('Iryo', (SELECT id FROM supplier_types WHERE name = 'Tren'), NULL, 1),
  ('Restel', (SELECT id FROM supplier_types WHERE name = 'Central de reservas'), NULL, 1),
  ('Ryanair', (SELECT id FROM supplier_types WHERE name = 'Aerolínea'), NULL, 1),
  ('Booking', (SELECT id FROM supplier_types WHERE name = 'Central de reservas'), NULL, 1),
  ('Iberia', (SELECT id FROM supplier_types WHERE name = 'Aerolínea'), NULL, 1),
  ('Hoteles NH', (SELECT id FROM supplier_types WHERE name = 'Hotel'), NULL, 1)
ON CONFLICT (name) DO NOTHING;
INSERT INTO bt_bookings (id, reference, client_id, title, status, notes, created_by, created_at, updated_at) VALUES
  (1, 'BT-2026-0001', (SELECT id FROM clients WHERE name = 'ROCHE FARMA'), 'Congreso SEOM 2026 · Madrid', 'abierta', 'Facturar al departamento médico; pedir la PO a Laura.', 2, '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z'),
  (2, 'BT-2026-0002', (SELECT id FROM clients WHERE name = 'ROCHE FARMA'), 'Reunión de expertos · Sevilla', 'abierta', NULL, 2, '2026-09-28T09:30:00Z', '2026-09-28T09:30:00Z'),
  (3, 'BT-2026-0003', (SELECT id FROM clients WHERE name = 'BMW Ibérica'), 'Visita a la planta de Múnich', 'abierta', NULL, 2, '2026-10-02T12:00:00Z', '2026-10-02T12:00:00Z'),
  (4, 'BT-2026-0004', (SELECT id FROM clients WHERE name = 'ROCHE FARMA'), 'Curso de formación · Valencia', 'abierta', NULL, 2, '2026-10-08T16:00:00Z', '2026-10-08T16:00:00Z'),
  (5, 'BT-2026-0005', (SELECT id FROM clients WHERE name = 'GLENMARK'), 'Presentación a delegados · Bilbao', 'cancelada', 'El cliente aplazó la presentación.', 2, '2026-10-10T11:00:00Z', '2026-10-10T11:00:00Z'),
  (6, 'BT-2026-0006', (SELECT id FROM clients WHERE name = 'ELECNOR'), 'Visita a la obra de Toledo', 'abierta', NULL, 2, '2026-10-11T09:00:00Z', '2026-10-16T10:00:00Z'),
  (7, 'BT-2026-0007', (SELECT id FROM clients WHERE name = 'ELECNOR'), 'Reunión con proveedores · Zaragoza', 'abierta', NULL, 2, '2026-10-12T15:30:00Z', '2026-10-12T15:30:00Z');
UPDATE bt_bookings SET closed_at = '2026-10-16T10:00:00Z', closed_by = (SELECT id FROM users WHERE email = 'tania@example.com') WHERE id = 6;
INSERT INTO bt_passengers (id, booking_id, title, first_name, last_name, email, phone, notes) VALUES
  (1, 1, 'Dra.', 'María', 'López Serrano', 'maria.lopez@example.com', '+34 600 100 001', NULL),
  (2, 1, 'Dr.', 'Carlos', 'García Ruiz', 'carlos.garcia@example.com', '+34 600 100 002', 'Tarjeta Iryo Plus 7781'),
  (3, 2, 'Dra.', 'María', 'López Serrano', 'maria.lopez@example.com', '+34 600 100 001', NULL),
  (4, 3, NULL, 'Javier', 'Martín Gómez', 'javier.martin@example.com', NULL, NULL),
  (5, 3, NULL, 'Lucía', 'Fernández Pardo', NULL, NULL, 'Sin email: el bono se le entrega en mano'),
  (6, 4, 'Dr.', 'Carlos', 'García Ruiz', 'carlos.garcia@example.com', '+34 600 100 002', NULL),
  (7, 5, NULL, 'Ana', 'Torres Vega', 'ana.torres@example.com', NULL, NULL),
  (8, 6, NULL, 'Pedro', 'Sanz Ortega', 'pedro.sanz@example.com', '+34 600 200 001', NULL),
  (9, 7, NULL, 'Pedro', 'Sanz Ortega', 'pedro.sanz@example.com', '+34 600 200 001', NULL),
  (10, 7, NULL, 'Elena', 'Ruiz Campos', 'elena.ruiz@example.com', NULL, NULL);
INSERT INTO bt_lines (id, booking_id, kind, supplier_id, supplier, description, start_date, end_date, locator, issued_on, details, base_cents, vat_bp, total_cents, fee_cents, pvp_cents, created_by) VALUES
  (1, 1, 'transporte', (SELECT id FROM suppliers WHERE name = 'Iryo'), 'Iryo', 'Barcelona Sants → Madrid Atocha · ida y vuelta', '2026-11-18', '2026-11-20', 'IRY7Q2K', '2026-09-21', 'Clase Singular, plazas 5A y 5B', 22364, 1000, 24600, 1500, 26100, 2),
  (2, 1, 'alojamiento', (SELECT id FROM suppliers WHERE name = 'Restel'), 'Restel', 'NH Collection Madrid Eurobuilding', '2026-11-18', '2026-11-20', 'RST-449120', NULL, 'Dos habitaciones dobles de uso individual, desayuno incluido', 72000, 1000, 79200, 4000, 83200, 2),
  (3, 1, 'inscripcion', NULL, NULL, 'Congreso Nacional SEOM 2026', '2026-11-18', '2026-11-20', 'SEOM-1187', NULL, NULL, 65000, 2100, 78650, 1000, 79650, 2),
  (4, 1, 'inscripcion', NULL, NULL, 'Congreso Nacional SEOM 2026', '2026-11-18', '2026-11-20', 'SEOM-1188', NULL, NULL, 65000, 2100, 78650, 1000, 79650, 2),
  (5, 1, 'otros', NULL, NULL, 'Traslado estación de Atocha - hotel', '2026-11-18', NULL, NULL, NULL, 'Taxi concertado', 4500, 1000, 4950, 500, 5450, 2),
  (6, 2, 'transporte', (SELECT id FROM suppliers WHERE name = 'Ryanair'), 'Ryanair', 'Madrid → Sevilla · FR 5512 / FR 5513', '2026-10-27', '2026-10-28', 'R7KX2P', '2026-09-29', NULL, 16945, 1000, 18640, 1500, 20140, 2),
  (7, 2, 'alojamiento', (SELECT id FROM suppliers WHERE name = 'Booking'), 'Booking', 'Hotel Alfonso XIII', '2026-10-27', '2026-10-28', '4412.889.120', NULL, NULL, 21000, 1000, 23100, 2000, 25100, 2),
  (8, 3, 'transporte', (SELECT id FROM suppliers WHERE name = 'Iberia'), 'Iberia', 'Madrid → Múnich · IB 3510 / IB 3511', '2026-11-04', '2026-11-06', 'IB9HQ3', '2026-10-03', 'Tarifa flexible', 78400, 0, 78400, 3000, 81400, 2),
  (9, 3, 'alojamiento', (SELECT id FROM suppliers WHERE name = 'Hoteles NH'), 'Hoteles NH', 'NH Collection München Bavaria', '2026-11-04', '2026-11-06', 'NH-77120', NULL, NULL, 62000, 0, 62000, 3000, 65000, 2),
  (10, 4, 'transporte', (SELECT id FROM suppliers WHERE name = 'Iryo'), 'Iryo', 'Madrid Atocha → Valencia Joaquín Sorolla', '2026-11-25', '2026-11-26', 'IRY4M8D', '2026-10-09', NULL, 8000, 1000, 8800, 1500, 10300, 2),
  (11, 4, 'inscripcion', NULL, NULL, 'Curso de actualización en oncología', '2026-11-25', '2026-11-26', NULL, NULL, NULL, 30000, 2100, 36300, 1000, 37300, 2),
  (12, 5, 'transporte', (SELECT id FROM suppliers WHERE name = 'Ryanair'), 'Ryanair', 'Madrid → Bilbao', '2026-12-02', NULL, NULL, NULL, NULL, 8909, 1000, 9800, 1500, 11300, 2),
  (13, 6, 'transporte', (SELECT id FROM suppliers WHERE name = 'Iryo'), 'Iryo', 'Madrid Atocha → Toledo · ida y vuelta', '2026-10-13', '2026-10-13', 'IRY2T5L', '2026-10-11', NULL, 3000, 1000, 3300, 1000, 4300, 2),
  (14, 7, 'transporte', (SELECT id FROM suppliers WHERE name = 'Iberia'), 'Iberia', 'Madrid → Zaragoza · IB 8740 / IB 8741', '2026-10-14', '2026-10-15', 'IB5ZR8', '2026-10-12', NULL, 26000, 1000, 28600, 2000, 30600, 2),
  (15, 7, 'alojamiento', (SELECT id FROM suppliers WHERE name = 'Hoteles NH'), 'Hoteles NH', 'NH Collection Gran Hotel de Zaragoza', '2026-10-14', '2026-10-15', NULL, NULL, 'Dos habitaciones individuales', 18000, 1000, 19800, 2000, 21800, 2);
INSERT INTO bt_line_passengers (line_id, passenger_id) VALUES
  (1, 1),
  (1, 2),
  (2, 1),
  (2, 2),
  (3, 1),
  (4, 2),
  (5, 1),
  (5, 2),
  (6, 3),
  (7, 3),
  (8, 4),
  (8, 5),
  (9, 4),
  (9, 5),
  (10, 6),
  (11, 6),
  (12, 7),
  (13, 8),
  (14, 9),
  (14, 10),
  (15, 9),
  (15, 10);
INSERT INTO counters (key, value) VALUES ('bt_booking:2026', 7);
INSERT INTO change_log (entity, entity_id, user_id, action, summary, at)
SELECT 'bt_booking', b.id, 2, 'alta', 'Alta de la reserva para ' || c.name, b.created_at FROM bt_bookings b JOIN clients c ON c.id = b.client_id;
INSERT INTO change_log (entity, entity_id, user_id, action, summary, at) VALUES ('bt_booking', 5, 2, 'estado', 'Reserva cancelada', '2026-10-14T09:00:00Z'),
  ('bt_booking', 6, (SELECT id FROM users WHERE email = 'tania@example.com'), 'estado', 'Reserva cerrada', '2026-10-16T10:00:00Z');
