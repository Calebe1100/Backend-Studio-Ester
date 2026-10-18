import { Pool } from 'pg';
import { findUserIdByPhone } from '../../lib/phoneAccount';
import { registerClientAccess } from '../../services/clientsService';
import { getAppointment, listAppointments } from '../../services/appointmentsService';
import { dateInZone, zonedLocalToDate } from '../../lib/time';
import { originAllowed } from '../../lib/corsOrigins';

describe('isolamento de telefone', () => {
  it('restringe a busca ao salão informado', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await findUserIdByPhone(pool, '11988887777', { salonId: 'salon-b' });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('u.salon_id = $4');
    expect(params[3]).toBe('salon-b');
  });
});

describe('cadastro público', () => {
  it('cria a conta no salão do slug e não no primeiro registro', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO users')) return { rows: [{ id: 'user-b' }] };
      if (sql.includes('INSERT INTO clients')) {
        return {
          rows: [{
            id: 'client-b',
            name: 'Ana Silva',
            phone: '11988887777',
            email: 'ana@exemplo.com',
            notes: null,
            active: true,
            user_id: 'user-b',
            kind: 'cadastrado',
          }],
        };
      }
      return { rows: [] };
    });
    const pool = {
      query,
      connect: async () => ({ query, release: jest.fn() }),
    } as unknown as Pool;

    await registerClientAccess(
      {
        name: 'Ana Silva',
        phone: '11988887777',
        email: 'ana@exemplo.com',
        password: 'senha1234',
      },
      'salon-b',
      pool,
    );

    expect(calls.some((call) => call.sql.includes('ORDER BY created_at'))).toBe(false);
    const insert = calls.find((call) => call.sql.includes('INSERT INTO users'));
    expect(insert?.params?.[0]).toBe('salon-b');
    const lookup = calls.find((call) => call.sql.includes('lower(email)'));
    expect(lookup?.params).toEqual(['salon-b', 'ana@exemplo.com']);
  });
});

describe('agenda de outro salão', () => {
  it('filtra o dia pelo fuso gravado no salão', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM salons')) {
        return {
          rows: [{
            id: 'salon-b',
            name: 'Salão B',
            slug: 'salao-b',
            phone: null,
            address: null,
            timezone: 'America/Manaus',
            currency: 'BRL',
            locale: 'pt-BR',
            contact_email: null,
            brand_color: '#4b5563',
            frontend_origins: [],
            client_cancel_lead_minutes: 120,
            active: true,
          }],
        };
      }
      return { rows: [] };
    });
    const pool = { query } as unknown as Pool;

    await listAppointments('salon-b', { date: '2026-01-15' }, pool);

    const agenda = query.mock.calls.map((call) => String(call[0])).find((sql) => sql.includes('FROM appointments'));
    expect(agenda).toContain('SELECT timezone FROM salons');
    expect(agenda).not.toContain("AT TIME ZONE 'America/Sao_Paulo'");
  });

  it('não devolve agendamento de outro salão', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await expect(getAppointment('salon-b', 'appt-a', pool)).resolves.toBeNull();

    const read = query.mock.calls.find((call) => String(call[0]).includes('FROM appointments'));
    expect(read?.[1]).toEqual(['appt-a', 'salon-b']);
  });
});

describe('dia civil do fuso', () => {
  it('23:30 em Manaus continua no mesmo dia e vira o dia seguinte em São Paulo', () => {
    const instant = zonedLocalToDate('2026-01-15', '23:30', 'America/Manaus');
    expect(dateInZone(instant, 'America/Manaus')).toBe('2026-01-15');
    expect(dateInZone(instant, 'America/Sao_Paulo')).toBe('2026-01-16');
  });
});

describe('origens de frontend', () => {
  const tenantOrigins = ['https://app-studio-ester-rodrigues.vercel.app'];

  it('aceita o host gravado e o preview do mesmo projeto', () => {
    expect(originAllowed('https://app-studio-ester-rodrigues.vercel.app', tenantOrigins, [])).toBe(true);
    expect(
      originAllowed(
        'https://app-studio-ester-rodrigues-git-main-team.vercel.app',
        tenantOrigins,
        [],
      ),
    ).toBe(true);
  });

  it('recusa um app de outro projeto', () => {
    expect(originAllowed('https://outro-salao.vercel.app', tenantOrigins, [])).toBe(false);
  });
});
