/**
 * Migration inicial — cria todas as tabelas do sistema.
 * Execute com: npm run migrate
 */
import { env } from '../config/env';
import { getPool, closePool, waitForDb } from './pool';

const SQL = `
-- Salão único e fixo
CREATE TABLE IF NOT EXISTS salons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  phone       TEXT,
  address     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Usuários com credenciais persistidas no banco
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id      UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('dono','recepcao','profissional','cliente')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(email)
);

-- Bancos existentes: inclui papel 'cliente'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('dono','recepcao','profissional','cliente'));

-- Telefone da equipe (WhatsApp)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Subscriptions Web Push (PWA)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON push_subscriptions(user_id);

-- Refresh tokens persistidos (JWT stateful para logout seguro)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,   -- SHA-256 do token bruto
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

-- Tokens de recuperação de senha
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Profissionais
CREATE TABLE IF NOT EXISTS professionals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id     UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  work_start   TIME NOT NULL DEFAULT '08:00',
  work_end     TIME NOT NULL DEFAULT '18:00',
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serviços (CRUD exclusivo do backoffice)
CREATE TABLE IF NOT EXISTS services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  duration    INTEGER NOT NULL CHECK (duration > 0),   -- minutos
  price       NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vínculo profissional ↔ serviços que realiza
CREATE TABLE IF NOT EXISTS professional_services (
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (professional_id, service_id)
);

-- Clientes do salão
CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  notes       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bancos já existentes: garante colunas
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_salon_email
  ON clients (salon_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_user_id
  ON clients (user_id)
  WHERE user_id IS NOT NULL;

-- Agendamentos
CREATE TABLE IF NOT EXISTS appointments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                 UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  client_id                UUID NOT NULL REFERENCES clients(id),
  professional_id          UUID NOT NULL REFERENCES professionals(id),
  service_id               UUID NOT NULL REFERENCES services(id),
  starts_at                TIMESTAMPTZ NOT NULL,
  ends_at                  TIMESTAMPTZ NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'agendado'
                             CHECK (status IN ('agendado','confirmado','em_atendimento','concluido','cancelado','nao_compareceu')),
  service_price_snapshot   NUMERIC(10,2) NOT NULL,
  service_duration_snapshot INTEGER NOT NULL,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_professional_starts
  ON appointments(professional_id, starts_at);

CREATE INDEX IF NOT EXISTS idx_appointments_salon_starts
  ON appointments(salon_id, starts_at);
`;

function logDatabaseTarget(databaseUrl: string): void {
  try {
    const parsed = new URL(databaseUrl);
    const user = decodeURIComponent(parsed.username || '');
    const db = parsed.pathname.replace(/^\//, '');
    console.log(
      `🔗 Destino: ${parsed.hostname}:${parsed.port || '5432'}/${db} (user: ${user || 'VAZIO'})`,
    );

    if (!user || !db) {
      console.error('❌ DATABASE_URL malformada — usuário ou database vazios.');
      console.error(
        '   No Railway (serviço do backend), use referência cruzada:',
      );
      console.error('   DATABASE_URL=${{Postgres.DATABASE_URL}}');
      process.exit(1);
    }
  } catch {
    console.error('❌ DATABASE_URL inválida.');
    process.exit(1);
  }
}

async function migrate() {
  logDatabaseTarget(env.databaseUrl);

  const pool = getPool();
  console.log('⏳ Aguardando conexão com o banco...');
  await waitForDb(pool);
  console.log('⏳ Executando migration...');
  await pool.query(SQL);
  console.log('✅ Migration concluída.');
  await closePool();
}

migrate().catch((err) => {
  console.error('❌ Erro na migration:', err);
  process.exit(1);
});
