import { HttpError } from '../../lib/httpError';
import { createVisitorClient } from '../../services/clientsService';

const query = jest.fn();

jest.mock('../../db/pool', () => ({
  getPool: () => ({ query, connect: jest.fn() }),
}));

describe('createVisitorClient', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('rejeita nome curto sem consultar o banco', async () => {
    await expect(
      createVisitorClient('salon-1', { name: 'A', phone: '11988887777', email: 'ana@exemplo.com' }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejeita telefone inválido', async () => {
    await expect(
      createVisitorClient('salon-1', { name: 'Ana Silva', phone: '123', email: 'ana@exemplo.com' }),
    ).rejects.toThrow(/telefone/);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejeita e-mail ausente', async () => {
    await expect(
      createVisitorClient('salon-1', { name: 'Ana Silva', phone: '11988887777', email: '' }),
    ).rejects.toThrow(/e-mail/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('insere visitante sem buscar cliente pelo e-mail', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'cli-v',
          name: 'Ana Silva',
          phone: '11988887777',
          email: 'ana@exemplo.com',
          notes: null,
          active: true,
          user_id: null,
          kind: 'visitante',
        },
      ],
    });

    const client = await createVisitorClient('salon-1', {
      name: 'Ana Silva',
      phone: '(11) 98888-7777',
      email: '  ANA@exemplo.com ',
    });

    expect(client.kind).toBe('visitante');
    expect(client.userId).toBeNull();
    expect(client.email).toBe('ana@exemplo.com');
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/INSERT INTO clients/i);
    expect(sql).not.toMatch(/SELECT/i);
    expect(query.mock.calls[0][1][6] ?? query.mock.calls[0][1]).toBeDefined();
    expect(query.mock.calls[0][1]).toEqual([
      'salon-1',
      'Ana Silva',
      '11988887777',
      'ana@exemplo.com',
      null,
    ]);
  });
});
