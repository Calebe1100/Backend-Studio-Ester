import { Pool } from 'pg';
import {
  ExpenseCategory,
  ExpenseOccurrence,
  listExpenseOccurrences,
} from './expensesService';
import { getTotals, TotalsSummary } from './totalsService';

export type BalanceSummary = {
  from: string;
  to: string;
  revenue: TotalsSummary;
  expenses: {
    total: number;
    fixed: number;
    isolated: number;
    byCategory: Array<{ category: ExpenseCategory; amount: number; count: number }>;
    items: ExpenseOccurrence[];
  };
  /** Receita dos atendimentos concluídos − despesas do período. */
  result: number;
  /** Resultado sobre a receita, em %. 0 quando não houve receita. */
  marginPercent: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarizeExpenses(occurrences: ExpenseOccurrence[]) {
  const byCategory = new Map<ExpenseCategory, { category: ExpenseCategory; amount: number; count: number }>();
  let total = 0;
  let fixed = 0;

  for (const item of occurrences) {
    total += item.amount;
    if (item.kind === 'fixa') fixed += item.amount;
    const current = byCategory.get(item.category) ?? {
      category: item.category,
      amount: 0,
      count: 0,
    };
    current.amount += item.amount;
    current.count += 1;
    byCategory.set(item.category, current);
  }

  return {
    total: round2(total),
    fixed: round2(fixed),
    isolated: round2(total - fixed),
    byCategory: [...byCategory.values()]
      .map((row) => ({ ...row, amount: round2(row.amount) }))
      .sort((a, b) => b.amount - a.amount),
    items: occurrences,
  };
}

/** Balanço do período: receita dos concluídos, despesas materializadas e resultado. */
export async function getBalance(
  salonId: string,
  from: string,
  to: string,
  pool?: Pool,
): Promise<BalanceSummary> {
  const [revenue, occurrences] = await Promise.all([
    getTotals(salonId, from, to, pool),
    listExpenseOccurrences(salonId, from, to, pool),
  ]);

  const expenses = summarizeExpenses(occurrences);
  const result = round2(revenue.totalAmount - expenses.total);

  return {
    from,
    to,
    revenue,
    expenses,
    result,
    marginPercent: revenue.totalAmount > 0 ? round2((result / revenue.totalAmount) * 100) : 0,
  };
}
