import { Router, Request } from 'express';
import { verifyToken, requireRole } from '../middlewares/auth';
import { attachLiveAccount } from '../middlewares/account';
import { requireSessionSalon } from '../middlewares/salon';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/httpError';
import * as clients from '../services/clientsService';
import * as professionals from '../services/professionalsService';
import * as services from '../services/servicesService';
import * as appointments from '../services/appointmentsService';
import * as users from '../services/usersService';
import * as access from '../services/professionalAccessService';
import * as totals from '../services/totalsService';
import * as expenses from '../services/expensesService';
import * as balance from '../services/balanceService';
import {
  notifyAppointmentStatusChanged,
  notifyStaffNewBooking,
} from '../services/notificationsService';
import * as inbox from '../services/notificationsInboxService';
import * as push from '../services/pushService';
import { env } from '../config/env';
import { dateInZone, DEFAULT_SALON_TIMEZONE } from '../lib/time';

const router = Router();

router.use(verifyToken);
router.use(asyncHandler(requireSessionSalon));
router.use(asyncHandler(attachLiveAccount));

const OPAQUE_CONFLICT = 'Horário indisponível.';

function viewerOf(req: Request) {
  return {
    role: req.user!.role,
    professionalId: req.account?.professionalId ?? null,
    permissions: req.account?.permissions ?? null,
  };
}

function assertProfessionalBooking(req: Request, professionalId: string | undefined) {
  if (req.user!.role !== 'profissional') return;
  const permissions = req.account?.permissions;
  const ownId = req.account?.professionalId;
  if (!permissions?.agendar || !ownId || professionalId !== ownId) {
    throw new HttpError(403, 'Acesso negado para este papel');
  }
}

async function presentAppointments(req: Request, items: appointments.AppointmentDTO[]) {
  const names = await clients.listClientNames(
    salonId(req),
    [...new Set(items.map((item) => item.clientId))],
  );
  const viewer = viewerOf(req);
  return items.map((item) => access.presentAppointment(item, names.get(item.clientId), viewer));
}

function salonId(req: Request): string {
  return req.user!.salonId;
}

function dateRange(req: Request): { from: string; to: string } | null {
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  if (!from || !to) return null;
  return { from, to };
}

// ── Me / perfil do cliente ──────────────────────
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const account = req.account!;
    res.json({
      user: {
        id: account.id,
        name: account.name,
        email: account.email,
        role: account.role,
      },
      permissions: account.role === 'profissional' ? account.permissions : null,
      professionalId: account.role === 'profissional' ? account.professionalId : null,
    });
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
    if (req.user!.role === 'profissional' && !req.account?.permissions?.listaClientes) {
      res.status(403).json({ error: 'Acesso negado para este papel' });
      return;
    }
    const list = await clients.listClients(salonId(req));
    res.json({
      clients:
        req.user!.role === 'profissional' ? list.map((client) => access.presentClient(client)) : list,
    });
  }),
);

router.post(
  '/clients',
  requireRole('dono', 'recepcao'),
  asyncHandler(async (req, res) => {
    const { client, temporaryPassword } = await clients.createClient(salonId(req), req.body);
    res.status(201).json({ client, temporaryPassword });
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
    let list = await professionals.listProfessionals(salonId(req));
    if (req.user!.role === 'profissional' && !req.account?.permissions?.agendaEquipe) {
      const ownId = req.account?.professionalId;
      list = ownId ? list.filter((item) => item.id === ownId) : [];
    }
    res.json({ professionals: list });
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
    const list = await services.listServices(salonId(req));
    const viewer = viewerOf(req);
    res.json({ services: list.map((service) => access.presentService(service, viewer)) });
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
      const ownId = req.account?.professionalId;
      if (!ownId) {
        res.json({ appointments: [] });
        return;
      }
      if (!req.account?.permissions?.agendaEquipe) {
        professionalId = ownId;
      }
    }

    if (req.user!.role === 'cliente') {
      const mine = await clients.getClientByUserId(salonId(req), req.user!.sub);
      if (!mine) {
        res.json({ appointments: [] });
        return;
      }
      clientId = mine.id;
    }

    const list = await appointments.listAppointments(salonId(req), {
      date,
      from,
      to,
      professionalId,
      clientId,
    });
    res.json({ appointments: await presentAppointments(req, list) });
  }),
);

router.post(
  '/appointments',
  requireRole('dono', 'recepcao', 'profissional'),
  asyncHandler(async (req, res) => {
    assertProfessionalBooking(req, req.body?.professionalId);
    const opaque = req.user!.role === 'profissional';
    const appointment = await appointments.createAppointment(
      salonId(req),
      req.body,
      undefined,
      opaque ? { conflictMessage: OPAQUE_CONFLICT } : undefined,
    );
    const [presented] = await presentAppointments(req, [appointment]);
    res.status(201).json({ appointment: presented });
  }),
);

