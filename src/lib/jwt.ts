import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';

export interface AccessTokenPayload {
  sub: string;       // user_id
  role: string;      // dono | recepcao | profissional
  salonId: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;       // user_id
  type: 'refresh';
}

/** Gera um access token JWT (curta duração). */
export function generateAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  const options: SignOptions = {
    expiresIn: env.jwtAccessExpiresIn as SignOptions['expiresIn'],
  };
  return jwt.sign({ ...payload, type: 'access' }, env.jwtAccessSecret, options);
}

/** Gera um refresh token JWT (longa duração). Inclui jti único para garantir unicidade. */
export function generateRefreshToken(userId: string): string {
  const options: SignOptions = {
    expiresIn: env.jwtRefreshExpiresIn as SignOptions['expiresIn'],
  };
  const jti = crypto.randomBytes(16).toString('hex');
  return jwt.sign({ sub: userId, type: 'refresh', jti }, env.jwtRefreshSecret, options);
}

/** Verifica e decodifica um access token. Lança erro se inválido/expirado. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwtAccessSecret) as JwtPayload;
  if (decoded.type !== 'access') {
    throw new Error('Tipo de token inválido');
  }
  return decoded as unknown as AccessTokenPayload;
}

/** Verifica e decodifica um refresh token. Lança erro se inválido/expirado. */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.jwtRefreshSecret) as JwtPayload;
  if (decoded.type !== 'refresh') {
    throw new Error('Tipo de token inválido');
  }
  return decoded as unknown as RefreshTokenPayload;
}

/** Retorna o timestamp de expiração do refresh token em ms. */
export function refreshTokenExpiresAt(): Date {
  // Replica a lógica de expiração para salvar no banco
  const durationStr = env.jwtRefreshExpiresIn; // ex: "7d"
  const match = durationStr.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Formato inválido para JWT_REFRESH_EXPIRES_IN: ${durationStr}`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return new Date(Date.now() + value * multipliers[unit]);
}
