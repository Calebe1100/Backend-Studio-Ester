import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';
import { hashPassword } from '../lib/crypto';

export type UserDTO = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'dono' | 'recepcao' | 'profissional';
  active: boolean;
};

export type StaffContact = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserDTO['role'];
  active: boolean;
};

const ROLES: UserDTO['role'][] = ['dono', 'recepcao', 'profissional'];

function db(pool?: Pool) {
  return pool ?? getPool();
}

function mapUser(row: UserRow): UserDTO {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? '',
    role: row.role,
    active: row.active,
  };
}

function normalizePhone(raw?: string | null): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length < 10) {
    throw new HttpError(400, 'Informe um telefone válido com DDD.');
  }
  return digits;
}

export async function listUsers(salonId: string, pool?: Pool): Promise<UserDTO[]> {
  const result = await db(pool).query<UserRow>(
    `SELECT id, name, email, phone, role, active
     FROM users
     WHERE salon_id = $1
       AND role IN ('dono', 'recepcao', 'profissional')
     ORDER BY active DESC, name ASC`,
    [salonId],
  );
  return result.rows.map(mapUser);
}

/** Equipe ativa para notificações de nova reserva. */
export async function listActiveStaffContacts(
  salonId: string,
  pool?: Pool,
): Promise<StaffContact[]> {
  const result = await db(pool).query<{
    id: string;
    name: string;
    email: string;
    phone: string | null;
  }>(
    `SELECT id, name, email, phone
     FROM users
     WHERE salon_id = $1
       AND active = TRUE
       AND role IN ('dono', 'recepcao', 'profissional')`,
    [salonId],
  );
  return result.rows;
}

export async function createUser(
  salonId: string,
  input: {
    name: string;
    email: string;
    password: string;
    role: string;
    phone?: string;
  },
  pool?: Pool,
): Promise<UserDTO> {
  const name = input.name?.trim() ?? '';
  const email = input.email?.trim().toLowerCase() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do usuário.');
  if (!email || !email.includes('@')) throw new HttpError(400, 'Informe um e-mail válido.');
  if (!input.password || input.password.length < 8) {
    throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
  }
  if (!ROLES.includes(input.role as UserDTO['role'])) {
    throw new HttpError(400, 'Papel inválido.');
  }

  const phone = normalizePhone(input.phone);
  const passwordHash = await hashPassword(input.password);
  try {
    const result = await db(pool).query<UserRow>(
      `INSERT INTO users (salon_id, name, email, password_hash, role, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, role, active`,
      [salonId, name, email, passwordHash, input.role, phone],
    );
    return mapUser(result.rows[0]);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw new HttpError(409, 'Já existe um usuário com este e-mail.');
    }
    throw err;
  }
}

export async function updateUser(
  salonId: string,
  id: string,
  input: { name: string; role: string; password?: string; phone?: string },
  pool?: Pool,
): Promise<UserDTO> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do usuário.');
  if (!ROLES.includes(input.role as UserDTO['role'])) {
    throw new HttpError(400, 'Papel inválido.');
  }

  const phone = normalizePhone(input.phone);

  if (input.password) {
    if (input.password.length < 8) {
      throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
    }
    const passwordHash = await hashPassword(input.password);
    const result = await db(pool).query<UserRow>(
      `UPDATE users
       SET name = $3, role = $4, password_hash = $5, phone = $6, updated_at = NOW()
       WHERE id = $1 AND salon_id = $2
         AND role IN ('dono', 'recepcao', 'profissional')
       RETURNING id, name, email, phone, role, active`,
      [id, salonId, name, input.role, passwordHash, phone],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Usuário não encontrado.');
    return mapUser(result.rows[0]);
  }

  const result = await db(pool).query<UserRow>(
    `UPDATE users
     SET name = $3, role = $4, phone = $5, updated_at = NOW()
     WHERE id = $1 AND salon_id = $2
       AND role IN ('dono', 'recepcao', 'profissional')
     RETURNING id, name, email, phone, role, active`,
    [id, salonId, name, input.role, phone],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Usuário não encontrado.');
  return mapUser(result.rows[0]);
}

export async function setUserActive(
  salonId: string,
  id: string,
  active: boolean,
  actorUserId: string,
  pool?: Pool,
): Promise<UserDTO> {
  if (id === actorUserId && !active) {
    throw new HttpError(400, 'Você não pode desativar a própria conta.');
  }
  const result = await db(pool).query<UserRow>(
    `UPDATE users SET active = $3, updated_at = NOW()
     WHERE id = $1 AND salon_id = $2
       AND role IN ('dono', 'recepcao', 'profissional')
     RETURNING id, name, email, phone, role, active`,
    [id, salonId, active],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Usuário não encontrado.');
  return mapUser(result.rows[0]);
}
