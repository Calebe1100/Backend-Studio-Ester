import dotenv from 'dotenv';
import path from 'path';

// Em produção (Railway), as variáveis vêm do ambiente — não carrega .env
if (process.env.NODE_ENV !== 'production') {
  const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  return value;
}

/** Monta DATABASE_URL ou usa a variável direta (Railway injeta via referência). */
function resolveDatabaseUrl(): string {
  const direct = process.env.DATABASE_URL?.trim();
  if (direct && !direct.includes('${{')) return direct;

  const host = process.env.PGHOST?.trim();
  const user = process.env.PGUSER?.trim();
  const password = process.env.PGPASSWORD?.trim();
  const database = process.env.PGDATABASE?.trim();
  const port = process.env.PGPORT?.trim() ?? '5432';

  if (host && user && password && database) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  }

  throw new Error(
    'DATABASE_URL não definida.\n' +
      'No Railway (serviço do backend), adicione via "Add Reference":\n' +
      '  DATABASE_URL = ${{Postgres.DATABASE_URL}}\n' +
      'Substitua "Postgres" pelo nome exato do serviço de banco no painel.',
  );
}

export const env = {
  databaseUrl: resolveDatabaseUrl(),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
  salon: {
    name: process.env.SALON_NAME ?? 'Studio Ester',
    email: process.env.SALON_EMAIL ?? '',
  },
};
