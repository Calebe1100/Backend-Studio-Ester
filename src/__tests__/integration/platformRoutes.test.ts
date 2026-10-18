import request from 'supertest';
import { createApp } from '../../app';
import { generateAccessToken } from '../../lib/jwt';
import { HttpError } from '../../lib/httpError';
import { provisionSalon, requireSalonBySlug, getSalonById } from '../../services/salonsService';
import { registerClientAccess } from '../../services/clientsService';

jest.mock('../../services/salonsService', () => ({
  provisionSalon: jest.fn(),
  requireSalonBySlug: jest.fn(),
  getSalonById: jest.fn(),
  normalizeSlug: (value: string) => String(value).trim().toLowerCase(),
}));

jest.mock('../../services/clientsService', () => ({
  registerClientAccess: jest.fn(),
}));

const mockProvision = provisionSalon as jest.MockedFunction<typeof provisionSalon>;
const mockRequireSalon = requireSalonBySlug as jest.MockedFunction<typeof requireSalonBySlug>;
const mockGetSalon = getSalonById as jest.MockedFunction<typeof getSalonById>;
const mockRegister = registerClientAccess as jest.MockedFunction<typeof registerClientAccess>;

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
  frontendOrigins: [],
  clientCancelLeadMinutes: 120,
  active: true,
};

describe('POST /api/platform/salons', () => {
  beforeEach(() => {
    process.env.PLATFORM_API_KEY = 'platform-test-key';
  });

  it('recusa a requisição sem a chave', async () => {
    const res = await request(app).post('/api/platform/salons').send({ name: 'Novo' });
    expect(res.status).toBe(401);
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it('responde 503 quando a chave não está configurada', async () => {
    delete process.env.PLATFORM_API_KEY;
    const res = await request(app)
      .post('/api/platform/salons')
      .set('Authorization', 'Bearer qualquer');
    expect(res.status).toBe(503);
  });

  it('cria o salão e o dono com a chave', async () => {
    mockProvision.mockResolvedValueOnce({
      id: 'salon-2',
      name: 'Salão B',
      slug: 'salao-b',
      timezone: 'America/Manaus',
      currency: 'BRL',
      locale: 'pt-BR',
      owner: { id: 'owner-2', name: 'Bia', email: 'bia@salao.com', role: 'dono' },
    });

    const res = await request(app)
      .post('/api/platform/salons')
      .set('Authorization', 'Bearer platform-test-key')
      .send({ name: 'Salão B', slug: 'salao-b' });

    expect(res.status).toBe(201);
    expect(res.body.salon.slug).toBe('salao-b');
    expect(res.body.salon.owner.role).toBe('dono');
  });

  it('não usa a chave de plataforma como sessão de salão', async () => {
    const res = await request(app)
      .get('/api/clients')
      .set('Authorization', 'Bearer platform-test-key');
    expect(res.status).toBe(401);
  });
});

describe('slug do salão', () => {
  it('recusa cadastro público sem slug e não cria cliente no primeiro salão', async () => {
    const res = await request(app).post('/api/public/clients/register').send({
      name: 'Ana Silva',
      phone: '11988887777',
      email: 'ana@exemplo.com',
      password: 'senha1234',
    });
    expect(res.status).toBe(400);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('responde 404 para slug desconhecido', async () => {
    mockRequireSalon.mockRejectedValueOnce(new HttpError(404, 'Salão não encontrado.'));
    const res = await request(app)
      .post('/api/public/clients/register')
      .set('X-Salon-Slug', 'nao-existe')
      .send({
        name: 'Ana Silva',
        phone: '11988887777',
        email: 'ana@exemplo.com',
        password: 'senha1234',
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Salão não encontrado.');
  });

  it('cadastra no salão do slug', async () => {
    mockRequireSalon.mockResolvedValueOnce({ ...salon, id: 'salon-b', slug: 'salao-b', name: 'Salão B' });
    mockRegister.mockResolvedValueOnce({
      client: {
        id: 'client-b',
        name: 'Ana Silva',
        phone: '11988887777',
        email: 'ana@exemplo.com',
        notes: '',
        active: true,
        userId: 'user-b',
      },
      userId: 'user-b',
    });

    const res = await request(app)
      .post('/api/public/clients/register')
      .set('X-Salon-Slug', 'salao-b')
      .send({
        name: 'Ana Silva',
        phone: '11988887777',
        email: 'ana@exemplo.com',
        password: 'senha1234',
      });

    expect(res.status).toBe(201);
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@exemplo.com' }),
      'salon-b',
    );
  });

  it('responde 403 quando o slug não é o do token', async () => {
    mockGetSalon.mockResolvedValueOnce(salon);
    const token = generateAccessToken({ sub: 'user-1', role: 'dono', salonId: 'salon-1' });

    const res = await request(app)
      .get('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Salon-Slug', 'salao-b');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Salão não corresponde à sessão.');
  });
});
