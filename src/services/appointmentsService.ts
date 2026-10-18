import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';
import {
  addMinutesHHMM,
  civilDateSql,
  dateInZone,
  DEFAULT_SALON_TIMEZONE,
  timeInZone,
  toMinutes,
  weekdayFromISO,
  zonedLocalToDate,
} from '../lib/time';
import { getSalonById } from './salonsService';
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

function mapAppointment(row: AppointmentRow, timeZone: string): AppointmentDTO {
  return {
    id: row.id,
    clientId: row.client_id,
    professionalId: row.professional_id,
    serviceId: row.service_id,
    date: dateInZone(row.starts_at, timeZone),
    start: timeInZone(row.starts_at, timeZone),
    end: timeInZone(row.ends_at, timeZone),
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
  conflictMessage = 'Conflito de horário para este profissional.',
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
    throw new HttpError(409, conflictMessage);
  }
}

async function salonClock(salonId: string, pool?: Pool): Promise<{ timeZone: string; cancelLeadMs: number }> {
  const salon = await getSalonById(salonId, pool);
  const minutes = salon?.clientCancelLeadMinutes ?? 120;
  return {
    timeZone: salon?.timezone || DEFAULT_SALON_TIMEZONE,
    cancelLeadMs: minutes * 60 * 1000,
  };
}

