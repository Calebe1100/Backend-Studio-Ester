import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';
import { pgTimeToHHMM, toMinutes } from '../lib/time';

export type ProfessionalDTO = {
  id: string;
  name: string;
  workStart: string;
  workEnd: string;
  active: boolean;
  serviceIds: string[];
  userId: string | null;
};

type ProfessionalRow = {
  id: string;
  name: string;
  work_start: string | Date;
  work_end: string | Date;
  active: boolean;
  user_id: string | null;
};

function db(pool?: Pool) {
  return pool ?? getPool();
}

function mapBase(row: ProfessionalRow, serviceIds: string[] = []): ProfessionalDTO {
  return {
    id: row.id,
    name: row.name,
    workStart: pgTimeToHHMM(row.work_start),
    workEnd: pgTimeToHHMM(row.work_end),
    active: row.active,
    serviceIds,
    userId: row.user_id,
  };
}

async function loadServiceIds(professionalIds: string[], pool?: Pool): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (professionalIds.length === 0) return map;
  const result = await db(pool).query<{ professional_id: string; service_id: string }>(
    `SELECT professional_id, service_id
     FROM professional_services
     WHERE professional_id = ANY($1::uuid[])`,
    [professionalIds],
  );
  for (const row of result.rows) {
    const list = map.get(row.professional_id) ?? [];
    list.push(row.service_id);
    map.set(row.professional_id, list);
  }
  return map;
}

export async function listProfessionals(salonId: string, pool?: Pool): Promise<ProfessionalDTO[]> {
  const result = await db(pool).query<ProfessionalRow>(
    `SELECT id, name, work_start, work_end, active, user_id
     FROM professionals
     WHERE salon_id = $1
     ORDER BY active DESC, name ASC`,
    [salonId],
  );
  const serviceMap = await loadServiceIds(
    result.rows.map((r) => r.id),
    pool,
  );
  return result.rows.map((row) => mapBase(row, serviceMap.get(row.id) ?? []));
}

async function replaceServices(
  professionalId: string,
  serviceIds: string[],
  salonId: string,
  pool?: Pool,
): Promise<void> {
  const unique = [...new Set(serviceIds)];
  if (unique.length > 0) {
    const check = await db(pool).query<{ id: string }>(
      `SELECT id FROM services
       WHERE salon_id = $1 AND active = TRUE AND id = ANY($2::uuid[])`,
      [salonId, unique],
    );
    if (check.rows.length !== unique.length) {
      throw new HttpError(400, 'Um ou mais serviços são inválidos ou inativos.');
    }
  }

  await db(pool).query(`DELETE FROM professional_services WHERE professional_id = $1`, [
    professionalId,
  ]);
  for (const serviceId of unique) {
    await db(pool).query(
      `INSERT INTO professional_services (professional_id, service_id) VALUES ($1, $2)`,
      [professionalId, serviceId],
    );
  }
}

function validateWorkHours(workStart: string, workEnd: string) {
  if (!/^\d{2}:\d{2}$/.test(workStart) || !/^\d{2}:\d{2}$/.test(workEnd)) {
    throw new HttpError(400, 'Horário de trabalho inválido.');
  }
  if (toMinutes(workEnd) <= toMinutes(workStart)) {
    throw new HttpError(400, 'O fim do expediente deve ser depois do início.');
  }
}

export async function createProfessional(
  salonId: string,
  input: {
    name: string;
    workStart: string;
    workEnd: string;
    serviceIds?: string[];
    userId?: string | null;
  },
  pool?: Pool,
): Promise<ProfessionalDTO> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do profissional.');
  validateWorkHours(input.workStart, input.workEnd);

  const result = await db(pool).query<ProfessionalRow>(
    `INSERT INTO professionals (salon_id, name, work_start, work_end, user_id)
     VALUES ($1, $2, $3::time, $4::time, $5)
     RETURNING id, name, work_start, work_end, active, user_id`,
    [salonId, name, input.workStart, input.workEnd, input.userId ?? null],
  );
  const row = result.rows[0];
  await replaceServices(row.id, input.serviceIds ?? [], salonId, pool);
  return mapBase(row, input.serviceIds ?? []);
}

export async function updateProfessional(
  salonId: string,
  id: string,
  input: {
    name: string;
    workStart: string;
    workEnd: string;
    serviceIds?: string[];
    userId?: string | null;
  },
  pool?: Pool,
): Promise<ProfessionalDTO> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do profissional.');
  validateWorkHours(input.workStart, input.workEnd);

  const result = await db(pool).query<ProfessionalRow>(
    `UPDATE professionals
     SET name = $3, work_start = $4::time, work_end = $5::time, user_id = $6
     WHERE id = $1 AND salon_id = $2
     RETURNING id, name, work_start, work_end, active, user_id`,
    [id, salonId, name, input.workStart, input.workEnd, input.userId ?? null],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Profissional não encontrado.');
  if (input.serviceIds) {
    await replaceServices(id, input.serviceIds, salonId, pool);
  }
  const serviceMap = await loadServiceIds([id], pool);
  return mapBase(result.rows[0], serviceMap.get(id) ?? []);
}

export async function setProfessionalActive(
  salonId: string,
  id: string,
  active: boolean,
  pool?: Pool,
): Promise<ProfessionalDTO> {
  const result = await db(pool).query<ProfessionalRow>(
    `UPDATE professionals SET active = $3
     WHERE id = $1 AND salon_id = $2
     RETURNING id, name, work_start, work_end, active, user_id`,
    [id, salonId, active],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Profissional não encontrado.');
  const serviceMap = await loadServiceIds([id], pool);
  return mapBase(result.rows[0], serviceMap.get(id) ?? []);
}

export async function getActiveProfessional(
  salonId: string,
  id: string,
  pool?: Pool,
): Promise<ProfessionalDTO> {
  const result = await db(pool).query<ProfessionalRow>(
    `SELECT id, name, work_start, work_end, active, user_id
     FROM professionals
     WHERE id = $1 AND salon_id = $2 AND active = TRUE`,
    [id, salonId],
  );
  if (!result.rows[0]) throw new HttpError(400, 'Profissional inválido ou inativo.');
  const serviceMap = await loadServiceIds([id], pool);
  return mapBase(result.rows[0], serviceMap.get(id) ?? []);
}
