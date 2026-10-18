/**
 * Serviço de e-mail — usa nodemailer com SMTP configurável via variáveis de ambiente.
 * Em desenvolvimento (sem SMTP configurado), loga o e-mail no console.
 */
import nodemailer from 'nodemailer';
import { env } from '../config/env';

export type NewBookingEmailDetails = {
  clientName: string;
  serviceName: string;
  professionalName: string;
  date: string;
  start: string;
  agendaUrl: string;
};

function createTransporter() {
  const { host, port, user, pass } = env.smtp;

  // Se não houver SMTP configurado, usa o console como fallback (dev/test)
  if (!host || !user || !pass) {
    return nodemailer.createTransport({
      jsonTransport: true, // Não envia de verdade; registra no console
    });
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function logSimulatedMail(info: unknown, label: string): void {
  if (!env.smtp.host || !env.smtp.user) {
    const jsonInfo = info as { message?: string };
    console.log(`[mailer] SMTP não configurado — ${label} simulado:`);
    try {
      console.log(JSON.parse(jsonInfo.message ?? '{}'));
    } catch {
      console.log(info);
    }
  }
}

export async function sendNewBookingEmail(
  toEmail: string,
  details: NewBookingEmailDetails,
  branding?: { name: string; email?: string | null; brandColor?: string },
): Promise<void> {
  const transporter = createTransporter();
  const salonName = branding?.name || 'Salão';
  const salonEmail = branding?.email || env.smtp.user;
  const brandColor = /^#[0-9a-fA-F]{6}$/.test(branding?.brandColor ?? '')
    ? branding!.brandColor!
    : '#4b5563';

  const text = [
    `Nova reserva em ${salonName}`,
    '',
    `Cliente: ${details.clientName}`,
    `Serviço: ${details.serviceName}`,
    `Profissional: ${details.professionalName}`,
    `Data: ${details.date}`,
    `Horário: ${details.start}`,
    '',
    `Abrir agenda: ${details.agendaUrl}`,
  ].join('\n');

  const info = await transporter.sendMail({
    from: `"${salonName}" <${salonEmail || env.smtp.user}>`,
    to: toEmail,
    subject: `${salonName} — Nova reserva`,
    text,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:${brandColor}">${salonName}</h2>
        <p><strong>Nova reserva</strong></p>
        <ul style="padding-left:18px;line-height:1.6">
          <li><strong>Cliente:</strong> ${details.clientName}</li>
          <li><strong>Serviço:</strong> ${details.serviceName}</li>
          <li><strong>Profissional:</strong> ${details.professionalName}</li>
          <li><strong>Data:</strong> ${details.date}</li>
          <li><strong>Horário:</strong> ${details.start}</li>
        </ul>
        <p>
          <a href="${details.agendaUrl}"
             style="display:inline-block;padding:12px 24px;background:${brandColor};color:#fff;border-radius:6px;text-decoration:none">
            Abrir agenda
          </a>
        </p>
      </div>
    `,
  });

  logSimulatedMail(info, 'e-mail de nova reserva');
}

export type NewLeadEmailDetails = {
  name: string;
  phone: string;
  email: string | null;
  salonName: string;
  teamSize: string | null;
  source: string;
  utm: Record<string, string>;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Aviso interno de novo lead comercial vindo da landing page. */
export async function sendNewLeadEmail(
  toEmail: string,
  details: NewLeadEmailDetails,
): Promise<void> {
  const transporter = createTransporter();
  const from = env.salon.email || env.smtp.user;
  const utmText = Object.entries(details.utm)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  const waLink = `https://wa.me/55${details.phone}`;

  const lines = [
    'Novo lead da landing page SalonSign',
    '',
    `Nome: ${details.name}`,
    `WhatsApp: ${details.phone} (${waLink})`,
    `E-mail: ${details.email ?? '—'}`,
    `Salão: ${details.salonName}`,
    `Equipe: ${details.teamSize ?? '—'}`,
    `Origem: ${details.source}${utmText ? ` (${utmText})` : ''}`,
  ];

  const row = (label: string, value: string) =>
    `<li><strong>${label}:</strong> ${escapeHtml(value)}</li>`;

  const info = await transporter.sendMail({
    from: `"SalonSign" <${from}>`,
    to: toEmail,
    subject: `SalonSign — Novo lead: ${details.salonName}`,
    text: lines.join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#3b1f3a">Novo lead da landing page</h2>
        <ul style="padding-left:18px;line-height:1.6">
          ${row('Nome', details.name)}
          ${row('WhatsApp', details.phone)}
          ${row('E-mail', details.email ?? '—')}
          ${row('Salão', details.salonName)}
          ${row('Equipe', details.teamSize ?? '—')}
          ${row('Origem', `${details.source}${utmText ? ` (${utmText})` : ''}`)}
        </ul>
        <p>
          <a href="${waLink}"
             style="display:inline-block;padding:12px 24px;background:#e9607a;color:#fff;border-radius:999px;text-decoration:none">
            Chamar no WhatsApp
          </a>
        </p>
      </div>
    `,
  });

  logSimulatedMail(info, 'e-mail de novo lead');
}
