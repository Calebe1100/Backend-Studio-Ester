import { hashPassword, comparePassword, generateSecureToken, hashToken } from '../../lib/crypto';

describe('hashPassword / comparePassword', () => {
  it('gera hash diferente da senha original', async () => {
    const password = 'MinhaSenh@123';
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    expect(hash.startsWith('$2b$')).toBe(true);
  });

  it('gera hashes diferentes para a mesma senha (salt aleatório)', async () => {
    const password = 'MinhaSenh@123';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2);
  });

  it('comparePassword retorna true para senha correta', async () => {
    const password = 'MinhaSenh@123';
    const hash = await hashPassword(password);
    const result = await comparePassword(password, hash);
    expect(result).toBe(true);
  });

  it('comparePassword retorna false para senha errada', async () => {
    const hash = await hashPassword('SenhaCorreta@1');
    const result = await comparePassword('SenhaErrada@1', hash);
    expect(result).toBe(false);
  });

  it('comparePassword retorna false para string vazia', async () => {
    const hash = await hashPassword('SenhaCorreta@1');
    const result = await comparePassword('', hash);
    expect(result).toBe(false);
  });
});

describe('generateSecureToken', () => {
  it('retorna token e tokenHash distintos', () => {
    const { token, tokenHash } = generateSecureToken();
    expect(token).not.toBe(tokenHash);
  });

  it('token tem comprimento >= 96 chars (48 bytes em hex)', () => {
    const { token } = generateSecureToken();
    expect(token.length).toBeGreaterThanOrEqual(96);
  });

  it('dois tokens gerados são únicos', () => {
    const a = generateSecureToken();
    const b = generateSecureToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe('hashToken', () => {
  it('retorna o mesmo SHA-256 para o mesmo input', () => {
    const token = 'abc123';
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('retorna hashes diferentes para inputs diferentes', () => {
    expect(hashToken('token_a')).not.toBe(hashToken('token_b'));
  });

  it('hash é hexadecimal de 64 chars (SHA-256)', () => {
    const h = hashToken('qualquer_coisa');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
