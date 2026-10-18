import request from 'supertest';
import { createApp } from '../../app';
import { HttpError } from '../../lib/httpError';
import { createVisitorClient } from '../../services/clientsService';
import { createAppointment, listBusySlots } from '../../services/appointmentsService';
import { listProfessionals, getActiveProfessional } from '../../services/professionalsService';
import { listServices, getActiveService } from '../../services/servicesService';
import { getSalonLogoUpdatedAt, requireSalonBySlug } from '../../services/salonsService';
import { notifyStaffNewBooking } from '../../services/notificationsService';
import { publicBookLimiter, publicCatalogLimiter } from '../../routes/public';

jest.mock('../../services/salonsService', () => ({
  requireSalonBySlug: jest.fn(),
  getSalonById: jest.fn(),
  getSalonLogoUpdatedAt: jest.fn(),
  provisionSalon: jest.fn(),
  normalizeSlug: (value: string) => String(value).trim().toLowerCase(),
}));

jest.mock('../../services/clientsService', () => ({
  registerClientAccess: jest.fn(),
  createVisitorClient: jest.fn(),
}));

jest.mock('../../services/appointmentsService', () => ({
  createAppointment: jest.fn(),
  listBusySlots: jest.fn(),
}));

jest.mock('../../services/professionalsService', () => ({
  listProfessionals: jest.fn(),
  getActiveProfessional: jest.fn(),
}));

jest.mock('../../services/servicesService', () => ({
  listServices: jest.fn(),
  getActiveService: jest.fn(),
}));

jest.mock('../../services/notificationsService', () => ({
  notifyStaffNewBooking: jest.fn(),
}));

const mockRequireSalon = requireSalonBySlug as jest.MockedFunction<typeof requireSalonBySlug>;
const mockLogoUpdatedAt = getSalonLogoUpdatedAt as jest.MockedFunction<typeof getSalonLogoUpdatedAt>;
const mockCreateVisitor = createVisitorClient as jest.MockedFunction<typeof createVisitorClient>;
const mockCreateAppointment = createAppointment as jest.MockedFunction<typeof createAppointment>;
const mockBusy = listBusySlots as jest.MockedFunction<typeof listBusySlots>;
const mockListProfessionals = listProfessionals as jest.MockedFunction<typeof listProfessionals>;
const mockListServices = listServices as jest.MockedFunction<typeof listServices>;
const mockGetProfessional = getActiveProfessional as jest.MockedFunction<typeof getActiveProfessional>;
const mockGetService = getActiveService as jest.MockedFunction<typeof getActiveService>;
const mockNotify = notifyStaffNewBooking as jest.MockedFunction<typeof notifyStaffNewBooking>;

const app = createApp();

const salon = {
  id: 'salon-1',
  name: 'Studio Ana Ester',
  slug: 'ana-ester',
  phone: null,
  address: null,
  timezone: 'America/Sao_Paulo',
  currency: 'BRL',
  locale: 'pt-BR',
  contactEmail: null,
  brandColor: '#7c2d3e',
  frontendOrigins: [] as string[],
  clientCancelLeadMinutes: 120,
  active: true,
};

function withSalon(req: request.Test) {
  return req.set('X-Salon-Slug', 'ana-ester');
}

beforeEach(() => {
  mockRequireSalon.mockResolvedValue(salon);
  mockLogoUpdatedAt.mockResolvedValue(null);
  mockNotify.mockResolvedValue(undefined);
  mockGetProfessional.mockResolvedValue({
    id: 'pro-1',
    name: 'Camila',
    workStart: '09:00',
    workEnd: '18:00',
    workDays: [1, 2, 3, 4, 5],
    active: true,
    serviceIds: ['svc-1'],
    userId: 'u-pro',
  });
  mockGetService.mockResolvedValue({
    id: 'svc-1',
    name: 'Corte',
    durationMinutes: 60,
    price: 120,
    active: true,
    imageUpdatedAt: null,
  });
  publicBookLimiter.reset();
  publicCatalogLimiter.reset();
});

