import { Request, Response, NextFunction } from 'express';
import { verifyToken, requireRole } from '../../middlewares/auth';
import { generateAccessToken } from '../../lib/jwt';
import jwt from 'jsonwebtoken';

// Helpers para criar mocks do Express
function mockReq(overrides: Partial<Request> = {}): Request {
  return { headers: {}, ...overrides } as unknown as Request;
}

function mockRes(): { status: jest.Mock; json: jest.Mock; send: jest.Mock; _status: number } {
  const res = {
    _status: 0,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return res as unknown as typeof res;
}

const MOCK_USER = { sub: 'user-1', role: 'dono', salonId: 'salon-1' };

describe('verifyToken middleware', () => {
  it('chama next() para token válido e popula req.user', () => {
    const token = generateAccessToken(MOCK_USER);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    verifyToken(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user!.sub).toBe(MOCK_USER.sub);
    expect(req.user!.role).toBe(MOCK_USER.role);
  });

  it('retorna 401 quando header Authorization está ausente', () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    verifyToken(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('retorna 401 quando header não começa com "Bearer "', () => {
    const req = mockReq({ headers: { authorization: 'Token abc123' } });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    verifyToken(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('retorna 401 com mensagem "Token inválido" para token malformado', () => {
    const req = mockReq({ headers: { authorization: 'Bearer nao_e_um_jwt' } });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    verifyToken(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Token inválido' }));
  });

  it('retorna 401 com mensagem "Token expirado" para token expirado', () => {
    const expiredToken = jwt.sign(
      { ...MOCK_USER, type: 'access' },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: -1 }
    );
    const req = mockReq({ headers: { authorization: `Bearer ${expiredToken}` } });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    verifyToken(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Token expirado' }));
  });
});

describe('requireRole middleware', () => {
  it('chama next() quando papel bate', () => {
    const req = mockReq({ user: { ...MOCK_USER, type: 'access' as const } });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    requireRole('dono', 'recepcao')(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('retorna 403 quando papel não está na lista', () => {
    const req = mockReq({ user: { sub: 'u1', role: 'profissional', salonId: 's1', type: 'access' as const } });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    requireRole('dono')(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('retorna 401 quando req.user não está definido', () => {
    const req = mockReq();
    const res = mockRes();
    const next: NextFunction = jest.fn();

    requireRole('dono')(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('permite todos os papéis quando todos estão listados', () => {
    const roles = ['dono', 'recepcao', 'profissional'];
    for (const role of roles) {
      const req = mockReq({ user: { sub: 'u1', role, salonId: 's1', type: 'access' as const } });
      const res = mockRes();
      const next: NextFunction = jest.fn();
      requireRole('dono', 'recepcao', 'profissional')(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalled();
    }
  });
});
