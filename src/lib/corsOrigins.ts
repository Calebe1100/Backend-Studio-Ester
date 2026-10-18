import { getPool } from '../db/pool';
import { env } from '../config/env';

const CACHE_TTL_MS = 60_000;

let cache: { at: number; origins: string[] } | null = null;

export function invalidateOriginCache(): void {
  cache = null;
}

/** Origens da plataforma (landing), fora de qualquer salão. */
const PLATFORM_ORIGINS = [
  'https://salonsign.vercel.app',
  'https://landing-salonsign.vercel.app',
  'https://salonsign.com.br',
  'https://www.salonsign.com.br',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
];

const PLATFORM_VERCEL_PREFIXES = ['salonsign', 'landing-salonsign'];

export function staticOrigins(): string[] {
  return [
    ...env.frontendUrl.split(',').map((item) => item.trim()),
    ...PLATFORM_ORIGINS,
  ].filter(Boolean);
}

/** Origens gravadas nos salões ativos, com cache curto para o preflight não depender do banco. */
export async function loadTenantOrigins(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.origins;
  try {
    const result = await getPool().query<{ frontend_origins: string[] | null }>(
      `SELECT frontend_origins FROM salons WHERE active = TRUE`,
    );
    const origins = result.rows.flatMap((row) => row.frontend_origins ?? []);
    cache = { at: Date.now(), origins };
    return origins;
  } catch (err) {
    console.error('[cors] Falha ao carregar origens dos salões:', err);
    return cache?.origins ?? [];
  }
}

/**
 * Libera a origem exata ou um preview da Vercel cujo host começa pelo projeto
 * já gravado em `frontend_origins` (ex.: app-studio-ester-rodrigues-git-…).
 */
export function originAllowed(origin: string, tenantOrigins: string[], fixedOrigins: string[]): boolean {
  if (fixedOrigins.includes(origin) || tenantOrigins.includes(origin)) return true;

  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (!host.endsWith('.vercel.app')) return false;
  if (PLATFORM_VERCEL_PREFIXES.some((prefix) => host.startsWith(prefix))) return true;

  for (const stored of [...fixedOrigins, ...tenantOrigins]) {
    let storedHost: string;
    try {
      storedHost = new URL(stored).hostname;
    } catch {
      continue;
    }
    if (!storedHost.endsWith('.vercel.app')) continue;
    const project = storedHost.slice(0, -'.vercel.app'.length);
    if (host === storedHost || host.startsWith(`${project}-`)) return true;
  }
  return false;
}
