import { Pool } from 'pg';
import { comparePassword } from '../lib/crypto';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  refreshTokenExpiresAt,
} from '../lib/jwt';
import { generateSecureToken, hashToken } from '../lib/crypto';
import { getPool } from '../db/pool';

interface UserRow {
  id: string;
  salon_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  active: boolean;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // segundos
  user: { id: string; name: string; email: string; role: string };
}

function resolvePool(pool?: Pool): Pool {
  return pool ?? getPool();
}

/**
 * Autentica um usuário e persiste o refresh token no banco.
 */
export async function login(
  email: string,
  password: string,
  pool?: Pool
): Promise<LoginResult> {
  const db = resolvePool(pool);

  const result = await db.query<UserRow>(
    'SELECT * FROM users WHERE email = $1 AND active = TRUE',
    [email.toLowerCase().trim()]
  );

  const user = result.rows[0];

  // Proteção de timing: compara mesmo sem usuário para evitar timing attack
  const dummyHash =
    '$2b$12$invalidhashforuserthatdoesnotexist00000000000000000000000';
  const passwordMatch = user
    ? await comparePassword(password, user.password_hash)
    : await comparePassword(password, dummyHash).then(() => false);

  if (!user || !passwordMatch) {
    throw Object.assign(new Error('Credenciais inválidas'), { statusCode: 401 });
  }

  const accessToken = generateAccessToken({
    sub: user.id,
    role: user.role,
    salonId: user.salon_id,
  });

  const refreshToken = generateRefreshToken(user.id);
  const tokenHash = hashToken(refreshToken);
  const expiresAt = refreshTokenExpiresAt();

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt]
  );

  return {
    accessToken,
    refreshToken,
    expiresIn: 900, // 15 minutos em segundos
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

/**
 * Renova o access token a partir de um refresh token válido.
 * Aplica rotação: revoga o token antigo e emite um novo.
 */
export async function refresh(
  refreshToken: string,
  pool?: Pool
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const db = resolvePool(pool);

  // Verifica assinatura JWT do refresh token
  const payload = verifyRefreshToken(refreshToken); // lança se inválido/expirado

  const tokenHash = hashToken(refreshToken);
  const result = await db.query<RefreshTokenRow>(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = $1 AND user_id = $2`,
    [tokenHash, payload.sub]
  );

  const stored = result.rows[0];
  if (!stored) {
    throw Object.assign(new Error('Refresh token não encontrado'), { statusCode: 401 });
  }
  if (stored.revoked_at) {
    throw Object.assign(new Error('Refresh token revogado'), { statusCode: 401 });
  }
  if (new Date(stored.expires_at) < new Date()) {
    throw Object.assign(new Error('Refresh token expirado'), { statusCode: 401 });
  }

  // Busca dados atualizados do usuário
  const userResult = await db.query<UserRow>(
    'SELECT * FROM users WHERE id = $1 AND active = TRUE',
    [payload.sub]
  );
  const user = userResult.rows[0];
  if (!user) {
    throw Object.assign(new Error('Usuário inativo ou removido'), { statusCode: 401 });
  }

  // Revoga o token antigo
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
    [stored.id]
  );

  // Emite novos tokens (rotação)
  const newAccessToken = generateAccessToken({
    sub: user.id,
    role: user.role,
    salonId: user.salon_id,
  });
  const newRefreshToken = generateRefreshToken(user.id);
  const newTokenHash = hashToken(newRefreshToken);
  const expiresAt = refreshTokenExpiresAt();

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, newTokenHash, expiresAt]
  );

  return { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn: 900 };
}

/**
 * Revoga o refresh token no banco (logout seguro).
 */
export async function logout(refreshToken: string, pool?: Pool): Promise<void> {
  const db = resolvePool(pool);
  const tokenHash = hashToken(refreshToken);
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
    [tokenHash]
  );
}

/**
 * Gera um token de recuperação de senha e o persiste no banco.
 * Retorna o token bruto (deve ser enviado por e-mail).
 */
export async function createPasswordResetToken(
  email: string,
  pool?: Pool
): Promise<{ token: string; userId: string } | null> {
  const db = resolvePool(pool);

  const result = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1 AND active = TRUE',
    [email.toLowerCase().trim()]
  );

  const user = result.rows[0];
  if (!user) return null; // Não revelar se e-mail existe

  const { token, tokenHash } = generateSecureToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

  // Invalida tokens anteriores
  await db.query(
    `UPDATE password_reset_tokens SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [user.id]
  );

  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt]
  );

  return { token, userId: user.id };
}