router.post(
  '/appointments/book',
  requireRole('dono', 'recepcao', 'profissional', 'cliente'),
  asyncHandler(async (req, res) => {
    const { name, phone, email, professionalId, serviceId, date, start, notes } = req.body;

    if (req.user!.role === 'profissional') {
      assertProfessionalBooking(req, professionalId);
    }

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

    const appointment = await appointments.createAppointment(
      salonId(req),
      {
        clientId: client.id,
        professionalId,
        serviceId,
        date,
        start,
        notes,
      },
      undefined,
      req.user!.role === 'profissional' ? { conflictMessage: OPAQUE_CONFLICT } : undefined,
    );

    // Cliente reservou → avisa a equipe (e-mail / push / WhatsApp). Não bloqueia o 201.
    if (req.user!.role === 'cliente') {
      void (async () => {
        try {
          const [professional, service] = await Promise.all([
            professionals.getActiveProfessional(salonId(req), professionalId),
            services.getActiveService(salonId(req), serviceId),
          ]);
          await notifyStaffNewBooking(salonId(req), {
            clientName: client.name,
            serviceName: service.name,
            professionalName: professional.name,
            date,
            start,
          });
        } catch (err) {
          console.error('[notify] Falha ao montar notificação de reserva:', err);
        }
      })();
    }

    const [presented] = await presentAppointments(req, [appointment]);
    const shareContact = Boolean(
      req.account?.permissions?.listaClientes || req.account?.permissions?.clienteContato,
    );
    const visibleClient =
      req.user!.role === 'profissional'
        ? access.presentClient(
            shareContact
              ? client
              : {
                  ...client,
                  name: access.firstName(client.name),
                  phone: '',
                  notes: '',
                },
          )
        : client;
    res.status(201).json({ appointment: presented, client: visibleClient });
  }),
);

router.put(
  '/appointments/:id',
  requireRole('dono', 'recepcao', 'profissional'),
  asyncHandler(async (req, res) => {
    if (req.user!.role === 'profissional') {
      const existing = await appointments.getAppointment(salonId(req), req.params.id);
      const ownId = req.account?.professionalId;
      if (!existing || existing.professionalId !== ownId) {
        res.status(403).json({ error: 'Acesso negado para este papel' });
        return;
      }
      assertProfessionalBooking(req, req.body?.professionalId);
    }
    const appointment = await appointments.updateAppointment(
      salonId(req),
      req.params.id,
      req.body,
      undefined,
      req.user!.role === 'profissional' ? { conflictMessage: OPAQUE_CONFLICT } : undefined,
    );
    const [presented] = await presentAppointments(req, [appointment]);
    res.json({ appointment: presented });
  }),
);

router.patch(
  '/appointments/:id/status',
  requireRole('dono', 'recepcao', 'profissional', 'cliente'),
  asyncHandler(async (req, res) => {
    let clientId: string | undefined;
    if (req.user!.role === 'cliente') {
      const mine = await clients.getClientByUserId(salonId(req), req.user!.sub);
      if (!mine) {
        res.status(404).json({ error: 'Perfil de cliente não encontrado.' });
        return;
      }
      clientId = mine.id;
    }

    if (req.user!.role === 'profissional') {
      const existing = await appointments.getAppointment(salonId(req), req.params.id);
      const ownId = req.account?.professionalId;
      if (!existing || existing.professionalId !== ownId) {
        res.status(403).json({ error: 'Acesso negado para este papel' });
        return;
      }
      const nextStatus = String(req.body.status ?? '');
      const operational = ['confirmado', 'em_atendimento', 'concluido', 'nao_compareceu'];
      if (nextStatus === 'cancelado') {
        if (!req.account?.permissions?.agendar) {
          res.status(403).json({ error: 'Acesso negado para este papel' });
          return;
        }
      } else if (!operational.includes(nextStatus)) {
        res.status(403).json({ error: 'Acesso negado para este papel' });
        return;
      }
    }

    const appointment = await appointments.setAppointmentStatus(
      salonId(req),
      req.params.id,
      req.body.status,
      undefined,
      clientId,
    );
    void notifyAppointmentStatusChanged(
      salonId(req),
      appointment.id,
      req.user!.sub,
      req.user!.role,
    );
    const [presented] = await presentAppointments(req, [appointment]);
    res.json({ appointment: presented });
  }),
);

