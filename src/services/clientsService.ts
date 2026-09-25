import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';
import { hashPassword } from '../lib/crypto';
import { normalizeStoredPhone, phoneLookupVariants } from '../lib/phone';
import { findUserIdByPhone, phoneDigitsSql } from '../lib/phoneAccount';

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

async function requireUniquePhone(
  raw: string | null | undefined,
  pool?: Pool,
  excludeUserId?: string,
): Promise<string> {
  const phone = normalizeStoredPhone(raw);
  if (!phone) throw new HttpError(400, 'Informe um telefone válido com DDD.');

  const taken = await findUserIdByPhone(db(pool), phone, { excludeUserId });
  if (taken) throw new HttpError(409, 'Este telefone já possui cadastro. Faça login.');
  return phone;
}

/** Telefone opcional no cadastro interno. Vazio vira null; valor informado precisa ser válido. */
function optionalPhone(raw?: string | null): string | null {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return null;
  const phone = normalizeStoredPhone(trimmed);
  if (!phone) throw new HttpError(400, 'Informe um telefone válido com DDD.');
  return phone;
}

const CLIENT_SELECT = `id, name, phone, email, notes, active, user_id`;

export const CLIENT_TEMPORARY_PASSWORD = 'Cliente@123';

export type CreateClientResult = {
  client: ClientDTO;
  temporaryPassword?: string;
};

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
): Promise<CreateClientResult> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do cliente.');
  const email = normalizeEmail(input.email);
  assertEmail(email, false);

  // Com e-mail: cria acesso (user role=cliente) + cliente com senha temporária
  if (email && !input.userId) {
    const phone = await requireUniquePhone(input.phone, pool);
    const existingUser = await db(pool).query(
      'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1',
      [email],
    );
    if (existingUser.rows[0]) {
      throw new HttpError(409, 'Este e-mail já possui cadastro. Peça ao cliente para fazer login.');
    }

    const passwordHash = await hashPassword(CLIENT_TEMPORARY_PASSWORD);
    const client = await db(pool).connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (salon_id, name, email, password_hash, role, phone)
         VALUES ($1, $2, $3, $4, 'cliente', $5)
         RETURNING id`,
        [salonId, name, email, passwordHash, phone],
      );
      const userId = userResult.rows[0].id;
      const clientResult = await client.query<ClientRow>(
        `INSERT INTO clients (salon_id, user_id, name, phone, email, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${CLIENT_SELECT}`,
        [salonId, userId, name, phone, email, input.notes?.trim() || null],
      );
      await client.query('COMMIT');
      return {
        client: mapClient(clientResult.rows[0]),
        temporaryPassword: CLIENT_TEMPORARY_PASSWORD,
      };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
        throw new HttpError(409, 'Já existe um cliente com este e-mail.');
      }
      throw err;
    } finally {
      client.release();
    }
  }

  try {
    const result = await db(pool).query<ClientRow>(
      `INSERT INTO clients (salon_id, name, phone, email, notes, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${CLIENT_SELECT}`,
      [
        salonId,
        name,
        input.phone ? optionalPhone(input.phone) : null,
        email,
        input.notes?.trim() || null,
        input.userId ?? null,
      ],
    );
    return { client: mapClient(result.rows[0]) };
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

  const current = await db(pool).query<{ user_id: string | null }>(
    `SELECT user_id FROM clients WHERE id = $1 AND salon_id = $2`,
    [id, salonId],
  );
  if (!current.rows[0]) throw new HttpError(404, 'Cliente não encontrado.');

  const phone = current.rows[0].user_id
    ? await requireUniquePhone(input.phone, pool, current.rows[0].user_id)
    : optionalPhone(input.phone);

  try {
    const result = await db(pool).query<ClientRow>(
      `UPDATE clients
       SET name = $3, phone = $4, email = $5, notes = $6
       WHERE id = $1 AND salon_id = $2
       RETURNING ${CLIENT_SELECT}`,
      [id, salonId, name, phone, email, input.notes?.trim() || null],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Cliente não encontrado.');

    if (result.rows[0].user_id) {
      await db(pool).query(
        `UPDATE users SET phone = $2, updated_at = NOW() WHERE id = $1`,
        [result.rows[0].user_id, phone],
      );
    }

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
  const phone = await requireUniquePhone(input.phone, pool);
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
      `INSERT INTO users (salon_id, name, email, password_hash, role, phone)
       VALUES ($1, $2, $3, $4, 'cliente', $5)
       RETURNING id`,
      [salonId, name, email, passwordHash, phone],
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
  const phone = await requireUniquePhone(input.phone, pool, userId);

  const existing = await getClientByUserId(salonId, userId, pool);
  if (!existing) throw new HttpError(404, 'Perfil de cliente não encontrado.');

  if (input.password) {
    if (input.password.length < 8) {
      throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
    }
    const passwordHash = await hashPassword(input.password);
    await db(pool).query(
      `UPDATE users SET name = $2, phone = $3, password_hash = $4, updated_at = NOW() WHERE id = $1`,
      [userId, name, phone, passwordHash],
    );
  } else {
    await db(pool).query(
      `UPDATE users SET name = $2, phone = $3, updated_at = NOW() WHERE id = $1`,
      [userId, name, phone],
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
  const variants = phoneLookupVariants(phone);
  if (variants.length > 0) {
    const existing = await db(pool).query<ClientRow>(
      `SELECT ${CLIENT_SELECT}
       FROM clients
       WHERE salon_id = $1
         AND active = TRUE
         AND ${phoneDigitsSql('phone')} = ANY($2::text[])
       LIMIT 1`,
      [salonId, variants],
    );
    if (existing.rows[0]) return mapClient(existing.rows[0]);
  }
  return (await createClient(salonId, input, pool)).client;
}
