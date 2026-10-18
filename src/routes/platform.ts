import crypto from 'crypto';
import { Router } from 'express';
import { platformApiKey } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/httpError';
import { provisionSalon } from '../services/salonsService';

const router = Router();

function keysMatch(provided: string, expected: string): boolean {
  const left = crypto.createHash('sha256').update(provided).digest();
  const right = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(left, right);
}

/**
 * POST /api/platform/salons
 * Header: Authorization: Bearer <PLATFORM_API_KEY>
 * Cria um salão e o primeiro usuário dono. A chave não autentica rotas do salão.
 */
router.post(
  '/salons',
  asyncHandler(async (req, res) => {
    const expected = platformApiKey();
    if (!expected) throw new HttpError(503, 'Provisionamento não configurado.');

    const header = req.header('authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!provided || !keysMatch(provided, expected)) {
      throw new HttpError(401, 'Chave de plataforma inválida.');
    }

    const salon = await provisionSalon(req.body ?? {});
    res.status(201).json({ salon });
  }),
);

export default router;
