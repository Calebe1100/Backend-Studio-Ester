import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/httpError';
import { clientIp, createRateLimiter } from '../lib/rateLimit';
import { requirePublicSalon } from '../middlewares/salon';
import * as appointments from '../services/appointmentsService';
import * as clients from '../services/clientsService';
import * as leads from '../services/leadsService';
import { notifyStaffNewBooking } from '../services/notificationsService';
import * as professionals from '../services/professionalsService';
import * as salons from '../services/salonsService';
import * as services from '../services/servicesService';

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

/** Catálogo e ocupação pública: 60 consultas por IP a cada minuto. */
export const publicCatalogLimiter = createRateLimiter({ max: 60, windowMs: 60 * 1000 });

/** Agendamento visitante: 10 reservas por IP a cada hora. */
export const publicBookLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

function assertPublicRateLimit(limiter: ReturnType<typeof createRateLimiter>, req: { headers: Record<string, unknown>; ip?: string }) {
  const limit = limiter.hit(clientIp(req));
  if (!limit.allowed) {
    const err = new HttpError(429, 'Muitas tentativas. Tente novamente mais tarde.');
    (err as HttpError & { retryAfterSec?: number }).retryAfterSec = limit.retryAfterSec;
    throw err;
  }
}

function isBookingHoneypot(body: { website?: unknown } | null | undefined): boolean {
  const value = typeof body?.website === 'string' ? body.website.trim() : '';
  return value.length > 0;
}

/**
 * GET /api/public/branding
 * Nome e tema visual do salão. O app usa isso para pintar a interface.
 */
router.get(
  '/branding',
  asyncHandler(requirePublicSalon),
  asyncHandler(async (req, res) => {
    assertPublicRateLimit(publicCatalogLimiter, req);
    const salon = req.salon!;
    res.json({ name: salon.name, slug: salon.slug, theme: salon.theme });
  }),
);

/**
 * GET /api/public/catalog
 * Profissionais e serviços ativos, sem identificadores de conta.
 */
router.get(
  '/catalog',
  asyncHandler(requirePublicSalon),
  asyncHandler(async (req, res) => {
    assertPublicRateLimit(publicCatalogLimiter, req);
    const salonId = req.salon!.id;
    const [professionalList, serviceList] = await Promise.all([
      professionals.listProfessionals(salonId),
      services.listServices(salonId),
    ]);
    const logoUpdatedAt = await salons.getSalonLogoUpdatedAt(salonId);
    res.json({
      professionals: professionalList
        .filter((item) => item.active)
        .map(({ userId: _userId, ...item }) => item),
      services: serviceList.filter((item) => item.active),
      logoUpdatedAt,
    });
  }),
);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const publicImageLimiter = createRateLimiter({ max: 240, windowMs: 60 * 1000 });

function sendStoredImage(
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (name: string, value: string) => void;
    send: (body: Buffer) => void;
  },
  image: { bytes: Buffer; contentType: string } | null,
) {
  if (!image) {
    res.status(404).json({ error: 'Imagem não encontrada.' });
    return;
  }
  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(image.bytes);
}

/**
 * GET /api/public/salons/:slug/logo
 * A tag img não envia o header do salão, então o slug vai na URL.
 */
router.get(
  '/salons/:slug/logo',
  asyncHandler(async (req, res) => {
    assertPublicRateLimit(publicImageLimiter, req);
    const salon = await salons.requireSalonBySlug(req.params.slug);
    sendStoredImage(res, await salons.getSalonLogo(salon.id));
  }),
);

/**
 * GET /api/public/salons/:slug/services/:id/image
 */
router.get(
  '/salons/:slug/services/:id/image',
  asyncHandler(async (req, res) => {
    assertPublicRateLimit(publicImageLimiter, req);
    if (!UUID_PATTERN.test(req.params.id)) {
      res.status(404).json({ error: 'Imagem não encontrada.' });
      return;
    }
    const salon = await salons.requireSalonBySlug(req.params.slug);
    sendStoredImage(res, await services.getServiceImage(salon.id, req.params.id));
  }),
);

/**
 * GET /api/public/availability?from&to&professionalId
 * Horários ocupados, sem dados do cliente.
 */
router.get(
  '/availability',
  asyncHandler(requirePublicSalon),
  asyncHandler(async (req, res) => {
    assertPublicRateLimit(publicCatalogLimiter, req);
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    const professionalId =
      typeof req.query.professionalId === 'string' ? req.query.professionalId : undefined;
    const slots = await appointments.listBusySlots(req.salon!.id, { from, to, professionalId });
    res.json({ slots });
  }),
);

/**
 * POST /api/public/appointments/book
 * Body: { name, phone, email, professionalId, serviceId, date, start, notes?, website? }
 * Sempre cria cliente visitante — não vincula a conta existente.
 */
router.post(
  '/appointments/book',
  asyncHandler(requirePublicSalon),
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    if (isBookingHoneypot(body)) {
      res.status(202).json({ message: 'Recebido.' });
      return;
    }

    const limit = publicBookLimiter.hit(clientIp(req));
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' });
      return;
    }

    const { name, phone, email, professionalId, serviceId, date, start, notes } = body;
    const salonId = req.salon!.id;
    const client = await clients.createVisitorClient(salonId, { name, phone, email, notes });
    const appointment = await appointments.createAppointment(salonId, {
      clientId: client.id,
      professionalId,
      serviceId,
      date,
      start,
      notes,
    });

    void (async () => {
      try {
        const [professional, service] = await Promise.all([
          professionals.getActiveProfessional(salonId, professionalId),
          services.getActiveService(salonId, serviceId),
        ]);
        await notifyStaffNewBooking(salonId, {
          clientName: client.name,
          serviceName: service.name,
          professionalName: professional.name,
          date,
          start,
        });
      } catch (err) {
        console.error('[notify] Falha ao montar notificação de reserva visitante:', err);
      }
    })();

    res.status(201).json({
      appointment: {
        id: appointment.id,
        professionalId: appointment.professionalId,
        serviceId: appointment.serviceId,
        date: appointment.date,
        start: appointment.start,
        end: appointment.end,
        status: appointment.status,
        servicePriceSnapshot: appointment.servicePriceSnapshot,
        serviceDurationSnapshot: appointment.serviceDurationSnapshot,
      },
    });
  }),
);

/**
 * POST /api/public/leads
 * Body: { name, phone, email?, salonName, teamSize?, theme, consent, source?, utm?, website? }
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

// Sem este fim, /api/public/* sem rota cai no router autenticado e espera token.
router.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

export default router;
