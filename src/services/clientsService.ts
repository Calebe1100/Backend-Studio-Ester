import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';
import { hashPassword } from '../lib/crypto';

export type ClientDTO = {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  active: boolean;
  userId: string | null;
};

type ClientRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  user_id: string | null;
};

function mapClient(row: ClientRow): ClientDTO {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? '',
    email: row.email ?? '',
    notes: row.notes ?? '',
    active: row.active,
    userId: row.user_id,
  };
}

function db(pool?: Pool) {
  return pool ?? getPool();
}

function normalizeEmail(email?: string): string | null {
  const value = email?.trim().toLowerCase() ?? '';
  return value || null;
}

function assertEmail(email: string | null, required: boolean) {
  if (!email) {
    if (required) throw new HttpError(400, 'Informe um e-mail válido.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Informe um e-mail válido.');
  }
}

const CLIENT_SELECT = `id, name, phone, email, notes, active, user_id`;

export async function listClients(salonId: string, pool?: Pool): Promise<ClientDTO[]> {
  const result = await db(pool).query<ClientRow>(
    `SELECT ${CLIENT_SELECT}
     FROM clients
     WHERE salon_id = $1
     ORDER BY active DESC, name ASC`,
    [salonId],
  );
  return result.rows.map(mapClient);
}

export async function createClient(
  salonId: string,
  input: { name: string; phone?: string; email?: string; notes?: string; userId?: string | null },
  pool?: Pool,
): Promise<ClientDTO> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do cliente.');
  const email = normalizeEmail(input.email);
  assertEmail(email, false);

  try {
    const result = await db(pool).query<ClientRow>(
      `INSERT INTO clients (salon_id, name, phone, email, notes, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${CLIENT_SELECT}`,
      [
        salonId,
        name,
        input.phone?.trim() || null,
        email,
        input.notes?.trim() || null,
        input.userId ?? null,
      ],
    );
    return mapClient(result.rows[0]);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw new HttpError(409, 'Já existe um cliente com este e-mail.');
    }
    throw err;
  }
}

export async function updateClient(
  salonId: string,
  id: string,
  input: { name: string; phone?: string; email?: string; notes?: string },
  pool?: Pool,
): Promise<ClientDTO> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do cliente.');
  const email = normalizeEmail(input.email);
  assertEmail(email, false);

  try {
    const result = await db(pool).query<ClientRow>(
      `UPDATE clients
       SET name = $3, phone = $4, email = $5, notes = $6
       WHERE id = $1 AND salon_id = $2
       RETURNING ${CLIENT_SELECT}`,
      [id, salonId, name, input.phone?.trim() || null, email, input.notes?.trim() || null],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Cliente não encontrado.');
    return mapClient(result.rows[0]);
  } catch (err: unknown) {
    if (err instanceof HttpError) throw err;
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw new HttpError(409, 'Já existe um cliente com este e-mail.');
    }
    throw err;
  }
}

