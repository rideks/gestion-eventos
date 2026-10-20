-- ════════════════════════════════════════════════════════════════════════════
-- Documentos que no se pierden: si al guardar un formulario falta algún dato, el documento que se había elegido
-- se guarda como «temporal» (sólo para quien lo subió) y la página vuelve con él ya puesto; al guardar bien se usa
-- y el temporal se borra. Ver src/services/files.js (keepUploads).
--   · files.staged_token: la clave del temporal (aleatoria) · files.staged_at: cuándo se subió
-- Los temporales de más de 24 horas los borra la limpieza diaria (src/worker.js). Sólo se añaden columnas.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE files ADD COLUMN staged_token TEXT;
ALTER TABLE files ADD COLUMN staged_at TEXT;
CREATE UNIQUE INDEX idx_files_staged ON files(staged_token) WHERE staged_token IS NOT NULL;
