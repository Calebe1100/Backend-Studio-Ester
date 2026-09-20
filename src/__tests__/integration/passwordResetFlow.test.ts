/**
 * Fluxo de recuperação de senha por código no celular.
 * Usa um banco em memória (mock do pool) — cobre a lógica de limites,
 * tentativas e expiração sem depender de Postgres.
 */
import {
  createPasswordResetCode,
  verifyPasswordResetCode,
  resetPassword,
} from '../../services/authService';
import { comparePassword, hashPassword, hashToken } from '../../lib/crypto';
import { OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR } from '../../lib/otp';

type UserRow = { id: string; phone: string | null; active: boolean; created_at: Date };
type ClientRow = { user_id: string; phone: string | null };
type CodeRow = {
  id: string;
  user_id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
};
type ResetTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
};
type RefreshTokenRow = { id: string; user_id: string; revoked_at: Date | null };

let users: UserRow[] = [];
let clients: ClientRow[] = [];
let codes: CodeRow[] = [];
let resetTokens: ResetTokenRow[] = [];
let refreshTokens: RefreshTokenRow[] = [];
let passwordHashes: Record<string, string> = {};

const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as unknown as import('pg').Pool;

/** Reproduz o regexp_replace usado na consulta por telefone. */
function digitsOf(phone: string | null): string {
  return (phone ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

function setupMockPool() {
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (q.startsWith('select u.id from users u')) {
      const variants = params[0] as string[];
      const found = users
        .filter((u) => u.active)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .find(
          (u) =>
            variants.includes(digitsOf(u.phone)) ||
            clients.some((c) => c.user_id === u.id && variants.includes(digitsOf(c.phone))),
        );
      return { rows: found ? [{ id: found.id }] : [] };
    }

    if (q.startsWith('select count(*)::int as count from password_reset_codes')) {
      const userId = params[0] as string;
      const cutoff = Date.now() - 60 * 60 * 1000;
      const count = codes.filter(
        (c) => c.user_id === userId && c.created_at.getTime() > cutoff,
      ).length;
      return { rows: [{ count }] };
    }

    if (q.startsWith('update password_reset_codes set used_at = now() where user_id')) {
      const userId = params[0] as string;
      codes.filter((c) => c.user_id === userId && !c.used_at).forEach((c) => (c.used_at = new Date()));
      return { rows: [] };
    }

    if (q.startsWith('update password_reset_codes set used_at = now() where id')) {
      const id = params[0] as string;
      const row = codes.find((c) => c.id === id);
      if (row) row.used_at = new Date();
      return { rows: [] };
    }

    if (q.startsWith('insert into password_reset_codes')) {
      codes.push({
        id: `code-${codes.length + 1}`,
        user_id: params[0] as string,
        code_hash: params[1] as string,
        attempts: 0,
        expires_at: params[2] as Date,
        used_at: null,
        created_at: new Date(),
      });
      return { rows: [] };
    }

    if (q.startsWith('select id, user_id, code_hash, attempts, expires_at')) {
      const userId = params[0] as string;
      const row = codes
        .filter((c) => c.user_id === userId && !c.used_at)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
      return { rows: row ? [row] : [] };
    }

    if (q.startsWith('update password_reset_codes set attempts')) {
      const row = codes.find((c) => c.id === params[0]);
      if (row) row.attempts = params[1] as number;
      return { rows: [] };
    }

    if (q.startsWith('update password_reset_tokens set used_at = now() where user_id')) {
      const userId = params[0] as string;
      resetTokens
        .filter((t) => t.user_id === userId && !t.used_at)
        .forEach((t) => (t.used_at = new Date()));
      return { rows: [] };
    }

    if (q.startsWith('update password_reset_tokens set used_at = now() where id')) {
      const row = resetTokens.find((t) => t.id === params[0]);
      if (row) row.used_at = new Date();
      return { rows: [] };
    }

    if (q.startsWith('insert into password_reset_tokens')) {
      resetTokens.push({
        id: `token-${resetTokens.length + 1}`,
        user_id: params[0] as string,
        token_hash: params[1] as string,
        expires_at: params[2] as Date,
        used_at: null,
      });
      return { rows: [] };
    }

    if (q.startsWith('select id, user_id, expires_at, used_at from password_reset_tokens')) {
      const row = resetTokens.find((t) => t.token_hash === params[0]);
      return { rows: row ? [row] : [] };
    }

    if (q.startsWith('update users set password_hash')) {
      passwordHashes[params[0] as string] = params[1] as string;
      return { rows: [] };
    }

    if (q.startsWith('update refresh_tokens set revoked_at = now() where user_id')) {
      const userId = params[0] as string;
      refreshTokens
        .filter((r) => r.user_id === userId && !r.revoked_at)
        .forEach((r) => (r.revoked_at = new Date()));
      return { rows: [] };
    }

    throw new Error(`Query não mapeada no mock: ${sql}`);
  });
}

beforeEach(() => {
  users = [
    { id: 'staff-1', phone: '11988887777', active: true, created_at: new Date('2026-01-01') },
    { id: 'client-1', phone: null, active: true, created_at: new Date('2026-02-01') },
    { id: 'inativo-1', phone: '11955554444', active: false, created_at: new Date('2026-03-01') },
  ];
  // Cliente guarda o telefone na tabela clients, com máscara
  clients = [{ user_id: 'client-1', phone: '(21) 97777-1234' }];
  codes = [];
  resetTokens = [];
  refreshTokens = [{ id: 'rt-1', user_id: 'staff-1', revoked_at: null }];
  passwordHashes = {};
  setupMockPool();
});