function assertWorksOnDate(workDays: number[], date: string, timeZone: string): void {
  if (!workDays.includes(weekdayFromISO(date, timeZone))) {
    throw new HttpError(400, 'O profissional não atende neste dia da semana.');
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

function assertNotInPast(startsAt: Date): void {
  if (startsAt.getTime() < Date.now()) {
    throw new HttpError(400, 'Não é possível agendar um horário no passado.');
  }
}

/** Transições permitidas (espelha o frontend). */
const NEXT_STATUSES: Record<AppointmentStatus, AppointmentStatus[]> = {
  agendado: ['confirmado', 'em_atendimento', 'concluido', 'cancelado', 'nao_compareceu'],
  confirmado: ['em_atendimento', 'concluido', 'cancelado', 'nao_compareceu'],
  em_atendimento: ['concluido', 'cancelado'],
  concluido: [],
  cancelado: [],
  nao_compareceu: [],
};

function assertValidTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (from === to) return;
  if (!NEXT_STATUSES[from].includes(to)) {
    throw new HttpError(400, `Não é possível alterar o status de "${from}" para "${to}".`);
  }
}

/** O cliente só confirma presença ou cancela o próprio horário. */
const CLIENT_NEXT_STATUSES: Record<AppointmentStatus, AppointmentStatus[]> = {
  agendado: ['confirmado', 'cancelado'],
  confirmado: ['cancelado'],
  em_atendimento: [],
  concluido: [],
  cancelado: [],
  nao_compareceu: [],
};

/** Cancelamento do cliente vale até 2 horas antes do início. */
export const CLIENT_CANCEL_LEAD_MS = 2 * 60 * 60 * 1000;

function cancelLeadMessage(leadMs: number): string {
  const minutes = Math.round(leadMs / 60000);
  if (minutes === 120) return 'O cancelamento só é permitido até 2 horas antes do horário.';
  if (minutes > 0 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `O cancelamento só é permitido até ${hours} ${hours === 1 ? 'hora' : 'horas'} antes do horário.`;
  }
  return `O cancelamento só é permitido até ${minutes} minutos antes do horário.`;
}

export function assertClientStatusChange(
  from: AppointmentStatus,
  to: AppointmentStatus,
  startsAt: Date,
  now: Date = new Date(),
  leadMs: number = CLIENT_CANCEL_LEAD_MS,
): void {
  if (from === to) return;
  if (!CLIENT_NEXT_STATUSES[from].includes(to)) {
    throw new HttpError(400, 'Você só pode confirmar ou cancelar o próprio agendamento.');
  }
  if (to === 'cancelado' && startsAt.getTime() - now.getTime() < leadMs) {
    throw new HttpError(400, cancelLeadMessage(leadMs));
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
  const { timeZone } = await salonClock(salonId, pool);
  const dayExpr = civilDateSql('starts_at', '$1');
  const clauses = ['salon_id = $1'];
  const params: unknown[] = [salonId];

  if (opts.date) {
    params.push(opts.date);
    clauses.push(`${dayExpr} = $${params.length}::date`);
  }
  if (opts.from) {
    params.push(opts.from);
    clauses.push(`${dayExpr} >= $${params.length}::date`);
  }
  if (opts.to) {
    params.push(opts.to);
    clauses.push(`${dayExpr} <= $${params.length}::date`);
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
  return result.rows.map((row) => mapAppointment(row, timeZone));
}

export async function getAppointment(
  salonId: string,
  id: string,
  pool?: Pool,
): Promise<AppointmentDTO | null> {
  const { timeZone } = await salonClock(salonId, pool);
  const result = await db(pool).query<AppointmentRow>(
    `SELECT id, client_id, professional_id, service_id, starts_at, ends_at,
            status, notes, service_price_snapshot, service_duration_snapshot
     FROM appointments
     WHERE id = $1 AND salon_id = $2`,
    [id, salonId],
  );
  return result.rows[0] ? mapAppointment(result.rows[0], timeZone) : null;
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
  opts?: { conflictMessage?: string },
): Promise<AppointmentDTO> {
  if (!input.clientId) throw new HttpError(400, 'Selecione um cliente.');
  if (!input.date || !input.start) throw new HttpError(400, 'Informe data e horário.');
  const { timeZone } = await salonClock(salonId, pool);

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
  assertWorksOnDate(professional.workDays, input.date, timeZone);
  assertWithinWorkHours(professional.workStart, professional.workEnd, input.start, end);

  const startsAt = zonedLocalToDate(input.date, input.start, timeZone);
  const endsAt = zonedLocalToDate(input.date, end, timeZone);
  assertNotInPast(startsAt);
  await assertNoOverlap(professional.id, startsAt, endsAt, undefined, pool, opts?.conflictMessage);

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
  return mapAppointment(result.rows[0], timeZone);
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
  opts?: { conflictMessage?: string },
): Promise<AppointmentDTO> {
  const { timeZone } = await salonClock(salonId, pool);
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

  const startsAt = zonedLocalToDate(input.date, input.start, timeZone);
  const endsAt = zonedLocalToDate(input.date, end, timeZone);

  const existingMapped = mapAppointment(existing.rows[0], timeZone);
  const keepingDay =
    existingMapped.date === input.date && existing.rows[0].professional_id === input.professionalId;
  if (!keepingDay) {
    assertWorksOnDate(professional.workDays, input.date, timeZone);
  }
  const scheduleChanged =
    existingMapped.date !== input.date || existingMapped.start !== input.start;
  if (scheduleChanged) {
    assertNotInPast(startsAt);
  }

  await assertNoOverlap(professional.id, startsAt, endsAt, id, pool, opts?.conflictMessage);

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
  return mapAppointment(result.rows[0], timeZone);
}

export async function setAppointmentStatus(
  salonId: string,
  id: string,
  status: string,
  pool?: Pool,
  clientId?: string,
): Promise<AppointmentDTO> {
  if (!APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) {
    throw new HttpError(400, 'Status inválido.');
  }
  const next = status as AppointmentStatus;
  const clock = await salonClock(salonId, pool);

  const existing = await db(pool).query<AppointmentRow>(
    `SELECT id, client_id, professional_id, service_id, starts_at, ends_at,
            status, notes, service_price_snapshot, service_duration_snapshot
     FROM appointments WHERE id = $1 AND salon_id = $2`,
    [id, salonId],
  );
  if (!existing.rows[0]) throw new HttpError(404, 'Agendamento não encontrado.');
  if (clientId && existing.rows[0].client_id !== clientId) {
    throw new HttpError(404, 'Agendamento não encontrado.');
  }

  if (clientId) {
    assertClientStatusChange(
      existing.rows[0].status,
      next,
      existing.rows[0].starts_at,
      new Date(),
      clock.cancelLeadMs,
    );
  } else {
    assertValidTransition(existing.rows[0].status, next);
  }

  const result = await db(pool).query<AppointmentRow>(
    `UPDATE appointments SET status = $3, updated_at = NOW()
     WHERE id = $1 AND salon_id = $2
     RETURNING id, client_id, professional_id, service_id, starts_at, ends_at,
               status, notes, service_price_snapshot, service_duration_snapshot`,
    [id, salonId, next],
  );
  return mapAppointment(result.rows[0], clock.timeZone);
}
