import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';
import { hashPassword } from '../lib/crypto';

export type UserDTO = {
  id: string;
  name: string;
  email: string;
  role: 'dono' | 'recepcao' | 'profissional';
  active: boolean;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
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
    role: row.role,
    active: row.active,
  };
}

export async function listUsers(salonId: string, pool?: Pool): Promise<UserDTO[]> {
  const result = await db(pool).query<UserRow>(
    `SELECT id, name, email, role, active
     FROM users
     WHERE salon_id = $1
     ORDER BY active DESC, name ASC`,
    [salonId],
  );
  return result.rows.map(mapUser);
}

export async function createUser(
  salonId: string,
  input: {
    name: string;
    email: string;
    password: string;
    role: string;
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

  const passwordHash = await hashPassword(input.password);
  try {
    const result = await db(pool).query<UserRow>(
      `INSERT INTO users (salon_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, role, active`,
      [salonId, name, email, passwordHash, input.role],
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
  input: { name: string; role: string; password?: string },
  pool?: Pool,
): Promise<UserDTO> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do usuário.');
  if (!ROLES.includes(input.role as UserDTO['role'])) {
    throw new HttpError(400, 'Papel inválido.');
  }

  if (input.password) {
    if (input.password.length < 8) {
      throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
    }
    const passwordHash = await hashPassword(input.password);
    const result = await db(pool).query<UserRow>(
      `UPDATE users
       SET name = $3, role = $4, password_hash = $5, updated_at = NOW()
       WHERE id = $1 AND salon_id = $2
       RETURNING id, name, email, role, active`,
      [id, salonId, name, input.role, passwordHash],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Usuário não encontrado.');
    return mapUser(result.rows[0]);
  }

  const result = await db(pool).query<UserRow>(
    `UPDATE users
     SET name = $3, role = $4, updated_at = NOW()
     WHERE id = $1 AND salon_id = $2
     RETURNING id, name, email, role, active`,
    [id, salonId, name, input.role],
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
     RETURNING id, name, email, role, active`,
    [id, salonId, active],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Usuário não encontrado.');
  return mapUser(result.rows[0]);
}
