import { Router, Request } from 'express';
import { verifyToken, requireRole } from '../middlewares/auth';
import { asyncHandler } from '../lib/asyncHandler';
import * as clients from '../services/clientsService';
import * as professionals from '../services/professionalsService';
import * as services from '../services/servicesService';
import * as appointments from '../services/appointmentsService';
import * as users from '../services/usersService';
import * as totals from '../services/totalsService';

const router = Router();

router.use(verifyToken);

function salonId(req: Request): string {
  return req.user!.salonId;
}

// ── Me / perfil do cliente ──────────────────────
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);

router.get(
  '/me/profile',
  requireRole('cliente'),
  asyncHandler(async (req, res) => {
    const profile = await clients.getClientByUserId(salonId(req), req.user!.sub);
    if (!profile) {
      res.status(404).json({ error: 'Perfil de cliente não encontrado.' });
      return;
    }
    res.json({ profile });
  }),
);

router.put(
  '/me/profile',
  requireRole('cliente'),
  asyncHandler(async (req, res) => {
    const profile = await clients.updateClientProfile(salonId(req), req.user!.sub, req.body ?? {});
    res.json({ profile });
  }),
);

// ── Clients (dono, recepção) ────────────────────
router.get(
  '/clients',
  requireRole('dono', 'recepcao', 'profissional'),
  asyncHandler(async (req, res) => {
    res.json({ clients: await clients.listClients(salonId(req)) });
  }),
);

router.post(
  '/clients',
  requireRole('dono', 'recepcao'),
  asyncHandler(async (req, res) => {
    const client = await clients.createClient(salonId(req), req.body);
    res.status(201).json({ client });
  }),
);

router.put(
  '/clients/:id',
  requireRole('dono', 'recepcao'),
  asyncHandler(async (req, res) => {
    const client = await clients.updateClient(salonId(req), req.params.id, req.body);
    res.json({ client });
  }),
);

router.patch(
  '/clients/:id/active',
  requireRole('dono', 'recepcao'),
  asyncHandler(async (req, res) => {
    const client = await clients.setClientActive(
      salonId(req),
      req.params.id,
      Boolean(req.body.active),
    );
    res.json({ client });
  }),
);

// ── Professionals (dono) ────────────────────────
router.get(
  '/professionals',
  requireRole('dono', 'recepcao', 'profissional', 'cliente'),
  asyncHandler(async (req, res) => {
    res.json({ professionals: await professionals.listProfessionals(salonId(req)) });
  }),
);

router.post(
  '/professionals',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const professional = await professionals.createProfessional(salonId(req), req.body);
    res.status(201).json({ professional });
  }),
);

router.put(
  '/professionals/:id',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const professional = await professionals.updateProfessional(
      salonId(req),
      req.params.id,
      req.body,
    );
    res.json({ professional });
  }),
);

router.patch(
  '/professionals/:id/active',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const professional = await professionals.setProfessionalActive(
      salonId(req),
      req.params.id,
      Boolean(req.body.active),
    );
    res.json({ professional });
  }),
);

// ── Services (list: operação; write: dono) ──────
router.get(
  '/services',
  requireRole('dono', 'recepcao', 'profissional', 'cliente'),
  asyncHandler(async (req, res) => {
    res.json({ services: await services.listServices(salonId(req)) });
  }),
);

router.post(
  '/services',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const service = await services.createService(salonId(req), req.body);
    res.status(201).json({ service });
  }),
);

router.put(
  '/services/:id',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const service = await services.updateService(salonId(req), req.params.id, req.body);
    res.json({ service });
  }),
);

router.patch(
  '/services/:id/active',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const service = await services.setServiceActive(
      salonId(req),
      req.params.id,
      Boolean(req.body.active),
    );
    res.json({ service });
  }),
);

