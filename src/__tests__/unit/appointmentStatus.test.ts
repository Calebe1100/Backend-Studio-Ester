import { HttpError } from '../../lib/httpError';
import { assertClientStatusChange } from '../../services/appointmentsService';

const startsAt = new Date('2026-09-26T15:00:00-03:00');

describe('assertClientStatusChange', () => {
  it('permite confirmar um horário agendado', () => {
    expect(() =>
      assertClientStatusChange('agendado', 'confirmado', startsAt, new Date('2026-09-26T10:00:00-03:00')),
    ).not.toThrow();
  });

  it('permite cancelar com duas horas ou mais de antecedência', () => {
    expect(() =>
      assertClientStatusChange('confirmado', 'cancelado', startsAt, new Date('2026-09-26T12:00:00-03:00')),
    ).not.toThrow();
    expect(() =>
      assertClientStatusChange('agendado', 'cancelado', startsAt, new Date('2026-09-26T13:00:00-03:00')),
    ).not.toThrow();
  });

  it('recusa cancelamento com menos de duas horas', () => {
    expect(() =>
      assertClientStatusChange('agendado', 'cancelado', startsAt, new Date('2026-09-26T13:01:00-03:00')),
    ).toThrow(HttpError);

    try {
      assertClientStatusChange('agendado', 'cancelado', startsAt, new Date('2026-09-26T13:01:00-03:00'));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(400);
      expect((err as HttpError).message).toMatch(/2 horas/);
    }
  });

  it('recusa status operacionais do salão', () => {
    const now = new Date('2026-09-26T10:00:00-03:00');
    expect(() => assertClientStatusChange('agendado', 'concluido', startsAt, now)).toThrow(
      /confirmar ou cancelar/,
    );
    expect(() => assertClientStatusChange('agendado', 'em_atendimento', startsAt, now)).toThrow(
      HttpError,
    );
    expect(() => assertClientStatusChange('confirmado', 'nao_compareceu', startsAt, now)).toThrow(
      HttpError,
    );
  });

  it('recusa alterar um horário já encerrado', () => {
    expect(() =>
      assertClientStatusChange(
        'cancelado',
        'confirmado',
        startsAt,
        new Date('2026-09-26T10:00:00-03:00'),
      ),
    ).toThrow(HttpError);
  });
});
