import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../lib/httpError';
import { getSalonById, normalizeSlug, requireSalonBySlug } from '../services/salonsService';

export function readSalonSlug(req: Request): string {
  const raw = req.header('x-salon-slug');
  return typeof raw === 'string' ? normalizeSlug(raw) : '';
}

/** Rotas públicas e login: o salão vem do header, nunca do primeiro registro. */
export async function requirePublicSalon(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const slug = readSalonSlug(req);
  if (!slug) throw new HttpError(400, 'Informe o salão.');
  req.salon = await requireSalonBySlug(slug);
  next();
}

/**
 * Rotas autenticadas usam o salonId do token.
 * Header ausente é ignorado. Header de outro salão responde 403.
 */
export async function requireSessionSalon(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.user) throw new HttpError(401, 'Não autenticado');

  const salon = await getSalonById(req.user.salonId);
  if (!salon || !salon.active) throw new HttpError(403, 'Salão indisponível.');

  const slug = readSalonSlug(req);
  if (slug && slug !== salon.slug) {
    throw new HttpError(403, 'Salão não corresponde à sessão.');
  }

  req.salon = salon;
  next();
}
