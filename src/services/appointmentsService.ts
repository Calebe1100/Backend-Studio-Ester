import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';
import {
  addMinutesHHMM,
  dateInSP,
  spLocalToDate,
  timeInSP,
  toMinutes,
} from '../lib/time';
import { getActiveProfessional } from './professionalsService';
import { getActiveService } from './servicesService';

export const APPOINTMENT_STATUSES = [
  'agendado',
  'confirmado',
  'em_atendimento',
  'concluido',
  'cancelado',
  'nao_compareceu',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export type AppointmentDTO = {
  id: string;
  clientId: string;
  professionalId: string;
  serviceId: string;
  date: string;
  start: string;
  end: string;
  status: AppointmentStatus;
  notes: string;
  servicePriceSnapshot: number;
  serviceDurationSnapshot: number;
};

type AppointmentRow = {
  id: string;
  client_id: string;
  professional_id: string;
  service_id: string;
  starts_at: Date;
  ends_at: Date;
  status: AppointmentStatus;
  notes: string | null;
  service_price_snapshot: string | number;
  service_duration_snapshot: number;
};

function db(pool?: Pool) {
  return pool ?? getPool();
}

function mapAppointment(row: AppointmentRow): AppointmentDTO {
  return {
    id: row.id,
    clientId: row.client_id,
    professionalId: row.professional_id,
    serviceId: row.service_id,
    date: dateInSP(row.starts_at),
    start: timeInSP(row.starts_at),
    end: timeInSP(row.ends_at),
    status: row.status,
    notes: row.notes ?? '',
    servicePriceSnapshot: Number(row.service_price_snapshot),
    serviceDurationSnapshot: row.service_duration_snapshot,
  };
}

async function assertNoOverlap(
  professionalId: string,
  startsAt: Date,
  endsAt: Date,
  ignoreId: string | undefined,
  pool?: Pool,
): Promise<void> {
  const result = await db(pool).query(
    `SELECT id FROM appointments
     WHERE professional_id = $1
       AND status NOT IN ('cancelado', 'nao_compareceu')
       AND ($4::uuid IS NULL OR id <> $4)
       AND starts_at < $3
       AND ends_at > $2
     LIMIT 1`,
    [professionalId, startsAt, endsAt, ignoreId ?? null],
  );
  if (result.rows[0]) {
    throw new HttpError(409, 'Conflito de horário para este profissional.');
  }
}

function assertWithinWorkHours(
  workStart: string,
  workEnd: string,
  start: string,
  end: string,
): void {
  if (toMinutes(start) < toMinutes(workStart) || toMinutes(end) > toMinutes(workEnd)) {
    throw new HttpError(400, 'Horário fora do expediente do profissional.');
  }
}

export async function listAppointments(
  salonId: string,
  opts: {
    date?: string;
    professionalId?: string;
    clientId?: string;
    from?: string;
    to?: string;
  } = {},
  pool?: Pool,
): Promise<AppointmentDTO[]> {
  const clauses = ['salon_id = $1'];
  const params: unknown[] = [salonId];

  if (opts.date) {
    params.push(opts.date);
    clauses.push(
      `DATE(starts_at AT TIME ZONE 'America/Sao_Paulo') = $${params.length}::date`,
    );
  }
  if (opts.from) {
    params.push(opts.from);
    clauses.push(
      `DATE(starts_at AT TIME ZONE 'America/Sao_Paulo') >= $${params.length}::date`,
    );
  }
  if (opts.to) {
    params.push(opts.to);
    clauses.push(
      `DATE(starts_at AT TIME ZONE 'America/Sao_Paulo') <= $${params.length}::date`,
    );
  }
  if (opts.professionalId) {
    params.push(opts.professionalId);
    clauses.push(`professional_id = $${params.length}`);
  }
  if (opts.clientId) {
    params.push(opts.clientId);
    clauses.push(`client_id = $${params.length}`);
  }

  const result = await db(pool).query<AppointmentRow>(
    `SELECT id, client_id, professional_id, service_id, starts_at, ends_at,
            status, notes, service_price_snapshot, service_duration_snapshot
     FROM appointments
     WHERE ${clauses.join(' AND ')}
     ORDER BY starts_at ASC`,
    params,
  );
  return result.rows.map(mapAppointment);
}

export async function createAppointment(
  salonId: string,
  input: {
    clientId: string;
    professionalId: string;
    serviceId: string;
    date: string;
    start: string;
    notes?: string;
  },
  pool?: Pool,
): Promise<AppointmentDTO> {
  if (!input.clientId) throw new HttpError(400, 'Selecione um cliente.');
  if (!input.date || !input.start) throw new HttpError(400, 'Informe data e horário.');

  const client = await db(pool).query(
    `SELECT id FROM clients WHERE id = $1 AND salon_id = $2 AND active = TRUE`,
    [input.clientId, salonId],
  );
  if (!client.rows[0]) throw new HttpError(400, 'Cliente inválido ou inativo.');

  const professional = await getActiveProfessional(salonId, input.professionalId, pool);
  const service = await getActiveService(salonId, input.serviceId, pool);

  if (professional.serviceIds.length > 0 && !professional.serviceIds.includes(service.id)) {
    throw new HttpError(400, 'Este profissional não realiza o serviço selecionado.');
  }

  const end = addMinutesHHMM(input.start, service.durationMinutes);
  assertWithinWorkHours(professional.workStart, professional.workEnd, input.start, end);

  const startsAt = spLocalToDate(input.date, input.start);
  const endsAt = spLocalToDate(input.date, end);
  await assertNoOverlap(professional.id, startsAt, endsAt, undefined, pool);

  const result = await db(pool).query<AppointmentRow>(
    `INSERT INTO appointments (
       salon_id, client_id, professional_id, service_id,
       starts_at, ends_at, status,
       service_price_snapshot, service_duration_snapshot, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,'agendado',$7,$8,$9)
     RETURNING id, client_id, professional_id, service_id, starts_at, ends_at,
               status, notes, service_price_snapshot, service_duration_snapshot`,
    [
      salonId,
      input.clientId,
      input.professionalId,
      input.serviceId,
      startsAt,
      endsAt,
      service.price,
      service.durationMinutes,
      input.notes?.trim() || null,
    ],
  );
  return mapAppointment(result.rows[0]);
}

export async function updateAppointment(
  salonId: string,
  id: string,
  input: {
    clientId: string;
    professionalId: string;
    serviceId: string;
    date: string;
    start: string;
    notes?: string;
  },
  pool?: Pool,
): Promise<AppointmentDTO> {
  const existing = await db(pool).query<AppointmentRow>(
    `SELECT id, client_id, professional_id, service_id, starts_at, ends_at,
            status, notes, service_price_snapshot, service_duration_snapshot
     FROM appointments WHERE id = $1 AND salon_id = $2`,
    [id, salonId],
  );
  if (!existing.rows[0]) throw new HttpError(404, 'Agendamento não encontrado.');

  const client = await db(pool).query(
    `SELECT id FROM clients WHERE id = $1 AND salon_id = $2 AND active = TRUE`,
    [input.clientId, salonId],
  );
  if (!client.rows[0]) throw new HttpError(400, 'Cliente inválido ou inativo.');

  const professional = await getActiveProfessional(salonId, input.professionalId, pool);
  const service = await getActiveService(salonId, input.serviceId, pool);

  if (professional.serviceIds.length > 0 && !professional.serviceIds.includes(service.id)) {
    throw new HttpError(400, 'Este profissional não realiza o serviço selecionado.');
  }

  const end = addMinutesHHMM(input.start, service.durationMinutes);
  assertWithinWorkHours(professional.workStart, professional.workEnd, input.start, end);

  const startsAt = spLocalToDate(input.date, input.start);
  const endsAt = spLocalToDate(input.date, end);
  await assertNoOverlap(professional.id, startsAt, endsAt, id, pool);

  // Snapshot só muda se o serviço for trocado
  const sameService = existing.rows[0].service_id === input.serviceId;
  const price = sameService
    ? Number(existing.rows[0].service_price_snapshot)
    : service.price;
  const duration = sameService
    ? existing.rows[0].service_duration_snapshot
    : service.durationMinutes;

  const result = await db(pool).query<AppointmentRow>(
    `UPDATE appointments SET
       client_id = $3,
       professional_id = $4,
       service_id = $5,
       starts_at = $6,
       ends_at = $7,
       service_price_snapshot = $8,
       service_duration_snapshot = $9,
       notes = $10,
       updated_at = NOW()
     WHERE id = $1 AND salon_id = $2
     RETURNING id, client_id, professional_id, service_id, starts_at, ends_at,
               status, notes, service_price_snapshot, service_duration_snapshot`,
    [
      id,
      salonId,
      input.clientId,
      input.professionalId,
      input.serviceId,
      startsAt,
      endsAt,
      price,
      duration,
      input.notes?.trim() || null,
    ],
  );
  return mapAppointment(result.rows[0]);
}

export async function setAppointmentStatus(
  salonId: string,
  id: string,
  status: string,
  pool?: Pool,
): Promise<AppointmentDTO> {
  if (!APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) {
    throw new HttpError(400, 'Status inválido.');
  }
  const result = await db(pool).query<AppointmentRow>(
    `UPDATE appointments SET status = $3, updated_at = NOW()
     WHERE id = $1 AND salon_id = $2
     RETURNING id, client_id, professional_id, service_id, starts_at, ends_at,
               status, notes, service_price_snapshot, service_duration_snapshot`,
    [id, salonId, status],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Agendamento não encontrado.');
  return mapAppointment(result.rows[0]);
}