export async function setClientActive(
  salonId: string,
  id: string,
  active: boolean,
  pool?: Pool,
): Promise<ClientDTO> {
  const result = await db(pool).query<ClientRow>(
    `UPDATE clients SET active = $3
     WHERE id = $1 AND salon_id = $2
     RETURNING ${CLIENT_SELECT}`,
    [id, salonId, active],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Cliente não encontrado.');
  return mapClient(result.rows[0]);
}

export async function getClientByUserId(
  salonId: string,
  userId: string,
  pool?: Pool,
): Promise<ClientDTO | null> {
  const result = await db(pool).query<ClientRow>(
    `SELECT ${CLIENT_SELECT}
     FROM clients
     WHERE salon_id = $1 AND user_id = $2
     LIMIT 1`,
    [salonId, userId],
  );
  return result.rows[0] ? mapClient(result.rows[0]) : null;
}

/**
 * Cadastro de acesso do cliente: cria user (role=cliente) + registro em clients.
 */
export async function registerClientAccess(
  input: { name: string; phone?: string; email: string; password: string },
  pool?: Pool,
): Promise<{ client: ClientDTO; userId: string }> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe seu nome completo.');
  const email = normalizeEmail(input.email);
  assertEmail(email, true);
  const phone = input.phone?.trim() || '';
  if (phone.length < 8) throw new HttpError(400, 'Informe um telefone válido.');
  if (!input.password || input.password.length < 8) {
    throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
  }

  const salon = await db(pool).query<{ id: string }>(
    'SELECT id FROM salons ORDER BY created_at ASC LIMIT 1',
  );
  if (!salon.rows[0]) throw new HttpError(503, 'Salão ainda não configurado.');
  const salonId = salon.rows[0].id;

  const existingUser = await db(pool).query(
    'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1',
    [email],
  );
  if (existingUser.rows[0]) {
    throw new HttpError(409, 'Este e-mail já possui cadastro. Faça login.');
  }

  const passwordHash = await hashPassword(input.password);
  const client = await db(pool).connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users (salon_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'cliente')
       RETURNING id`,
      [salonId, name, email, passwordHash],
    );
    const userId = userResult.rows[0].id;
    const clientResult = await client.query<ClientRow>(
      `INSERT INTO clients (salon_id, user_id, name, phone, email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${CLIENT_SELECT}`,
      [salonId, userId, name, phone, email],
    );
    await client.query('COMMIT');
    return { client: mapClient(clientResult.rows[0]), userId };
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw new HttpError(409, 'Este e-mail já possui cadastro. Faça login.');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function updateClientProfile(
  salonId: string,
  userId: string,
  input: { name: string; phone?: string; password?: string },
  pool?: Pool,
): Promise<ClientDTO> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe seu nome completo.');
  const phone = input.phone?.trim() || '';
  if (phone.length < 8) throw new HttpError(400, 'Informe um telefone válido.');

  const existing = await getClientByUserId(salonId, userId, pool);
  if (!existing) throw new HttpError(404, 'Perfil de cliente não encontrado.');

  if (input.password) {
    if (input.password.length < 8) {
      throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
    }
    const passwordHash = await hashPassword(input.password);
    await db(pool).query(
      `UPDATE users SET name = $2, password_hash = $3, updated_at = NOW() WHERE id = $1`,
      [userId, name, passwordHash],
    );
  } else {
    await db(pool).query(
      `UPDATE users SET name = $2, updated_at = NOW() WHERE id = $1`,
      [userId, name],
    );
  }

  const result = await db(pool).query<ClientRow>(
    `UPDATE clients
     SET name = $3, phone = $4
     WHERE id = $1 AND salon_id = $2
     RETURNING ${CLIENT_SELECT}`,
    [existing.id, salonId, name, phone],
  );
  return mapClient(result.rows[0]);
}

/** Busca por e-mail/telefone ou cria cliente (fluxo de agendamento rápido da recepção). */
export async function findOrCreateClient(
  salonId: string,
  input: { name: string; phone?: string; email?: string },
  pool?: Pool,
): Promise<ClientDTO> {
  const email = normalizeEmail(input.email);
  if (email) {
    const byEmail = await db(pool).query<ClientRow>(
      `SELECT ${CLIENT_SELECT}
       FROM clients
       WHERE salon_id = $1 AND lower(email) = $2 AND active = TRUE
       LIMIT 1`,
      [salonId, email],
    );
    if (byEmail.rows[0]) return mapClient(byEmail.rows[0]);
  }

  const phone = input.phone?.trim() || '';
  if (phone) {
    const existing = await db(pool).query<ClientRow>(
      `SELECT ${CLIENT_SELECT}
       FROM clients
       WHERE salon_id = $1 AND phone = $2 AND active = TRUE
       LIMIT 1`,
      [salonId, phone],
    );
    if (existing.rows[0]) return mapClient(existing.rows[0]);
  }
  return createClient(salonId, input, pool);
}
