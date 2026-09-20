/**
 * Expansão de recorrências mensais (despesas fixas) em datas YYYY-MM-DD.
 * Funções puras — não dependem de banco nem de fuso: operam sobre strings de data.
 */

/** Último dia do mês (month: 1-12). */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Lista os meses ('YYYY-MM') tocados pelo intervalo, inclusive. */
export function monthsInRange(from: string, to: string): string[] {
  if (from > to) return [];
  const months: string[] = [];
  let [year, month] = from.split('-').map(Number);
  const limit = to.slice(0, 7);
  let current = from.slice(0, 7);
  while (current <= limit) {
    months.push(current);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    current = `${year}-${String(month).padStart(2, '0')}`;
  }
  return months;
}

/**
 * Data da ocorrência no mês, com o dia limitado ao último dia do mês
 * (dia 31 em fevereiro cai no dia 28/29).
 */
export function monthlyOccurrenceDate(month: string, dayOfMonth: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = Math.min(Math.max(dayOfMonth, 1), lastDayOfMonth(year, monthNumber));
  return `${month}-${String(day).padStart(2, '0')}`;
}

/**
 * Datas de uma despesa fixa dentro do intervalo, respeitando a vigência
 * (`startsOn` inclusive, `endsOn` inclusive; `endsOn` nulo = sem fim).
 */
export function monthlyOccurrences(input: {
  dayOfMonth: number;
  startsOn: string;
  endsOn?: string | null;
  from: string;
  to: string;
}): string[] {
  const from = input.startsOn > input.from ? input.startsOn : input.from;
  const to = input.endsOn && input.endsOn < input.to ? input.endsOn : input.to;
  return monthsInRange(from, to)
    .map((month) => monthlyOccurrenceDate(month, input.dayOfMonth))
    .filter((date) => date >= from && date <= to);
}
