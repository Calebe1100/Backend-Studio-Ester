import { Pool } from 'pg';
import { getPool } from '../db/pool';

export type TotalsSummary = {
  totalAmount: number;
  completedCount: number;
  byProfessional: Array<{ professionalId: string; name: string; amount: number; count: number }>;
  byService: Array<{ serviceId: string; name: string; amount: number; count: number }>;
};

type TotalsRow = {
  total_amount: string | number | null;
  completed_count: string | number;
};

function db(pool?: Pool) {
  return pool ?? getPool();
}

export async function getTotals(
  salonId: string,
  from: string,
  to: string,
  pool?: Pool,
): Promise<TotalsSummary> {
  const summary = await db(pool).query<TotalsRow>(
    `SELECT
       COALESCE(SUM(service_price_snapshot), 0) AS total_amount,
       COUNT(*)::int AS completed_count
     FROM appointments
     WHERE salon_id = $1
       AND status = 'concluido'
       AND DATE(starts_at AT TIME ZONE 'America/Sao_Paulo') >= $2::date
       AND DATE(starts_at AT TIME ZONE 'America/Sao_Paulo') <= $3::date`,
    [salonId, from, to],
  );

  const byPro = await db(pool).query<{
    professional_id: string;
    name: string;
    amount: string | number;
    count: number;
  }>(
    `SELECT a.professional_id, p.name,
            COALESCE(SUM(a.service_price_snapshot), 0) AS amount,
            COUNT(*)::int AS count
     FROM appointments a
     JOIN professionals p ON p.id = a.professional_id
     WHERE a.salon_id = $1
       AND a.status = 'concluido'
       AND DATE(a.starts_at AT TIME ZONE 'America/Sao_Paulo') >= $2::date
       AND DATE(a.starts_at AT TIME ZONE 'America/Sao_Paulo') <= $3::date
     GROUP BY a.professional_id, p.name
     ORDER BY amount DESC`,
    [salonId, from, to],
  );

  const bySvc = await db(pool).query<{
    service_id: string;
    name: string;
    amount: string | number;
    count: number;
  }>(
    `SELECT a.service_id, s.name,
            COALESCE(SUM(a.service_price_snapshot), 0) AS amount,
            COUNT(*)::int AS count
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     WHERE a.salon_id = $1
       AND a.status = 'concluido'
       AND DATE(a.starts_at AT TIME ZONE 'America/Sao_Paulo') >= $2::date
       AND DATE(a.starts_at AT TIME ZONE 'America/Sao_Paulo') <= $3::date
     GROUP BY a.service_id, s.name
     ORDER BY amount DESC`,
    [salonId, from, to],
  );

  return {
    totalAmount: Number(summary.rows[0]?.total_amount ?? 0),
    completedCount: Number(summary.rows[0]?.completed_count ?? 0),
    byProfessional: byPro.rows.map((r) => ({
      professionalId: r.professional_id,
      name: r.name,
      amount: Number(r.amount),
      count: r.count,
    })),
    byService: bySvc.rows.map((r) => ({
      serviceId: r.service_id,
      name: r.name,
      amount: Number(r.amount),
      count: r.count,
    })),
  };
}
