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

export async function sendPasswordResetEmail(
  toEmail: string,
  resetToken: string
): Promise<void> {
  const transporter = createTransporter();
  const { name: salonName, email: salonEmail } = env.salon;
  const resetUrl = `${env.frontendUrl.split(',')[0]?.trim() || env.frontendUrl}/recuperar-senha?token=${resetToken}`;

  const info = await transporter.sendMail({
    from: `"${salonName}" <${salonEmail || env.smtp.user}>`,
    to: toEmail,
    subject: `${salonName} — Redefinição de senha`,
    text: `Você solicitou a redefinição da sua senha.\n\nClique no link abaixo (válido por 1 hora):\n${resetUrl}\n\nSe não foi você, ignore este e-mail.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#7c2d3e">${salonName}</h2>
        <p>Você solicitou a redefinição da sua senha.</p>
        <p>
          <a href="${resetUrl}"
             style="display:inline-block;padding:12px 24px;background:#7c2d3e;color:#fff;border-radius:6px;text-decoration:none">
            Redefinir senha
          </a>
        </p>
        <p style="color:#666;font-size:12px">
          Link válido por 1 hora. Se não foi você, ignore este e-mail.
        </p>
      </div>
    `,
  });

  logSimulatedMail(info, 'e-mail de redefinição');
  if (!env.smtp.host || !env.smtp.user) {
    console.log('[mailer] Reset URL:', resetUrl);
  }
}

export async function sendNewBookingEmail(
  toEmail: string,
  details: NewBookingEmailDetails,
): Promise<void> {
  const transporter = createTransporter();
  const { name: salonName, email: salonEmail } = env.salon;

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
        <h2 style="color:#7c2d3e">${salonName}</h2>
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
             style="display:inline-block;padding:12px 24px;background:#7c2d3e;color:#fff;border-radius:6px;text-decoration:none">
            Abrir agenda
          </a>
        </p>
      </div>
    `,
  });

  logSimulatedMail(info, 'e-mail de nova reserva');
}
