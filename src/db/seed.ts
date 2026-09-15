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

  // 3. Catálogo inicial (só se ainda não houver serviços)
  const servicesCount = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM services WHERE salon_id = $1',
    [salonId]
  );
  if (Number(servicesCount.rows[0].count) === 0) {
    const services = [
      { name: 'Corte feminino', duration: 60, price: 120 },
      { name: 'Escova', duration: 45, price: 80 },
      { name: 'Manicure', duration: 45, price: 50 },
      { name: 'Coloração', duration: 120, price: 250 },
    ];
    const serviceIds: string[] = [];
    for (const svc of services) {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO services (salon_id, name, duration, price)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [salonId, svc.name, svc.duration, svc.price]
      );
      serviceIds.push(inserted.rows[0].id);
    }
    console.log(`  ✅ ${services.length} serviços iniciais criados`);

    const pros = [
      { name: 'Camila Souza', start: '09:00', end: '18:00', serviceIndexes: [0, 1, 3] },
      { name: 'Juliana Alves', start: '10:00', end: '19:00', serviceIndexes: [1, 2] },
    ];
    for (const pro of pros) {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO professionals (salon_id, name, work_start, work_end)
         VALUES ($1, $2, $3::time, $4::time)
         RETURNING id`,
        [salonId, pro.name, pro.start, pro.end]
      );
      for (const idx of pro.serviceIndexes) {
        await pool.query(
          `INSERT INTO professional_services (professional_id, service_id)
           VALUES ($1, $2)`,
          [inserted.rows[0].id, serviceIds[idx]]
        );
      }
    }
    console.log(`  ✅ ${pros.length} profissionais iniciais criados`);
  } else {
    console.log('  ℹ️  Serviços já existem — catálogo inicial ignorado');
  }

  console.log('✅ Seed concluído.');
  await closePool();
}

seed().catch((err) => {
  console.error('❌ Erro no seed:', err);
  process.exit(1);
});
