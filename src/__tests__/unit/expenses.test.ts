import { monthlyOccurrenceDate, monthlyOccurrences, monthsInRange } from '../../lib/recurrence';
import { expandOccurrences, type ExpenseDTO } from '../../services/expensesService';
import { summarizeExpenses } from '../../services/balanceService';

function fixa(overrides: Partial<ExpenseDTO> = {}): ExpenseDTO {
  return {
    id: 'exp-fixa',
    description: 'Aluguel',
    category: 'aluguel',
    kind: 'fixa',
    amount: 2500,
    dueDate: null,
    dayOfMonth: 5,
    startsOn: '2026-01-01',
    endsOn: null,
    notes: '',
    active: true,
    ...overrides,
  };
}

function isolada(overrides: Partial<ExpenseDTO> = {}): ExpenseDTO {
  return {
    id: 'exp-isolada',
    description: 'Compra de tinturas',
    category: 'produtos',
    kind: 'isolada',
    amount: 340.5,
    dueDate: '2026-09-10',
    dayOfMonth: null,
    startsOn: null,
    endsOn: null,
    notes: '',
    active: true,
    ...overrides,
  };
}

describe('recorrência mensal', () => {
  it('lista os meses tocados pelo intervalo', () => {
    expect(monthsInRange('2026-09-10', '2026-12-05')).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(monthsInRange('2026-12-01', '2027-01-31')).toEqual(['2026-12', '2027-01']);
    expect(monthsInRange('2026-09-30', '2026-09-01')).toEqual([]);
  });

  it('limita o dia ao último dia do mês', () => {
    expect(monthlyOccurrenceDate('2026-09', 5)).toBe('2026-09-05');
    expect(monthlyOccurrenceDate('2026-02', 31)).toBe('2026-02-28');
    expect(monthlyOccurrenceDate('2028-02', 31)).toBe('2028-02-29');
  });

  it('respeita início e fim da vigência', () => {
    expect(
      monthlyOccurrences({
        dayOfMonth: 10,
        startsOn: '2026-03-15',
        endsOn: '2026-06-30',
        from: '2026-01-01',
        to: '2026-12-31',
      }),
    ).toEqual(['2026-04-10', '2026-05-10', '2026-06-10']);
  });
});

describe('expandOccurrences', () => {
  it('gera uma ocorrência por mês para despesas fixas', () => {
    const dates = expandOccurrences([fixa()], '2026-09-01', '2026-11-30').map((item) => item.date);
    expect(dates).toEqual(['2026-09-05', '2026-10-05', '2026-11-05']);
  });

  it('inclui despesas isoladas apenas na data do lançamento', () => {
    expect(expandOccurrences([isolada()], '2026-09-01', '2026-09-30')).toHaveLength(1);
    expect(expandOccurrences([isolada()], '2026-10-01', '2026-10-31')).toHaveLength(0);
  });

  it('ignora despesas inativas', () => {
    expect(
      expandOccurrences([fixa({ active: false }), isolada({ active: false })], '2026-09-01', '2026-09-30'),
    ).toEqual([]);
  });

  it('ordena por data', () => {
    const items = expandOccurrences(
      [isolada({ dueDate: '2026-09-02' }), fixa()],
      '2026-09-01',
      '2026-09-30',
    );
    expect(items.map((item) => item.date)).toEqual(['2026-09-02', '2026-09-05']);
  });
});

describe('summarizeExpenses', () => {
  it('separa fixas de isoladas e agrupa por categoria', () => {
    const summary = summarizeExpenses(
      expandOccurrences([fixa(), isolada()], '2026-09-01', '2026-09-30'),
    );
    expect(summary.total).toBe(2840.5);
    expect(summary.fixed).toBe(2500);
    expect(summary.isolated).toBe(340.5);
    expect(summary.byCategory).toEqual([
      { category: 'aluguel', amount: 2500, count: 1 },
      { category: 'produtos', amount: 340.5, count: 1 },
    ]);
  });
});
