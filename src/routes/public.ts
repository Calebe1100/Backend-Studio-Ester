import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { clientIp, createRateLimiter } from '../lib/rateLimit';
import { requirePublicSalon } from '../middlewares/salon';
import * as clients from '../services/clientsService';
import * as leads from '../services/leadsService';

const router = Router();

/**
 * POST /api/public/clients/register
 * Body: { name, phone, email, password }
 * Cria conta de acesso (role=cliente) + perfil de cliente.
 */
router.post(
  '/clients/register',
  asyncHandler(requirePublicSalon),
  asyncHandler(async (req, res) => {
    const { client } = await clients.registerClientAccess(req.body ?? {}, req.salon!.id);
    res.status(201).json({
      message: 'Conta criada com sucesso. Faça login para continuar.',
      client: {
        id: client.id,
        name: client.name,
        phone: client.phone,
        email: client.email,
      },
    });
  }),
);

// Landing page: no máximo 5 envios por IP a cada hora.
const leadsLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

/**
 * POST /api/public/leads
 * Body: { name, phone, email?, salonName, teamSize?, consent, source?, utm?, website? }
 * Captura lead comercial da landing page SalonSign.
 */
router.post(
  '/leads',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};

    // Bots que preenchem o honeypot recebem sucesso falso e nada é gravado.
    if (leads.isHoneypotTriggered(body)) {
      res.status(202).json({ message: 'Recebido.' });
      return;
    }

    const limit = leadsLimiter.hit(clientIp(req));
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' });
      return;
    }

    const { lead, duplicated } = await leads.createLead(body);
    res.status(duplicated ? 200 : 201).json({
      message: duplicated
        ? 'Já recebemos seu contato. Em breve falamos com você.'
        : 'Recebemos seu contato. Em breve falamos com você.',
      lead: { id: lead.id, createdAt: lead.createdAt },
    });
  }),
);

export default router;
