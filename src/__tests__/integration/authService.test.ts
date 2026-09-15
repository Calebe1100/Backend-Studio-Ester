/**
 * Testes de persistência do login (integração com banco de dados).
 *
 * Para rodar com banco real: configure DATABASE_URL em .env.test e execute
 *   npm run migrate
 *   npm test
 *
 * Os testes usam mocks do pool de banco para funcionar sem banco externo.
 * Para testes com banco real, remova os mocks e use o pool real.
 */

import { login, refresh, logout } from '../../services/authService';
import { hashPassword } from '../../lib/crypto';
import { hashToken } from '../../lib/crypto';
import { verifyAccessToken, verifyRefreshToken } from '../../lib/jwt';

// ───────────────────────────────────────────────
// Mock do pool do banco de dados
// ───────────────────────────────────────────────

const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as unknown as import('pg').Pool;

// Banco de estado em memória para simular persistência
interface UserRow {
  id: string;
  salon_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  active: boolean;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

// Estado de banco em memória — reset entre testes
let inMemoryUsers: UserRow[] = [];
let inMemoryRefreshTokens: RefreshTokenRow[] = [];

function setupMockPool() {
  mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    const q = sql.trim().toLowerCase();

    // SELECT de usuário por e-mail
    if (q.startsWith('select * from users where email')) {
      const email = params[0] as string;
      const user = inMemoryUsers.find((u) => u.email === email && u.active);
      return { rows: user ? [user] : [] };
    }

    // SELECT de usuário por id
    if (q.startsWith('select * from users where id')) {
      const id = params[0] as string;
      const user = inMemoryUsers.find((u) => u.id === id && u.active);
      return { rows: user ? [user] : [] };
    }

    // INSERT de refresh token
    if (q.startsWith('insert into refresh_tokens')) {
      const row: RefreshTokenRow = {
        id: `rt-${Date.now()}-${Math.random()}`,
        user_id: params[0] as string,
        token_hash: params[1] as string,
        expires_at: params[2] as Date,
        revoked_at: null,
      };
      inMemoryRefreshTokens.push(row);
      return { rows: [row] };
    }

    // SELECT de refresh token por hash
    if (q.startsWith('select * from refresh_tokens\n     where token_hash')) {
      const tokenHash = params[0] as string;
      const userId = params[1] as string;
      const row = inMemoryRefreshTokens.find(
        (r) => r.token_hash === tokenHash && r.user_id === userId
      );
      return { rows: row ? [row] : [] };
    }

    // UPDATE revogar refresh token por id
    if (q.startsWith('update refresh_tokens set revoked_at = now() where id')) {
      const id = params[0] as string;
      const row = inMemoryRefreshTokens.find((r) => r.id === id);
      if (row) row.revoked_at = new Date();
      return { rows: [] };
    }

    // UPDATE revogar refresh token por hash (logout)
    if (q.startsWith('update refresh_tokens set revoked_at = now() where token_hash')) {
      const tokenHash = params[0] as string;
      const row = inMemoryRefreshTokens.find(
        (r) => r.token_hash === tokenHash && !r.revoked_at
      );
      if (row) row.revoked_at = new Date();
      return { rows: [] };
    }

    throw new Error(`Query não mapeada no mock: ${sql}`);
  });
}

// ───────────────────────────────────────────────
// Setup / teardown
// ───────────────────────────────────────────────

