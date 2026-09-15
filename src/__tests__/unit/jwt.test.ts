import jwt from 'jsonwebtoken';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  refreshTokenExpiresAt,
  AccessTokenPayload,
} from '../../lib/jwt';

const MOCK_USER = {
  sub: 'user-uuid-123',
  role: 'dono',
  salonId: 'salon-uuid-456',
};

describe('generateAccessToken', () => {
  it('retorna uma string não vazia', () => {
    const token = generateAccessToken(MOCK_USER);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('payload contém sub, role e salonId', () => {
    const token = generateAccessToken(MOCK_USER);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.sub).toBe(MOCK_USER.sub);
    expect(decoded.role).toBe(MOCK_USER.role);
    expect(decoded.salonId).toBe(MOCK_USER.salonId);
    expect(decoded.type).toBe('access');
  });

  it('contém campo exp no payload', () => {
    const token = generateAccessToken(MOCK_USER);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.exp).toBeDefined();
  });
});

describe('generateRefreshToken', () => {
  it('retorna uma string não vazia', () => {
    const token = generateRefreshToken('user-uuid-123');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('type é "refresh"', () => {
    const token = generateRefreshToken('user-uuid-123');
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.type).toBe('refresh');
    expect(decoded.sub).toBe('user-uuid-123');
  });

  it('dois tokens gerados são únicos (iat pode diferir; iat is same se muito rápido — verificar exp)', () => {
    const t1 = generateRefreshToken('user-uuid-123');
    const t2 = generateRefreshToken('user-uuid-456');
    expect(t1).not.toBe(t2);
  });
});

describe('verifyAccessToken', () => {
  it('decodifica corretamente um token válido', () => {
    const token = generateAccessToken(MOCK_USER);
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe(MOCK_USER.sub);
    expect(payload.role).toBe(MOCK_USER.role);
    expect(payload.salonId).toBe(MOCK_USER.salonId);
    expect(payload.type).toBe('access');
  });

  it('lança erro para token alterado', () => {
    const token = generateAccessToken(MOCK_USER);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('lança TokenExpiredError para token expirado', () => {
    // Gera token com expiração no passado usando sign direto
    const expiredToken = jwt.sign(
      { ...MOCK_USER, type: 'access' },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: -1 }
    );
    expect(() => verifyAccessToken(expiredToken)).toThrow(jwt.TokenExpiredError);
  });

  it('lança erro para token de refresh usado como access', () => {
    const refreshToken = generateRefreshToken(MOCK_USER.sub);
    // Refresh token é assinado com chave diferente — deve falhar na verificação
    expect(() => verifyAccessToken(refreshToken)).toThrow();
  });
});

describe('verifyRefreshToken', () => {
  it('decodifica corretamente um refresh token válido', () => {
    const token = generateRefreshToken('user-uuid-123');
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe('user-uuid-123');
    expect(payload.type).toBe('refresh');
  });

  it('lança erro para token alterado', () => {
    const token = generateRefreshToken('user-uuid-123');
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyRefreshToken(tampered)).toThrow();
  });

  it('lança erro ao usar access token como refresh', () => {
    const accessToken = generateAccessToken(MOCK_USER);
    // Access token é assinado com chave diferente — deve falhar
    expect(() => verifyRefreshToken(accessToken)).toThrow();
  });
});

describe('refreshTokenExpiresAt', () => {
  it('retorna uma data futura', () => {
    const date = refreshTokenExpiresAt();
    expect(date.getTime()).toBeGreaterThan(Date.now());
  });

  it('retorna uma data aproximadamente 7 dias no futuro (para JWT_REFRESH_EXPIRES_IN=7d)', () => {
    const date = refreshTokenExpiresAt();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const diff = date.getTime() - Date.now();
    // Tolerância de 1 segundo
    expect(Math.abs(diff - sevenDaysMs)).toBeLessThan(1000);
  });
});

describe('Payload JWT — campos obrigatórios', () => {
  it('access token contém todos os campos esperados', () => {
    const token = generateAccessToken(MOCK_USER);
    const payload = verifyAccessToken(token);
    const keys: Array<keyof AccessTokenPayload> = ['sub', 'role', 'salonId', 'type'];
    for (const key of keys) {
      expect(payload[key]).toBeDefined();
    }
  });
});
