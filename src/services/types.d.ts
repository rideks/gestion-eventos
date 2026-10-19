// Tipos de la capa de servicios (para la comprobación de tipos: npm run typecheck).
// Lo justo de D1 y R2 que usa la aplicación: así los servicios se pueden probar con una base en memoria.

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = any>(column?: string): Promise<T | null>;
  all<T = any>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
}

export interface Db {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ results: any[] }[]>;
}

export interface Bucket {
  put(key: string, value: unknown, options?: unknown): Promise<unknown>;
  get(key: string): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

export interface User {
  id: number;
  name: string;
  email?: string;
  role_name?: string;
  permissions: Set<string>;
}

export interface Context {
  db: Db;
  bucket: Bucket;
  user: User | null;
  actor: { user: User | null; ip: string | null };
  /** Hoy, 'YYYY-MM-DD' (Madrid) */
  now: string;
}

export type FailCode = 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'similar' | 'renewed';
export type Ok<T> = { ok: true; value: T };
export type Fail = { ok: false; code: FailCode; message: string; fields: Record<string, string>; [extra: string]: unknown };
export type Result<T> = Ok<T> | Fail;
