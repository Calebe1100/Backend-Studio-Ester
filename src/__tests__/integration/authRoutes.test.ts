/**
 * Testes das rotas HTTP de autenticação.
 * Usa supertest + mock do authService para testar os handlers Express.
 */
import request from 'supertest';
import { createApp } from '../../app';

// Mock do authService para isolar os testes das rotas
jest.mock('../../services/authService', () => ({
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
  createPasswordResetCode: jest.fn(),
  verifyPasswordResetCode: jest.fn(),
  resetPassword: jest.fn(),
}));

// Evita qualquer envio real de WhatsApp/SMS nos testes de rota
jest.mock('../../lib/otp', () => ({
  OTP_TTL_MINUTES: 10,
  sendPasswordResetCode: jest.fn(),
}));

import * as authService from '../../services/authService';
import { sendPasswordResetCode } from '../../lib/otp';
const mockLogin = authService.login as jest.MockedFunction<typeof authService.login>;
const mockRefresh = authService.refresh as jest.MockedFunction<typeof authService.refresh>;
const mockLogout = authService.logout as jest.MockedFunction<typeof authService.logout>;
const mockCreateCode = authService.createPasswordResetCode as jest.MockedFunction<
  typeof authService.createPasswordResetCode
>;
const mockVerifyCode = authService.verifyPasswordResetCode as jest.MockedFunction<
  typeof authService.verifyPasswordResetCode
>;
const mockSendCode = sendPasswordResetCode as jest.MockedFunction<typeof sendPasswordResetCode>;

const app = createApp();

const MOCK_LOGIN_RESULT = {
  accessToken: 'mock.access.token',
  refreshToken: 'mock.refresh.token',
  expiresIn: 900,
  user: { id: 'user-1', name: 'Ester', email: 'ester@studioester.com.br', role: 'dono' },
};

describe('POST /api/auth/login', () => {
  it('retorna 200 e tokens para credenciais válidas', async () => {
    mockLogin.mockResolvedValueOnce(MOCK_LOGIN_RESULT);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ester@studioester.com.br', password: 'Senh@Correta123' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('mock.access.token');
    expect(res.body.refreshToken).toBe('mock.refresh.token');
    expect(res.body.expiresIn).toBe(900);
    expect(res.body.user.role).toBe('dono');
  });

  it('retorna 401 para credenciais inválidas', async () => {
    mockLogin.mockRejectedValueOnce(
      Object.assign(new Error('Credenciais inválidas'), { statusCode: 401 })
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ester@studioester.com.br', password: 'errada' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Credenciais inválidas');
  });

  it('retorna 400 quando email está ausente', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'alguma_senha' });

    expect(res.status).toBe(400);
  });

  it('retorna 400 quando password está ausente', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(400);
  });

  it('retorna 400 para body vazio', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/refresh', () => {
  it('retorna 200 e novos tokens para refresh token válido', async () => {
    mockRefresh.mockResolvedValueOnce({
      accessToken: 'new.access.token',
      refreshToken: 'new.refresh.token',
      expiresIn: 900,
    });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid.refresh.token' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('new.access.token');
    expect(res.body.refreshToken).toBe('new.refresh.token');
  });

  it('retorna 401 para refresh token revogado', async () => {
    mockRefresh.mockRejectedValueOnce(
      Object.assign(new Error('Refresh token revogado'), { statusCode: 401 })
    );

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'revoked.token' });

    expect(res.status).toBe(401);
  });

  it('retorna 400 quando refreshToken está ausente', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('retorna 204 para logout bem-sucedido', async () => {
    mockLogout.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: 'valid.refresh.token' });

    expect(res.status).toBe(204);
  });

  it('retorna 204 mesmo se logout falhar (idempotente)', async () => {
    mockLogout.mockRejectedValueOnce(new Error('token não encontrado'));

    const res = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: 'qualquer.token' });

    expect(res.status).toBe(204);
  });

  it('retorna 400 quando refreshToken está ausente', async () => {
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    mockCreateCode.mockReset();
    mockSendCode.mockReset();
  });

  it('envia o código quando o celular está cadastrado', async () => {
    mockCreateCode.mockResolvedValueOnce({ code: '123456', userId: 'user-1' });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ phone: '(11) 98888-7777' });

    expect(res.status).toBe(200);
    expect(mockSendCode).toHaveBeenCalledWith('(11) 98888-7777', '123456');
  });

  it('responde igual quando o celular não existe (sem enviar nada)', async () => {
    mockCreateCode.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ phone: '11900000000' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
    expect(mockSendCode).not.toHaveBeenCalled();
  });

  it('responde 200 mesmo se o envio falhar', async () => {
    mockCreateCode.mockResolvedValueOnce({ code: '123456', userId: 'user-1' });
    mockSendCode.mockRejectedValueOnce(new Error('WhatsApp fora do ar'));

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ phone: '11988887777' });

    expect(res.status).toBe(200);
  });

  it('retorna 400 quando o celular está ausente', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/verify-reset-code', () => {
  beforeEach(() => {
    mockVerifyCode.mockReset();
  });

  it('retorna o token de redefinição para código válido', async () => {
    mockVerifyCode.mockResolvedValueOnce({ resetToken: 'reset.token', expiresIn: 900 });

    const res = await request(app)
      .post('/api/auth/verify-reset-code')
      .send({ phone: '11988887777', code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.resetToken).toBe('reset.token');
  });

  it('retorna 400 para código inválido', async () => {
    mockVerifyCode.mockRejectedValueOnce(
      Object.assign(new Error('Código inválido ou expirado.'), { statusCode: 400 })
    );

    const res = await request(app)
      .post('/api/auth/verify-reset-code')
      .send({ phone: '11988887777', code: '000000' });

    expect(res.status).toBe(400);
  });

  it('retorna 429 após muitas tentativas', async () => {
    mockVerifyCode.mockRejectedValueOnce(
      Object.assign(new Error('Muitas tentativas. Solicite um novo código.'), { statusCode: 429 })
    );

    const res = await request(app)
      .post('/api/auth/verify-reset-code')
      .send({ phone: '11988887777', code: '000000' });

    expect(res.status).toBe(429);
  });

  it('retorna 400 quando falta o código', async () => {
    const res = await request(app)
      .post('/api/auth/verify-reset-code')
      .send({ phone: '11988887777' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/me (rota protegida)', () => {
  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('retorna 401 com token inválido', async () => {
    const res = await request(app)
      .get('/api/me')
      .set('Authorization', 'Bearer token.invalido.aqui');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/dashboard (somente dono)', () => {
  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });
});

describe('GET /health', () => {
  it('retorna 200 com status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
