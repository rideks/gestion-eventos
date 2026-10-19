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
DELETE FROM supplier_aliases; DELETE FROM suppliers; DELETE FROM supplier_types;
INSERT INTO supplier_types (name, sort) VALUES
  ('Hotel', 10), ('Venue / espacio', 20), ('Restaurante', 30), ('Catering', 40), ('Actividades', 50),
  ('Formación', 60), ('Transporte', 70), ('Audiovisuales', 80), ('Otros', 90);
DELETE FROM sessions; DELETE FROM invites; DELETE FROM login_attempts; DELETE FROM users;
DELETE FROM role_permissions; DELETE FROM roles WHERE system = 0;
-- Reparto inicial (el de migrations/0008_roles_y_permisos.sql más el de 0009_proveedores.sql)
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.value FROM roles r, json_each(CASE r.key
  WHEN 'jefes' THEN '["expedientes","expediente.open","expediente.close","pagos","payment.any_method","payment.receipt","payment.unpay","supplier.review","cobros","invoice.issue","po.manage","delete","settings","proveedores","proveedores.create","proveedores.edit","proveedores.gasto"]'
  WHEN 'administracion' THEN '["expedientes","expediente.open","expediente.close","pagos","payment.any_method","payment.receipt","payment.unpay","supplier.review","cobros","invoice.issue","po.manage","delete","settings","proveedores","proveedores.create","proveedores.edit","proveedores.gasto"]'
  WHEN 'tesoreria' THEN '["expedientes","pagos","payment.any_method","payment.receipt","payment.unpay","supplier.review","cobros","invoice.issue","po.manage","proveedores","proveedores.create","proveedores.edit","proveedores.gasto"]'
  WHEN 'eventos' THEN '["expedientes","pagos","proveedores","proveedores.create"]'
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
