/**
 * Seed — provisiona o salão fixo e o usuário dono inicial.
 * Execute com: npm run seed
 *
 * Seguro para rodar múltiplas vezes (idempotente).
 */
import bcrypt from 'bcrypt';
import { getPool, closePool } from './pool';

const SALON_NAME = process.env.SALON_NAME ?? 'Studio Ester';
const SALON_EMAIL = process.env.SALON_EMAIL ?? 'contato@studioester.com.br';
const OWNER_NAME = process.env.OWNER_NAME ?? 'Ester';
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? 'ester@studioester.com.br';
// Senha inicial — deve ser trocada no primeiro login em produção
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? 'Trocar@123';

async function seed() {
  const pool = getPool();
  console.log('⏳ Executando seed...');

  // 1. Salão fixo
  const salonResult = await pool.query<{ id: string }>(
    `INSERT INTO salons (name, phone)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [SALON_NAME, '(11) 99999-0000']
  );

  let salonId: string;
  if (salonResult.rows.length > 0) {
    salonId = salonResult.rows[0].id;
    console.log(`  ✅ Salão criado: ${SALON_NAME} (${salonId})`);
  } else {
    // Já existia — busca o id
    const existing = await pool.query<{ id: string }>(
      'SELECT id FROM salons LIMIT 1'
    );
    salonId = existing.rows[0].id;
    console.log(`  ℹ️  Salão já existia: ${salonId}`);
  }

  // 2. Usuário dono
  const existingUser = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [OWNER_EMAIL]
  );

  if (existingUser.rows.length > 0) {
    console.log(`  ℹ️  Usuário dono já existe: ${OWNER_EMAIL}`);
  } else {
    const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 12);
    const userResult = await pool.query<{ id: string }>(
      `INSERT INTO users (salon_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'dono')
       RETURNING id`,
      [salonId, OWNER_NAME, OWNER_EMAIL, passwordHash]
    );
    console.log(`  ✅ Usuário dono criado: ${OWNER_EMAIL} (${userResult.rows[0].id})`);
    console.log(`  ⚠️  Senha inicial: ${OWNER_PASSWORD} — troque em produção!`);
    console.log(`  📧  Email de login para o salão configurado em: ${SALON_EMAIL}`);
  }

  console.log('✅ Seed concluído.');
  await closePool();
}

seed().catch((err) => {
  console.error('❌ Erro no seed:', err);
  process.exit(1);
});