describe('GET /api/public/catalog', () => {
  it('lista só ativos e omite userId', async () => {
    mockListProfessionals.mockResolvedValueOnce([
      {
        id: 'pro-1',
        name: 'Camila',
        workStart: '09:00',
        workEnd: '18:00',
        workDays: [1, 2, 3, 4, 5],
        active: true,
        serviceIds: ['svc-1'],
        userId: 'secret-user',
      },
      {
        id: 'pro-2',
        name: 'Inativa',
        workStart: '09:00',
        workEnd: '18:00',
        workDays: [1, 2, 3, 4, 5],
        active: false,
        serviceIds: [],
        userId: null,
      },
    ]);
    mockListServices.mockResolvedValueOnce([
      { id: 'svc-1', name: 'Corte', durationMinutes: 60, price: 120, active: true, imageUpdatedAt: null },
      { id: 'svc-2', name: 'Antigo', durationMinutes: 30, price: 40, active: false, imageUpdatedAt: null },
    ]);

    const res = await withSalon(request(app).get('/api/public/catalog'));
    expect(res.status).toBe(200);
    expect(res.body.professionals).toHaveLength(1);
    expect(res.body.professionals[0].userId).toBeUndefined();
    expect(res.body.services).toEqual([
      { id: 'svc-1', name: 'Corte', durationMinutes: 60, price: 120, active: true, imageUpdatedAt: null },
    ]);
    expect(res.body.logoUpdatedAt).toBeNull();
  });

  it('não encaminha rota pública desconhecida para o login', async () => {
    const res = await request(app).get('/api/public/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Rota não encontrada.');
  });
});

describe('GET /api/public/availability', () => {
  it('devolve só ocupação, sem PII', async () => {
    mockBusy.mockResolvedValueOnce([
      {
        professionalId: 'pro-1',
        date: '2026-10-20',
        start: '10:00',
        end: '11:00',
        status: 'agendado',
      },
    ]);

    const res = await withSalon(
      request(app).get('/api/public/availability').query({ from: '2026-10-01', to: '2026-10-31' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([
      {
        professionalId: 'pro-1',
        date: '2026-10-20',
        start: '10:00',
        end: '11:00',
        status: 'agendado',
      },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/client/i);
    expect(JSON.stringify(res.body)).not.toMatch(/email|phone|name/i);
  });
});

describe('POST /api/public/appointments/book', () => {
  const payload = {
    name: 'Visitante Ana',
    phone: '11988887777',
    email: 'ana@exemplo.com',
    professionalId: 'pro-1',
    serviceId: 'svc-1',
    date: '2026-11-02',
    start: '10:00',
  };

  it('cria visitante sem JWT mesmo com e-mail já cadastrado', async () => {
    mockCreateVisitor.mockResolvedValueOnce({
      id: 'cli-v',
      name: 'Visitante Ana',
      phone: '11988887777',
      email: 'ana@exemplo.com',
      notes: '',
      active: true,
      userId: null,
      kind: 'visitante',
    });
    mockCreateAppointment.mockResolvedValueOnce({
      id: 'apt-v',
      clientId: 'cli-v',
      professionalId: 'pro-1',
      serviceId: 'svc-1',
      date: '2026-11-02',
      start: '10:00',
      end: '11:00',
      status: 'agendado',
      notes: '',
      servicePriceSnapshot: 120,
      serviceDurationSnapshot: 60,
    });

    const res = await withSalon(request(app).post('/api/public/appointments/book').send(payload));
    expect(res.status).toBe(201);
    expect(mockCreateVisitor).toHaveBeenCalledWith(
      'salon-1',
      expect.objectContaining({ email: 'ana@exemplo.com', name: 'Visitante Ana' }),
    );
    expect(res.body.appointment.clientId).toBeUndefined();
    expect(res.body.appointment.id).toBe('apt-v');
  });

  it('responde 429 quando o IP excede o limite', async () => {
    mockCreateVisitor.mockResolvedValue({
      id: 'cli-v',
      name: 'Visitante Ana',
      phone: '11988887777',
      email: 'ana@exemplo.com',
      notes: '',
      active: true,
      userId: null,
      kind: 'visitante',
    });
    mockCreateAppointment.mockResolvedValue({
      id: 'apt-v',
      clientId: 'cli-v',
      professionalId: 'pro-1',
      serviceId: 'svc-1',
      date: '2026-11-02',
      start: '10:00',
      end: '11:00',
      status: 'agendado',
      notes: '',
      servicePriceSnapshot: 120,
      serviceDurationSnapshot: 60,
    });

    let last = { status: 0 };
    for (let i = 0; i < 11; i += 1) {
      last = await withSalon(request(app).post('/api/public/appointments/book').send(payload));
    }
    expect(last.status).toBe(429);
  });

  it('ignora honeypot sem gravar', async () => {
    const res = await withSalon(
      request(app).post('/api/public/appointments/book').send({ ...payload, website: 'http://spam' }),
    );
    expect(res.status).toBe(202);
    expect(mockCreateVisitor).not.toHaveBeenCalled();
  });

  it('propaga erro de validação do visitante', async () => {
    mockCreateVisitor.mockRejectedValueOnce(new HttpError(400, 'Informe o nome completo.'));
    const res = await withSalon(request(app).post('/api/public/appointments/book').send(payload));
    expect(res.status).toBe(400);
  });
});