beforeEach(async () => {
  inMemoryUsers = [];
  inMemoryRefreshTokens = [];
  setupMockPool();

  // Cria usuário de teste no "banco" em memória
  const passwordHash = await hashPassword('Senh@Correta123');
  inMemoryUsers.push({
    id: 'user-test-uuid',
    salon_id: 'salon-test-uuid',
    name: 'Ester',
    email: 'ester@studioester.com.br',
    password_hash: passwordHash,
    role: 'dono',
    active: true,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

// ───────────────────────────────────────────────
// Testes de persistência do login
// ───────────────────────────────────────────────

describe('Persistência do Login — authService.login', () => {
  it('[1] login com credenciais válidas retorna access_token, refresh_token e persiste no banco', async () => {
    const result = await login('ester@studioester.com.br', 'Senh@Correta123', mockPool);

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.expiresIn).toBe(900);
    expect(result.user.email).toBe('ester@studioester.com.br');
    expect(result.user.role).toBe('dono');

    // Verifica que refresh token foi gravado no banco
    const tokenHash = hashToken(result.refreshToken);
    const stored = inMemoryRefreshTokens.find((r) => r.token_hash === tokenHash);
    expect(stored).toBeDefined();
    expect(stored!.revoked_at).toBeNull();
    expect(stored!.user_id).toBe('user-test-uuid');
  });

  it('[2] login com senha errada retorna erro 401 e NÃO persiste token', async () => {
    await expect(
      login('ester@studioester.com.br', 'SenhaErrada!', mockPool)
    ).rejects.toMatchObject({ statusCode: 401 });

    expect(inMemoryRefreshTokens).toHaveLength(0);
  });

  it('[3] login com e-mail inexistente retorna erro 401', async () => {
    await expect(
      login('naoexiste@teste.com', 'qualquerSenha', mockPool)
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('[1b] access_token gerado contém payload correto (sub, role, salonId)', async () => {
    const result = await login('ester@studioester.com.br', 'Senh@Correta123', mockPool);
    const payload = verifyAccessToken(result.accessToken);

    expect(payload.sub).toBe('user-test-uuid');
    expect(payload.role).toBe('dono');
    expect(payload.salonId).toBe('salon-test-uuid');
  });
});

describe('Persistência do Login — authService.refresh', () => {
  it('[4] refresh com token válido retorna novo access_token e rotaciona refresh_token', async () => {
    // Primeiro faz login para obter token
    const loginResult = await login('ester@studioester.com.br', 'Senh@Correta123', mockPool);
    const oldRefreshToken = loginResult.refreshToken;

    const refreshResult = await refresh(oldRefreshToken, mockPool);

    expect(refreshResult.accessToken).toBeDefined();
    expect(refreshResult.refreshToken).toBeDefined();

    // Verifica rotação: token antigo foi revogado no banco
    const oldHash = hashToken(oldRefreshToken);
    const oldStored = inMemoryRefreshTokens.find((r) => r.token_hash === oldHash);
    expect(oldStored!.revoked_at).not.toBeNull();

    // Verifica que novo token foi persistido (hash diferente do antigo)
    const newHash = hashToken(refreshResult.refreshToken);
    expect(newHash).not.toBe(oldHash); // hashes distintos → tokens distintos

    const newStored = inMemoryRefreshTokens.find((r) => r.token_hash === newHash);
    expect(newStored).toBeDefined();
    expect(newStored!.revoked_at).toBeNull();

    // Total de tokens no banco: 1 login + 1 refresh = 2
    expect(inMemoryRefreshTokens).toHaveLength(2);
  });

  it('[5] refresh com token revogado retorna erro 401', async () => {
    const loginResult = await login('ester@studioester.com.br', 'Senh@Correta123', mockPool);
    const tokenHash = hashToken(loginResult.refreshToken);

    // Revoga manualmente
    const stored = inMemoryRefreshTokens.find((r) => r.token_hash === tokenHash);
    stored!.revoked_at = new Date();

    await expect(refresh(loginResult.refreshToken, mockPool)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Refresh token revogado',
    });
  });

  it('[6] refresh com token expirado (JWT) retorna erro 401', async () => {
    import('jsonwebtoken').then(async (jwt) => {
      const expiredToken = jwt.sign(
        { sub: 'user-test-uuid', type: 'refresh' },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: -1 }
      );

      await expect(refresh(expiredToken, mockPool)).rejects.toThrow();
    });
  });
});

describe('Persistência do Login — authService.logout', () => {
  it('[7] logout revoga o refresh_token no banco', async () => {
    const loginResult = await login('ester@studioester.com.br', 'Senh@Correta123', mockPool);
    const tokenHash = hashToken(loginResult.refreshToken);

    // Verifica que token existe e está ativo
    const beforeLogout = inMemoryRefreshTokens.find((r) => r.token_hash === tokenHash);
    expect(beforeLogout!.revoked_at).toBeNull();

    await logout(loginResult.refreshToken, mockPool);

    // Verifica que foi revogado
    const afterLogout = inMemoryRefreshTokens.find((r) => r.token_hash === tokenHash);
    expect(afterLogout!.revoked_at).not.toBeNull();
  });

  it('[7b] logout é idempotente — chamar duas vezes não lança erro', async () => {
    const loginResult = await login('ester@studioester.com.br', 'Senh@Correta123', mockPool);

    await expect(logout(loginResult.refreshToken, mockPool)).resolves.toBeUndefined();
    await expect(logout(loginResult.refreshToken, mockPool)).resolves.toBeUndefined();
  });
});