router.get(
  '/notifications',
  requireRole('dono', 'recepcao', 'profissional', 'cliente'),
  asyncHandler(async (req, res) => {
    const notifications = await inbox.listUnseenNotifications(salonId(req), req.user!.sub);
    res.json({ notifications });
  }),
);

router.post(
  '/notifications/seen',
  requireRole('dono', 'recepcao', 'profissional', 'cliente'),
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : undefined;
    await inbox.markNotificationsSeen(salonId(req), req.user!.sub, ids);
    res.json({ ok: true });
  }),
);

// ── Users (dono) ────────────────────────────────
router.get(
  '/users',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({ users: await access.listAccounts(salonId(req), q) });
  }),
);

router.post(
  '/users/:id/professional-access',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const user = await access.grantProfessionalAccess(
      salonId(req),
      req.user!.sub,
      req.params.id,
      req.body ?? {},
    );
    res.status(201).json({ user });
  }),
);

router.patch(
  '/users/:id/professional-access',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const user = await access.updateProfessionalAccess(
      salonId(req),
      req.user!.sub,
      req.params.id,
      req.body ?? {},
    );
    res.json({ user });
  }),
);

router.delete(
  '/users/:id/professional-access',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const user = await access.revokeProfessionalAccess(salonId(req), req.params.id);
    res.json({ user });
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

// ── Web Push (equipe) ───────────────────────────
router.get(
  '/push/vapid-public-key',
  requireRole('dono', 'recepcao', 'profissional'),
  asyncHandler(async (_req, res) => {
    if (!env.vapid.publicKey) {
      res.status(503).json({ error: 'Push não configurado neste servidor.' });
      return;
    }
    res.json({ publicKey: env.vapid.publicKey });
  }),
);

router.post(
  '/push/subscribe',
  requireRole('dono', 'recepcao', 'profissional'),
  asyncHandler(async (req, res) => {
    await push.savePushSubscription(
      req.user!.sub,
      req.body,
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    );
    res.status(201).json({ ok: true });
  }),
);

router.delete(
  '/push/subscribe',
  requireRole('dono', 'recepcao', 'profissional'),
  asyncHandler(async (req, res) => {
    const endpoint =
      typeof req.body?.endpoint === 'string'
        ? req.body.endpoint
        : typeof req.query.endpoint === 'string'
          ? req.query.endpoint
          : '';
    await push.deletePushSubscription(req.user!.sub, endpoint);
    res.json({ ok: true });
  }),
);

// ── Expenses / despesas (dono) ──────────────────
router.get(
  '/expenses',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    res.json({ expenses: await expenses.listExpenses(salonId(req)) });
  }),
);

router.get(
  '/expenses/occurrences',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const range = dateRange(req);
    if (!range) {
      res.status(400).json({ error: 'Informe from e to (YYYY-MM-DD).' });
      return;
    }
    res.json({
      occurrences: await expenses.listExpenseOccurrences(salonId(req), range.from, range.to),
    });
  }),
);

router.post(
  '/expenses',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const expense = await expenses.createExpense(salonId(req), req.body);
    res.status(201).json({ expense });
  }),
);

router.put(
  '/expenses/:id',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const expense = await expenses.updateExpense(salonId(req), req.params.id, req.body);
    res.json({ expense });
  }),
);

router.patch(
  '/expenses/:id/active',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const expense = await expenses.setExpenseActive(
      salonId(req),
      req.params.id,
      Boolean(req.body.active),
    );
    res.json({ expense });
  }),
);

// ── Totals / balance / dashboard (dono) ─────────
router.get(
  '/totals',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const range = dateRange(req);
    if (!range) {
      res.status(400).json({ error: 'Informe from e to (YYYY-MM-DD).' });
      return;
    }
    res.json({ totals: await totals.getTotals(salonId(req), range.from, range.to) });
  }),
);

router.get(
  '/balance',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const range = dateRange(req);
    if (!range) {
      res.status(400).json({ error: 'Informe from e to (YYYY-MM-DD).' });
      return;
    }
    res.json({ balance: await balance.getBalance(salonId(req), range.from, range.to) });
  }),
);

router.get(
  '/dashboard',
  requireRole('dono'),
  asyncHandler(async (req, res) => {
    const today = dateInZone(new Date(), req.salon?.timezone ?? DEFAULT_SALON_TIMEZONE);
    const monthStart = `${today.slice(0, 8)}01`;
    const [dayAppointments, dayTotals, monthBalance] = await Promise.all([
      appointments.listAppointments(salonId(req), { date: today }),
      totals.getTotals(salonId(req), today, today),
      balance.getBalance(salonId(req), monthStart, today),
    ]);
    res.json({
      date: today,
      appointments: dayAppointments,
      totals: dayTotals,
      monthBalance,
    });
  }),
);

export default router;
