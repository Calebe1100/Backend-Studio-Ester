import { Pool } from 'pg';
import { comparePassword, hashPassword } from '../lib/crypto';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  refreshTokenExpiresAt,
} from '../lib/jwt';
import { generateSecureToken, hashToken } from '../lib/crypto';
import { getPool } from '../db/pool';
import { isValidBrPhone, maskPhone, phoneLookupVariants } from '../lib/phone';
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_HOUR,
  OTP_TTL_MINUTES,
  generateOtpCode,
  hashOtpCode,
  otpCodeMatches,
} from '../lib/otp';

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

interface PasswordResetCodeRow {
  id: string;
  user_id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
}

/** Minutos de validade do token emitido após a validação do código. */
const RESET_TOKEN_TTL_MINUTES = 15;

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

/** Dígitos do telefone como estão gravados, sem máscara nem zeros à esquerda. */
function phoneDigitsSql(column: string): string {
  return `regexp_replace(regexp_replace(COALESCE(${column}, ''), '\\D', '', 'g'), '^0+', '')`;
}

/**
 * Localiza o usuário ativo pelo celular. O telefone da equipe fica em
 * `users.phone` e o dos clientes em `clients.phone`.
 */
async function findActiveUserIdByPhone(db: Pool, phone: string): Promise<string | null> {
  const variants = phoneLookupVariants(phone);
  if (variants.length === 0) return null;

  const result = await db.query<{ id: string }>(
    `SELECT u.id
       FROM users u
       LEFT JOIN clients c ON c.user_id = u.id
      WHERE u.active = TRUE
        AND (
          ${phoneDigitsSql('u.phone')} = ANY($1::text[])
          OR ${phoneDigitsSql('c.phone')} = ANY($1::text[])
        )
      ORDER BY u.created_at ASC
      LIMIT 1`,
    [variants]
  );

  return result.rows[0]?.id ?? null;
}

async function invalidateResetCode(db: Pool, id: string): Promise<void> {
  await db.query('UPDATE password_reset_codes SET used_at = NOW() WHERE id = $1', [id]);
}

/**
 * Gera o código de recuperação de senha do celular informado e o persiste
 * (apenas o hash). Retorna null quando o número não existe ou o limite de
 * envios por hora foi atingido — quem chama responde sempre igual.
 */
export async function createPasswordResetCode(
  phone: string,
  pool?: Pool
): Promise<{ code: string; userId: string } | null> {
  const db = resolvePool(pool);

  if (!isValidBrPhone(phone)) return null;

  const userId = await findActiveUserIdByPhone(db, phone);
  if (!userId) return null;

  const recent = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM password_reset_codes
      WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [userId]
  );
  if (Number(recent.rows[0]?.count ?? 0) >= OTP_MAX_PER_HOUR) {
    console.warn('[auth] Limite de códigos por hora atingido para', maskPhone(phone));
    return null;
  }

  // Só o código mais recente vale
  await db.query(
    `UPDATE password_reset_codes SET used_at = NOW()
      WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  await db.query(
    `INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashOtpCode(code), expiresAt]
  );

  return { code, userId };
}

/**
 * Valida o código recebido no celular e emite um token de uso único para a
 * troca da senha.
 */
export async function verifyPasswordResetCode(
  phone: string,
  code: string,
  pool?: Pool
): Promise<{ resetToken: string; expiresIn: number }> {
  const db = resolvePool(pool);
  const invalidCode = () =>
    Object.assign(new Error('Código inválido ou expirado.'), { statusCode: 400 });

  const digits = (code ?? '').replace(/\D/g, '');
  if (digits.length !== OTP_LENGTH) throw invalidCode();

  const userId = await findActiveUserIdByPhone(db, phone);
  if (!userId) throw invalidCode();

  const result = await db.query<PasswordResetCodeRow>(
    `SELECT id, user_id, code_hash, attempts, expires_at
       FROM password_reset_codes
      WHERE user_id = $1 AND used_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId]
  );

  const row = result.rows[0];
  if (!row) throw invalidCode();

  if (new Date(row.expires_at) < new Date()) {
    await invalidateResetCode(db, row.id);
    throw invalidCode();
  }

  if (!otpCodeMatches(digits, row.code_hash)) {
    const attempts = row.attempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await invalidateResetCode(db, row.id);
      throw Object.assign(new Error('Muitas tentativas. Solicite um novo código.'), {
        statusCode: 429,
      });
    }
    await db.query('UPDATE password_reset_codes SET attempts = $2 WHERE id = $1', [
      row.id,
      attempts,
    ]);
    throw invalidCode();
  }

  await invalidateResetCode(db, row.id);

  const { token, tokenHash } = generateSecureToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await db.query(
    `UPDATE password_reset_tokens SET used_at = NOW()
      WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { resetToken: token, expiresIn: RESET_TOKEN_TTL_MINUTES * 60 };
}

/**
 * Consome token de recuperação e define nova senha.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  pool?: Pool
): Promise<void> {
  const db = resolvePool(pool);

  if (!newPassword || newPassword.length < 8) {
    throw Object.assign(new Error('A senha deve ter pelo menos 8 caracteres.'), {
      statusCode: 400,
    });
  }

  const tokenHash = hashToken(token);
  const result = await db.query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
    `SELECT id, user_id, expires_at, used_at
     FROM password_reset_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row || row.used_at) {
    throw Object.assign(new Error('Token de recuperação inválido.'), { statusCode: 400 });
  }
  if (new Date(row.expires_at) < new Date()) {
    throw Object.assign(new Error('Token de recuperação expirado.'), { statusCode: 400 });
  }

  const passwordHash = await hashPassword(newPassword);
  await db.query(
    `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [row.user_id, passwordHash]
  );
  await db.query(
    `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
    [row.id]
  );

  // Sessões abertas em outros dispositivos deixam de valer
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [row.user_id]
  );
}