describe('createPasswordResetCode', () => {
  it('gera código de 6 dígitos para o telefone da equipe', async () => {
    const result = await createPasswordResetCode('(11) 98888-7777', mockPool);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe('staff-1');
    expect(result!.code).toMatch(/^\d{6}$/);
    // Só o hash é persistido
    expect(codes).toHaveLength(1);
    expect(codes[0].code_hash).not.toBe(result!.code);
  });

  it('encontra cliente pelo telefone salvo com máscara em clients', async () => {
    const result = await createPasswordResetCode('21977771234', mockPool);
    expect(result!.userId).toBe('client-1');
  });

  it('aceita o número digitado com DDI', async () => {
    const result = await createPasswordResetCode('+55 11 98888-7777', mockPool);
    expect(result!.userId).toBe('staff-1');
  });

  it('retorna null para telefone não cadastrado, inválido ou de usuário inativo', async () => {
    expect(await createPasswordResetCode('11900000000', mockPool)).toBeNull();
    expect(await createPasswordResetCode('123', mockPool)).toBeNull();
    expect(await createPasswordResetCode('11955554444', mockPool)).toBeNull();
  });

  it('invalida o código anterior a cada novo pedido', async () => {
    const first = await createPasswordResetCode('11988887777', mockPool);
    await createPasswordResetCode('11988887777', mockPool);

    expect(codes[0].used_at).not.toBeNull();
    await expect(
      verifyPasswordResetCode('11988887777', first!.code, mockPool),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('para de enviar após o limite por hora', async () => {
    for (let i = 0; i < OTP_MAX_PER_HOUR; i++) {
      expect(await createPasswordResetCode('11988887777', mockPool)).not.toBeNull();
    }
    expect(await createPasswordResetCode('11988887777', mockPool)).toBeNull();
  });
});

describe('verifyPasswordResetCode', () => {
  it('devolve token de redefinição para o código correto', async () => {
    const created = await createPasswordResetCode('11988887777', mockPool);
    const result = await verifyPasswordResetCode('11988887777', created!.code, mockPool);

    expect(result.resetToken).toBeDefined();
    expect(result.expiresIn).toBe(15 * 60);
    expect(resetTokens).toHaveLength(1);
    expect(resetTokens[0].token_hash).toBe(hashToken(result.resetToken));
    // Código é de uso único
    expect(codes[0].used_at).not.toBeNull();
  });

  it('rejeita código errado e conta a tentativa', async () => {
    const created = await createPasswordResetCode('11988887777', mockPool);
    const wrong = created!.code === '000000' ? '111111' : '000000';

    await expect(verifyPasswordResetCode('11988887777', wrong, mockPool)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(codes[0].attempts).toBe(1);
  });

  it('invalida o código após muitas tentativas erradas (429)', async () => {
    const created = await createPasswordResetCode('11988887777', mockPool);
    const wrong = created!.code === '000000' ? '111111' : '000000';

    for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) {
      await expect(verifyPasswordResetCode('11988887777', wrong, mockPool)).rejects.toMatchObject({
        statusCode: 400,
      });
    }
    await expect(verifyPasswordResetCode('11988887777', wrong, mockPool)).rejects.toMatchObject({
      statusCode: 429,
    });

    // Nem o código correto vale mais
    await expect(
      verifyPasswordResetCode('11988887777', created!.code, mockPool),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejeita código expirado', async () => {
    const created = await createPasswordResetCode('11988887777', mockPool);
    codes[0].expires_at = new Date(Date.now() - 1000);

    await expect(
      verifyPasswordResetCode('11988887777', created!.code, mockPool),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejeita código com formato inválido sem tocar no banco', async () => {
    await createPasswordResetCode('11988887777', mockPool);
    await expect(verifyPasswordResetCode('11988887777', '123', mockPool)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(codes[0].attempts).toBe(0);
  });
});

describe('fluxo completo até a nova senha', () => {
  it('troca a senha, consome o token e revoga as sessões abertas', async () => {
    passwordHashes['staff-1'] = await hashPassword('SenhaAntiga123');

    const created = await createPasswordResetCode('(11) 98888-7777', mockPool);
    const { resetToken } = await verifyPasswordResetCode('11988887777', created!.code, mockPool);
    await resetPassword(resetToken, 'NovaSenha123', mockPool);

    expect(await comparePassword('NovaSenha123', passwordHashes['staff-1'])).toBe(true);
    expect(resetTokens[0].used_at).not.toBeNull();
    expect(refreshTokens[0].revoked_at).not.toBeNull();

    // Token de redefinição não pode ser reutilizado
    await expect(resetPassword(resetToken, 'OutraSenha123', mockPool)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('recusa senha curta', async () => {
    const created = await createPasswordResetCode('11988887777', mockPool);
    const { resetToken } = await verifyPasswordResetCode('11988887777', created!.code, mockPool);

    await expect(resetPassword(resetToken, '123', mockPool)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
