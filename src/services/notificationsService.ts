import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { env } from '../config/env';
import { sendNewBookingEmail } from '../lib/mailer';
import { sendNewBookingWhatsApp } from '../lib/whatsapp';
import { listActiveStaffContacts } from './usersService';
import { sendPushToUsers } from './pushService';

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

    const agendaUrl = `${frontendBaseUrl()}/agenda`;
    const dateLabel = formatDateBr(payload.date);
    const title = `${env.salon.name} — Nova reserva`;
    const body = `${payload.clientName} · ${payload.serviceName} · ${dateLabel} às ${payload.start}`;

    const emailJobs = staff
      .filter((s) => s.email)
      .map((s) =>
        sendNewBookingEmail(s.email, {
          clientName: payload.clientName,
          serviceName: payload.serviceName,
          professionalName: payload.professionalName,
          date: dateLabel,
          start: payload.start,
          agendaUrl,
        }),
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

    const results = await Promise.allSettled([...emailJobs, ...whatsappJobs, pushJob]);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[notify] Canal falhou:', result.reason);
      }
    }
  } catch (err) {
    console.error('[notify] Erro ao notificar equipe:', err);
  }
}
