import { Pool, PoolConfig } from 'pg';
import { env } from '../config/env';

let _pool: Pool | null = null;

function buildPoolConfig(): PoolConfig {
  const isRailwayInternal = env.databaseUrl.includes('railway.internal');
  const isProduction = ['production', 'prd'].includes(env.nodeEnv);
  const needsSsl = isProduction && !isRailwayInternal;

  return {
    connectionString: env.databaseUrl,
    connectionTimeoutMillis: 10_000,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool(buildPoolConfig());
  }
  return _pool;
}

/** Aguarda o banco ficar disponível (útil no deploy Railway). */
export async function waitForDb(
  pool: Pool,
  maxAttempts = 30,
  delayMs = 2_000,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.log(
        `⏳ Banco indisponível (tentativa ${attempt}/${maxAttempts}), aguardando ${delayMs / 1000}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** Fecha o pool (útil em testes para cleanup). */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
