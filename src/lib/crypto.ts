import bcrypt from 'bcrypt';
import crypto from 'crypto';

const SALT_ROUNDS = 12;

/** Gera o hash bcrypt de uma senha em texto puro. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/** Compara senha em texto puro com o hash armazenado. */
export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Gera um token aleatório seguro (hex) e seu SHA-256 para persistência. */
export function generateSecureToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

/** Retorna o SHA-256 de um token (para busca no banco). */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
