/**
 * SMS via API REST da Twilio (usado como fallback quando o WhatsApp falha).
 * Chamado direto por fetch para não adicionar dependência ao projeto.
 */
import { env } from '../config/env';
import { toE164 } from './phone';

export function isSmsConfigured(): boolean {
  const { accountSid, authToken, from } = env.twilio;
  return Boolean(accountSid && authToken && from);
}

export async function sendSms(toPhone: string, message: string): Promise<void> {
  const { accountSid, authToken, from } = env.twilio;
  if (!isSmsConfigured()) {
    throw new Error('SMS (Twilio) não configurado');
  }

  const to = toE164(toPhone);
  if (!to) throw new Error('Telefone inválido para SMS');

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Twilio API ${res.status}: ${errText.slice(0, 400)}`);
  }
}
