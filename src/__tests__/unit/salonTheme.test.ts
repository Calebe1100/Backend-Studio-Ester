import { Pool } from 'pg';
import { HttpError } from '../../lib/httpError';
import { parseSalonTheme, provisionSalon } from '../../services/salonsService';

describe('parseSalonTheme', () => {
  it('usa básico quando o tema não vem', () => {
    expect(parseSalonTheme(undefined)).toBe('basico');
    expect(parseSalonTheme('')).toBe('basico');
    expect(parseSalonTheme('  ')).toBe('basico');
  });

  it('aceita os três temas e ignora acento e caixa', () => {
    expect(parseSalonTheme('classico')).toBe('classico');
    expect(parseSalonTheme('Moderno')).toBe('moderno');
    expect(parseSalonTheme('Básico')).toBe('basico');
  });

  it('rejeita tema fora da lista', () => {
    expect(() => parseSalonTheme('rosa')).toThrow(HttpError);
    try {
      parseSalonTheme('rosa');
    } catch (err) {
      expect((err as HttpError).statusCode).toBe(400);
    }
  });

  it('exige tema quando a chamada pede', () => {
    expect(() => parseSalonTheme(undefined, { required: true })).toThrow(/tema/i);
  });
});

describe('provisionSalon', () => {
  it('recusa tema inválido antes de abrir transação', async () => {
    const connect = jest.fn();
    const pool = { connect } as unknown as Pool;

    await expect(
      provisionSalon(
        {
          name: 'Salão Novo',
          slug: 'salao-novo',
          theme: 'rosa',
          owner: {
            name: 'Ana',
            email: 'ana@exemplo.com',
            password: 'senha1234',
            phone: '11988887777',
          },
        },
        pool,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(connect).not.toHaveBeenCalled();
  });
});
