import { Pool } from 'pg';
import { env } from '../config/env';

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: env.databaseUrl });
  }
  return _pool;
}

/** Fecha o pool (útil em testes para cleanup). */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