// ── Appointments / agenda ───────────────────────
router.get(
  '/appointments',
  requireRole('dono', 'recepcao', 'profissional', 'cliente'),
  asyncHandler(async (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    let professionalId =
      typeof req.query.professionalId === 'string' ? req.query.professionalId : undefined;
    let clientId: string | undefined;

    if (req.user!.role === 'profissional') {
      const all = await professionals.listProfessionals(salonId(req));
      const mine = all.find((p) => p.userId === req.user!.sub);
      if (!mine) {
        res.json({ appointments: [] });
        return;
      }
      professionalId = mine.id;
    }

    if (req.user!.role === 'cliente') {
      const mine = await clients.getClientByUserId(salonId(req), req.user!.sub);
      if (!mine) {
        res.json({ appointments: [] });
        return;
      }
      clientId = mine.id;
    }

    res.json({
      appointments: await appointments.listAppointments(salonId(req), {
        date,
        from,
        to,
        professionalId,
        clientId,
      }),
    });
  }),
);

router.post(
  '/appointments',
  requireRole('dono', 'recepcao', 'profissional'),
  asyncHandler(async (req, res) => {
    const appointment = await appointments.createAppointment(salonId(req), req.body);
    res.status(201).json({ appointment });
  }),
);

router.post(
  '/appointments/book',
  requireRole('dono', 'recepcao', 'profissional', 'cliente'),
  asyncHandler(async (req, res) => {
    const { name, phone, email, professionalId, serviceId, date, start, notes } = req.body;

    let client;
    if (req.user!.role === 'cliente') {
      client = await clients.getClientByUserId(salonId(req), req.user!.sub);
      if (!client) {
        res.status(400).json({ error: 'Perfil de cliente não encontrado.' });
        return;
      }
    } else {
      client = await clients.findOrCreateClient(salonId(req), { name, phone, email });
    }

    const appointment = await appointments.createAppointment(salonId(req), {
      clientId: client.id,
      professionalId,
      serviceId,
      date,
      start,
      notes,
    });
    res.status(201).json({ appointment, client });
  }),
);

router.put(
  '/appointments/:id',
  requireRole('dono', 'recepcao', 'profissional'),
  asyncHandler(async (req, res) => {
    const appointment = await appointments.updateAppointment(
      salonId(req),
      req.params.id,
      req.body,
    );
    res.json({ appointment });
  }),
);

router.patch(
  '/appointments/:id/status',
  requireRole('dono', 'recepcao', 'profissional'),
  asyncHandler(async (req, res) => {
    const appointment = await appointments.setAppointmentStatus(
      salonId(req),
      req.params.id,
      req.body.status,
    );
    res.json({ appointment });
  }),
);

// ── Users (dono) ────────────────────────────────
router.get(
  '/users',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    res.json({ users: await users.listUsers(salonId(req)) });
  }),
);

router.post(
  '/users',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const user = await users.createUser(salonId(req), req.body);
    res.status(201).json({ user });
  }),
);

router.put(
  '/users/:id',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const user = await users.updateUser(salonId(req), req.params.id, req.body);
    res.json({ user });
  }),
);

router.patch(
  '/users/:id/active',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const user = await users.setUserActive(
      salonId(req),
      req.params.id,
      Boolean(req.body.active),
      req.user!.sub,
    );
    res.json({ user });
  }),
);

// ── Totals / dashboard (dono) ───────────────────
router.get(
  '/totals',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (!from || !to) {
      res.status(400).json({ error: 'Informe from e to (YYYY-MM-DD).' });
      return;
    }
    res.json({ totals: await totals.getTotals(salonId(req), from, to) });
  }),
);

router.get(
  '/dashboard',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
    }).format(new Date());
    const [dayAppointments, dayTotals] = await Promise.all([
      appointments.listAppointments(salonId(req), { date: today }),
      totals.getTotals(salonId(req), today, today),
    ]);
    res.json({
      date: today,
      appointments: dayAppointments,
      totals: dayTotals,
    });
  }),
);

export default router;
