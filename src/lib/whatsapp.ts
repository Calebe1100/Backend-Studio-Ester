/**
 * WhatsApp Cloud API (Meta) — envia template aprovado de nova reserva.
 * Sem token/número configurados, as chamadas são ignoradas (no-op).
 */
import { env } from '../config/env';
import { toE164Digits } from './phone';

export type NewBookingWhatsAppDetails = {
  clientName: string;
  serviceName: string;
  date: string;
  start: string;
};

/** Converte telefone BR (com ou sem 55) para E.164 sem '+'. */
export function toWhatsAppE164(phone: string): string | null {
  return toE164Digits(phone);
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(env.whatsapp.token && env.whatsapp.phoneNumberId);
}

async function postToWhatsApp(body: unknown): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${env.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`WhatsApp API ${res.status}: ${errText.slice(0, 400)}`);
  }
}

export async function sendNewBookingWhatsApp(
  toPhone: string,
  details: NewBookingWhatsAppDetails,
): Promise<void> {
  if (!isWhatsAppConfigured()) {
    console.log('[whatsapp] Não configurado — mensagem ignorada para', toPhone);
    return;
  }

  const to = toWhatsAppE164(toPhone);
  if (!to) {
    console.warn('[whatsapp] Telefone inválido, ignorando:', toPhone);
    return;
  }

  await postToWhatsApp({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: env.whatsapp.templateName,
      language: { code: env.whatsapp.templateLang },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: details.clientName },
            { type: 'text', text: details.serviceName },
            { type: 'text', text: details.date },
            { type: 'text', text: details.start },
          ],
        },
      ],
    },
  });
}

/**
 * Envia o código de recuperação de senha pelo template de OTP.
 * O template precisa ter um único parâmetro no corpo: o código.
 */
export async function sendPasswordResetWhatsApp(toPhone: string, code: string): Promise<void> {
  if (!isWhatsAppConfigured()) {
    throw new Error('WhatsApp não configurado');
  }

  const to = toWhatsAppE164(toPhone);
  if (!to) throw new Error('Telefone inválido para WhatsApp');

  const components: unknown[] = [
    { type: 'body', parameters: [{ type: 'text', text: code }] },
  ];
  if (env.whatsapp.otpTemplateCopyButton) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: code }],
    });
  }

  await postToWhatsApp({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: env.whatsapp.otpTemplateName,
      language: { code: env.whatsapp.otpTemplateLang },
      components,
    },
  });
}
