/**
 * WhatsApp Cloud API (Meta) — envia template aprovado de nova reserva.
 * Sem token/número configurados, as chamadas são ignoradas (no-op).
 */
import { env } from '../config/env';

export type NewBookingWhatsAppDetails = {
  clientName: string;
  serviceName: string;
  date: string;
  start: string;
};

/** Converte telefone BR (com ou sem 55) para E.164 sem '+'. */
export function toWhatsAppE164(phone: string): string | null {
  let digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  if (digits.length < 12 || digits.length > 13) return null;
  return digits;
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(env.whatsapp.token && env.whatsapp.phoneNumberId);
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

  const url = `https://graph.facebook.com/v21.0/${env.whatsapp.phoneNumberId}/messages`;
  const body = {
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
  };

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
