// Base de datos D1 de pruebas: SQLite en memoria (node:sqlite) con la misma interfaz que usa la aplicación
// (prepare → bind → first / all / run, y batch atómico), todas las migraciones aplicadas y, si se pide,
// los datos de ejemplo (scripts/demo.sql). Así los servicios se prueban sin servidor ni navegador.
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const plain = (row) => (row ? { ...row } : row);

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    // D1 no admite undefined: que falle igual aquí
    if (params.some((p) => p === undefined)) throw new Error(`D1_TYPE_ERROR: undefined en «${this.sql.slice(0, 80)}»`);
    return new Statement(this.db, this.sql, params);
  }

  async first(column) {
    const row = plain(this.db.prepare(this.sql).get(...this.params) ?? null);
    return row && column ? row[column] : row;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params).map(plain), success: true, meta: {} };
  }

  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }

  // Dentro de un batch: las consultas y los RETURNING devuelven filas; el resto, los cambios
  exec() {
    const s = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) {
      return { results: s.all(...this.params).map(plain), success: true, meta: {} };
    }
    const r = s.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

/** ¿Hay node:sqlite? (Node 22.13 o superior) */
export async function sqliteAvailable() {
  try {
    await import('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

/** Base nueva con las migraciones (y los datos de ejemplo si demo = true) */
export async function testDb({ demo = false } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('migrations/', ROOT);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(f, dir), 'utf8'));
  if (demo) raw.exec(readFileSync(new URL('scripts/demo.sql', ROOT), 'utf8'));
  return {
    raw,
    prepare: (sql) => new Statement(raw, sql),
    async batch(list) {
      raw.exec('BEGIN');
      try {
        const out = list.map((s) => s.exec());
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    /** Atajo para las comprobaciones: filas de una consulta */
    rows: (sql, ...params) => raw.prepare(sql).all(...params).map(plain),
    one: (sql, ...params) => plain(raw.prepare(sql).get(...params) ?? null),
  };
}
