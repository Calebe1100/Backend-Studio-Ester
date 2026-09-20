import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';
import { monthlyOccurrences } from '../lib/recurrence';

export const EXPENSE_CATEGORIES = [
  'aluguel',
  'pessoal',
  'produtos',
  'utilidades',
  'impostos',
  'marketing',
  'manutencao',
  'outros',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpenseKind = 'fixa' | 'isolada';

export type ExpenseDTO = {
  id: string;
  description: string;
  category: ExpenseCategory;
  kind: ExpenseKind;
  amount: number;
  /** Despesa isolada: data do lançamento. */
  dueDate: string | null;
  /** Despesa fixa: dia de vencimento (1-31) e vigência. */
  dayOfMonth: number | null;
  startsOn: string | null;
  endsOn: string | null;
  notes: string;
  active: boolean;
};

/** Uma despesa materializada em uma data — fixas geram uma por mês de vigência. */
export type ExpenseOccurrence = {
  expenseId: string;
  description: string;
  category: ExpenseCategory;
  kind: ExpenseKind;
  amount: number;
  date: string;
};

export type ExpenseInput = {
  description?: string;
  category?: string;
  kind?: string;
  amount?: number;
  dueDate?: string | null;
  dayOfMonth?: number | null;
  startsOn?: string | null;
  endsOn?: string | null;
  notes?: string | null;
};

type ExpenseRow = {
  id: string;
  description: string;
  category: ExpenseCategory;
  kind: ExpenseKind;
  amount: string | number;
  due_date: string | null;
  day_of_month: number | null;
  starts_on: string | null;
  ends_on: string | null;
  notes: string | null;
  active: boolean;
};

const RETURNING = `id, description, category, kind, amount,
            to_char(due_date, 'YYYY-MM-DD') AS due_date,
            day_of_month,
            to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
            notes, active`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function db(pool?: Pool) {
  return pool ?? getPool();
}

function mapExpense(row: ExpenseRow): ExpenseDTO {
  return {
    id: row.id,
    description: row.description,
    category: row.category,
    kind: row.kind,
    amount: Number(row.amount),
    dueDate: row.due_date,
    dayOfMonth: row.day_of_month,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    notes: row.notes ?? '',
    active: row.active,
  };
}

type NormalizedExpense = {
  description: string;
  category: ExpenseCategory;
  kind: ExpenseKind;
  amount: number;
  dueDate: string | null;
  dayOfMonth: number | null;
  startsOn: string | null;
  endsOn: string | null;
  notes: string | null;
};

function normalize(input: ExpenseInput): NormalizedExpense {
  const description = input.description?.trim() ?? '';
  if (description.length < 2) throw new HttpError(400, 'Informe a descrição da despesa.');

  const category = (input.category ?? 'outros') as ExpenseCategory;
  if (!EXPENSE_CATEGORIES.includes(category)) throw new HttpError(400, 'Categoria inválida.');

  const kind = input.kind as ExpenseKind;
  if (kind !== 'fixa' && kind !== 'isolada') {
    throw new HttpError(400, 'Tipo de despesa inválido (use fixa ou isolada).');
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new HttpError(400, 'O valor da despesa não pode ser negativo.');
  }

  const notes = input.notes?.trim() || null;

  if (kind === 'isolada') {
    const dueDate = input.dueDate ?? '';
    if (!ISO_DATE.test(dueDate)) throw new HttpError(400, 'Informe a data da despesa (YYYY-MM-DD).');
    return {
      description,
      category,
      kind,
      amount,
      dueDate,
      dayOfMonth: null,
      startsOn: null,
      endsOn: null,
      notes,
    };
  }

  const dayOfMonth = Number(input.dayOfMonth);
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new HttpError(400, 'Informe o dia de vencimento entre 1 e 31.');
  }
  const startsOn = input.startsOn ?? '';
  if (!ISO_DATE.test(startsOn)) throw new HttpError(400, 'Informe o início da vigência (YYYY-MM-DD).');
  const endsOn = input.endsOn || null;
  if (endsOn && !ISO_DATE.test(endsOn)) {
    throw new HttpError(400, 'Fim da vigência inválido (YYYY-MM-DD).');
  }
  if (endsOn && endsOn < startsOn) {
    throw new HttpError(400, 'O fim da vigência não pode ser antes do início.');
  }

  return {
    description,
    category,
    kind,
    amount,
    dueDate: null,
    dayOfMonth,
    startsOn,
    endsOn,
    notes,
  };
}

