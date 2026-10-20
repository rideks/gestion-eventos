-- ════════════════════════════════════════════════════════════════════════════
-- Los expedientes nacen en curso: al crearlos reciben su número (ya no hay «solicitudes por abrir» que
-- Administración tenga que abrir). Ver src/repos/expedientes.js (nextNumberStmt).
--
--   1. El contador de números de expediente ('expediente' en counters) arranca en el mayor número usado
--      (o en el «primer número» de Ajustes menos uno, si es mayor).
--   2. Las solicitudes que quedaban sin abrir se abren con número correlativo, por orden de petición.
--   3. El contador queda en el último número dado.
-- No se borra ni se reconstruye nada: el estado 'solicitado' sigue admitido en la tabla, pero ya no se usa.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO counters (key, value) VALUES ('expediente', MAX(
  COALESCE((SELECT MAX(number) FROM expedientes), 0),
  COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'first_number'), 1001) - 1
)) ON CONFLICT (key) DO UPDATE SET value = MAX(value, excluded.value);

-- En la actividad de cada una, con su número (antes de abrirlas: la misma cuenta que el UPDATE de abajo)
INSERT INTO activity (expediente_id, user_name, action, text)
SELECT id, 'Gestión de eventos', 'expediente.open', 'abrió el expediente con el número ' || n || ' (los expedientes ya nacen en curso)'
  FROM (SELECT id, (SELECT value FROM counters WHERE key = 'expediente') + ROW_NUMBER() OVER (ORDER BY requested_at, id) AS n
          FROM expedientes WHERE status = 'solicitado');

UPDATE expedientes
   SET number = p.n, status = 'abierto',
       opened_at = COALESCE(expedientes.opened_at, expedientes.requested_at),
       opened_by = COALESCE(expedientes.opened_by, expedientes.requested_by),
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  FROM (SELECT id, (SELECT value FROM counters WHERE key = 'expediente') + ROW_NUMBER() OVER (ORDER BY requested_at, id) AS n
          FROM expedientes WHERE status = 'solicitado') AS p
 WHERE expedientes.id = p.id;

UPDATE counters SET value = MAX(value, COALESCE((SELECT MAX(number) FROM expedientes), 0)) WHERE key = 'expediente';
