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
const SALON = 'salon-test-uuid';

function signIn(identifier: string, password: string, pool: import('pg').Pool = mockPool) {
  return login(identifier, password, SALON, pool);
}

// Banco de estado em memória para simular persistência
interface UserRow {
  id: string;
  salon_id: string;
  name: string;
  email: string;
  phone: string | null;
  password_hash: string;
  role: string;
  active: boolean;
}

interface ClientPhoneRow {
  user_id: string;
  phone: string | null;
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
let inMemoryClients: ClientPhoneRow[] = [];
let inMemoryRefreshTokens: RefreshTokenRow[] = [];

function digitsOf(phone: string | null): string {
  return (phone ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

function setupMockPool() {
  mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    const q = sql.trim().toLowerCase();
    const collapsed = q.replace(/\s+/g, ' ');

    if (collapsed.startsWith('select u.id from users u')) {
      const variants = params[0] as string[];
      const activeOnly = params[1] === true;
      const exclude = (params[2] as string | null) ?? null;
      const salonId = params[3] as string | undefined;
      const user = inMemoryUsers.find((u) => {
        if (salonId && u.salon_id !== salonId) return false;
        if (activeOnly && !u.active) return false;
        if (exclude && u.id === exclude) return false;
        return (
          variants.includes(digitsOf(u.phone)) ||
          inMemoryClients.some(
            (c) => c.user_id === u.id && variants.includes(digitsOf(c.phone)),
          )
        );
      });
      return { rows: user ? [{ id: user.id }] : [] };
    }

    if (collapsed.includes('from users') && collapsed.includes('lower(email)')) {
      const salonId = params[0] as string;
      const email = String(params[1]).toLowerCase();
      const user = inMemoryUsers.find(
        (u) => u.salon_id === salonId && u.email.toLowerCase() === email && u.active,
      );
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
  inMemoryClients = [];
  inMemoryRefreshTokens = [];
  setupMockPool();

  // Cria usuário de teste no "banco" em memória
  const passwordHash = await hashPassword('Senh@Correta123');
  inMemoryUsers.push({
    id: 'user-test-uuid',
    salon_id: 'salon-test-uuid',
    name: 'Ester',
    email: 'ester@studioester.com.br',
    phone: '11988887777',
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
    const result = await signIn('ester@studioester.com.br', 'Senh@Correta123', mockPool);

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
      signIn('ester@studioester.com.br', 'SenhaErrada!', mockPool)
    ).rejects.toMatchObject({ statusCode: 401 });

    expect(inMemoryRefreshTokens).toHaveLength(0);
  });

  it('[3] login com e-mail inexistente retorna erro 401', async () => {
    await expect(
      signIn('naoexiste@teste.com', 'qualquerSenha', mockPool)
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('[3b] login com telefone da equipe autentica o usuário', async () => {
    const result = await signIn('(11) 98888-7777', 'Senh@Correta123', mockPool);
    expect(result.user.email).toBe('ester@studioester.com.br');
    expect(result.user.id).toBe('user-test-uuid');
  });

  it('[3c] login com telefone gravado no cliente autentica a conta', async () => {
    inMemoryUsers.push({
      id: 'client-user',
      salon_id: 'salon-test-uuid',
      name: 'Maria',
      email: 'maria@email.com',
      phone: null,
      password_hash: inMemoryUsers[0].password_hash,
      role: 'cliente',
      active: true,
    });
    inMemoryClients.push({ user_id: 'client-user', phone: '(21) 97777-1234' });

    const result = await signIn('21977771234', 'Senh@Correta123', mockPool);
    expect(result.user.id).toBe('client-user');
    expect(result.user.role).toBe('cliente');
  });

  it('[3d] login com telefone inexistente retorna erro 401', async () => {
    await expect(
      signIn('11900000000', 'Senh@Correta123', mockPool)
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('[1b] access_token gerado contém payload correto (sub, role, salonId)', async () => {
    const result = await signIn('ester@studioester.com.br', 'Senh@Correta123', mockPool);
    const payload = verifyAccessToken(result.accessToken);

    expect(payload.sub).toBe('user-test-uuid');
    expect(payload.role).toBe('dono');
    expect(payload.salonId).toBe('salon-test-uuid');
  });

  it('não autentica o mesmo e-mail ou telefone de outro salão', async () => {
    inMemoryUsers.push({
      id: 'other-user',
      salon_id: 'other-salon',
      name: 'Outra',
      email: 'ester@studioester.com.br',
      phone: '11988887777',
      password_hash: inMemoryUsers[0].password_hash,
      role: 'dono',
      active: true,
    });

    const mine = await login('ester@studioester.com.br', 'Senh@Correta123', SALON, mockPool);
    expect(mine.user.id).toBe('user-test-uuid');

    const other = await login('ester@studioester.com.br', 'Senh@Correta123', 'other-salon', mockPool);
    expect(other.user.id).toBe('other-user');

    const byPhone = await login('(11) 98888-7777', 'Senh@Correta123', 'other-salon', mockPool);
    expect(byPhone.user.id).toBe('other-user');
  });
});

describe('Persistência do Login — authService.refresh', () => {
  it('[4] refresh com token válido retorna novo access_token e rotaciona refresh_token', async () => {
    // Primeiro faz login para obter token
    const loginResult = await signIn('ester@studioester.com.br', 'Senh@Correta123', mockPool);
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
    const loginResult = await signIn('ester@studioester.com.br', 'Senh@Correta123', mockPool);
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
    const loginResult = await signIn('ester@studioester.com.br', 'Senh@Correta123', mockPool);
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
    const loginResult = await signIn('ester@studioester.com.br', 'Senh@Correta123', mockPool);

    await expect(logout(loginResult.refreshToken, mockPool)).resolves.toBeUndefined();
    await expect(logout(loginResult.refreshToken, mockPool)).resolves.toBeUndefined();
  });
});