export async function listExpenses(salonId: string, pool?: Pool): Promise<ExpenseDTO[]> {
  const result = await db(pool).query<ExpenseRow>(
    `SELECT ${RETURNING}
     FROM expenses
     WHERE salon_id = $1
     ORDER BY active DESC, kind ASC, COALESCE(due_date, starts_on) DESC, description ASC`,
    [salonId],
  );
  return result.rows.map(mapExpense);
}

export async function createExpense(
  salonId: string,
  input: ExpenseInput,
  pool?: Pool,
): Promise<ExpenseDTO> {
  const data = normalize(input);
  const result = await db(pool).query<ExpenseRow>(
    `INSERT INTO expenses
       (salon_id, description, category, kind, amount, due_date, day_of_month, starts_on, ends_on, notes)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8::date, $9::date, $10)
     RETURNING ${RETURNING}`,
    [
      salonId,
      data.description,
      data.category,
      data.kind,
      data.amount,
      data.dueDate,
      data.dayOfMonth,
      data.startsOn,
      data.endsOn,
      data.notes,
    ],
  );
  return mapExpense(result.rows[0]);
}

export async function updateExpense(
  salonId: string,
  id: string,
  input: ExpenseInput,
  pool?: Pool,
): Promise<ExpenseDTO> {
  const data = normalize(input);
  const result = await db(pool).query<ExpenseRow>(
    `UPDATE expenses
     SET description = $3, category = $4, kind = $5, amount = $6,
         due_date = $7::date, day_of_month = $8, starts_on = $9::date, ends_on = $10::date,
         notes = $11, updated_at = NOW()
     WHERE id = $1 AND salon_id = $2
     RETURNING ${RETURNING}`,
    [
      id,
      salonId,
      data.description,
      data.category,
      data.kind,
      data.amount,
      data.dueDate,
      data.dayOfMonth,
      data.startsOn,
      data.endsOn,
      data.notes,
    ],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Despesa não encontrada.');
  return mapExpense(result.rows[0]);
}

export async function setExpenseActive(
  salonId: string,
  id: string,
  active: boolean,
  pool?: Pool,
): Promise<ExpenseDTO> {
  const result = await db(pool).query<ExpenseRow>(
    `UPDATE expenses SET active = $3, updated_at = NOW()
     WHERE id = $1 AND salon_id = $2
     RETURNING ${RETURNING}`,
    [id, salonId, active],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Despesa não encontrada.');
  return mapExpense(result.rows[0]);
}

/** Materializa as despesas ativas no intervalo: isoladas na data e fixas mês a mês. */
export function expandOccurrences(
  expenses: ExpenseDTO[],
  from: string,
  to: string,
): ExpenseOccurrence[] {
  const occurrences: ExpenseOccurrence[] = [];

  for (const expense of expenses) {
    if (!expense.active) continue;
    const base = {
      expenseId: expense.id,
      description: expense.description,
      category: expense.category,
      kind: expense.kind,
      amount: expense.amount,
    };

    if (expense.kind === 'isolada') {
      if (expense.dueDate && expense.dueDate >= from && expense.dueDate <= to) {
        occurrences.push({ ...base, date: expense.dueDate });
      }
      continue;
    }

    if (!expense.dayOfMonth || !expense.startsOn) continue;
    for (const date of monthlyOccurrences({
      dayOfMonth: expense.dayOfMonth,
      startsOn: expense.startsOn,
      endsOn: expense.endsOn,
      from,
      to,
    })) {
      occurrences.push({ ...base, date });
    }
  }

  return occurrences.sort((a, b) => a.date.localeCompare(b.date));
}

export async function listExpenseOccurrences(
  salonId: string,
  from: string,
  to: string,
  pool?: Pool,
): Promise<ExpenseOccurrence[]> {
  const expenses = await listExpenses(salonId, pool);
  return expandOccurrences(expenses, from, to);
}
