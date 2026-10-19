// @ts-check
// Repositorio de los tipos de IVA (los de los desplegables; se gestionan en Ajustes).

/** @typedef {import('../services/types').Db} Db */

/** El de por defecto primero @param {Db} db */
export const list = (db) => db.prepare('SELECT id, label, rate_bp, is_default FROM vat_rates ORDER BY is_default DESC, rate_bp DESC, id').all()
  .then((r) => r.results);
