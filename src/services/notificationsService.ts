import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { env } from '../config/env';
import { sendNewBookingEmail } from '../lib/mailer';
import { sendNewBookingWhatsApp } from '../lib/whatsapp';
import { dateInZone, DEFAULT_SALON_TIMEZONE, timeInZone } from '../lib/time';
import { getSalonById } from './salonsService';
import { listActiveStaffContacts } from './usersService';
import { sendPushToUsers } from './pushService';
import { recordNotifications } from './notificationsInboxService';

export type NewBookingNotifyPayload = {
  clientName: string;
  serviceName: string;
  professionalName: string;
  date: string;
  start: string;
};

function frontendBaseUrl(): string {
  const first = env.frontendUrl.split(',')[0]?.trim();
  return first || 'http://localhost:3000';
}

function formatDateBr(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

/**
 * Avisa a equipe (dono, recepção, profissionais) por e-mail, push e WhatsApp.
 * Nunca lança — falhas de canal são apenas logadas.
 */
export async function notifyStaffNewBooking(
  salonId: string,
  payload: NewBookingNotifyPayload,
  pool?: Pool,
): Promise<void> {
  try {
    const staff = await listActiveStaffContacts(salonId, pool ?? getPool());
    if (staff.length === 0) return;

    const salon = await getSalonById(salonId, pool);
    const salonName = salon?.name || 'Salão';
    const agendaUrl = `${frontendBaseUrl()}/agenda`;
    const dateLabel = formatDateBr(payload.date);
    const title = `${salonName} — Nova reserva`;
    const body = `${payload.clientName} · ${payload.serviceName} · ${dateLabel} às ${payload.start}`;

    const emailJobs = staff
      .filter((s) => s.email)
      .map((s) =>
        sendNewBookingEmail(
          s.email,
          {
            clientName: payload.clientName,
            serviceName: payload.serviceName,
            professionalName: payload.professionalName,
            date: dateLabel,
            start: payload.start,
            agendaUrl,
          },
          {
            name: salonName,
            email: salon?.contactEmail,
            brandColor: salon?.brandColor,
          },
        ),
      );

    const whatsappJobs = staff
      .filter((s) => s.phone)
      .map((s) =>
        sendNewBookingWhatsApp(s.phone!, {
          clientName: payload.clientName,
          serviceName: payload.serviceName,
          date: dateLabel,
          start: payload.start,
        }),
      );

    const pushJob = sendPushToUsers(
      staff.map((s) => s.id),
      { title, body, url: '/agenda' },
      pool,
    );

    const inboxJob = recordNotifications(
      salonId,
      staff.map((person) => ({
        userId: person.id,
        title: 'Nova reserva',
        body,
        href: '/agenda',
      })),
      pool,
    );

    const results = await Promise.allSettled([...emailJobs, ...whatsappJobs, pushJob, inboxJob]);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[notify] Canal falhou:', result.reason);
      }
    }
  } catch (err) {
    console.error('[notify] Erro ao notificar equipe:', err);
  }
}

const CLIENT_STATUS_TITLE: Record<string, string> = {
  agendado: 'Horário agendado',
  confirmado: 'Horário confirmado',
  em_atendimento: 'Atendimento iniciado',
  concluido: 'Atendimento concluído',
  cancelado: 'Horário cancelado',
  nao_compareceu: 'Falta registrada',
};

const STAFF_STATUS_TITLE: Record<string, string> = {
  confirmado: 'Cliente confirmou',
  cancelado: 'Cliente cancelou',
};

/**
 * Avisa no sininho quem não fez a mudança.
 * Cliente altera o próprio horário → equipe. Equipe altera → cliente com login.
 * Nunca lança.
 */
export async function notifyAppointmentStatusChanged(
  salonId: string,
  appointmentId: string,
  actorUserId: string,
  actorRole: string,
  pool?: Pool,
): Promise<void> {
  try {
    const result = await (pool ?? getPool()).query<{
      client_name: string;
      client_user_id: string | null;
      service_name: string;
      professional_name: string;
      starts_at: Date;
      status: string;
    }>(
      `SELECT c.name AS client_name, c.user_id AS client_user_id,
              s.name AS service_name, p.name AS professional_name,
              a.starts_at, a.status
       FROM appointments a
       JOIN clients c ON c.id = a.client_id
       JOIN services s ON s.id = a.service_id
       JOIN professionals p ON p.id = a.professional_id
       WHERE a.id = $1 AND a.salon_id = $2`,
      [appointmentId, salonId],
    );
    const row = result.rows[0];
    if (!row) return;

    const salon = await getSalonById(salonId, pool);
    const timeZone = salon?.timezone || DEFAULT_SALON_TIMEZONE;
    const when = `${formatDateBr(dateInZone(row.starts_at, timeZone))} às ${timeInZone(row.starts_at, timeZone)}`;

    if (actorRole === 'cliente') {
      const staff = await listActiveStaffContacts(salonId, pool ?? getPool());
      await recordNotifications(
        salonId,
        staff
          .filter((person) => person.id !== actorUserId)
          .map((person) => ({
            userId: person.id,
            title: STAFF_STATUS_TITLE[row.status] ?? 'Horário atualizado',
            body: `${row.client_name} · ${row.service_name} · ${when}`,
            href: '/agenda',
          })),
        pool,
      );
      return;
    }

    if (!row.client_user_id || row.client_user_id === actorUserId) return;
    await recordNotifications(
      salonId,
      [
        {
          userId: row.client_user_id,
          title: CLIENT_STATUS_TITLE[row.status] ?? 'Horário atualizado',
          body: `${row.service_name} com ${row.professional_name} · ${when}`,
          href: '/agendamentos',
        },
      ],
      pool,
    );
  } catch (err) {
    console.error('[notify] Erro ao registrar mudança de status:', err);
  }
}
