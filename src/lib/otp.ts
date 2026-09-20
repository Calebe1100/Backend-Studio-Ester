/**
 * Código de uso único enviado ao celular para recuperação de senha.
 * Entrega pelo WhatsApp e, se falhar, por SMS (Twilio). Sem nenhum canal
 * configurado, o código é apenas logado (desenvolvimento).
 */
import crypto from 'crypto';
import { env } from '../config/env';
import { maskPhone } from './phone';
import { isSmsConfigured, sendSms } from './sms';
import { isWhatsAppConfigured, sendPasswordResetWhatsApp } from './whatsapp';

export const OTP_LENGTH = 6;
/** Minutos de validade do código enviado ao celular. */
export const OTP_TTL_MINUTES = 10;
/** Tentativas erradas aceitas antes de invalidar o código. */
export const OTP_MAX_ATTEMPTS = 5;
/** Códigos que um mesmo usuário pode pedir por hora. */
export const OTP_MAX_PER_HOUR = 5;

/** Gera um código numérico de 6 dígitos com gerador criptográfico. */
export function generateOtpCode(): string {
  const max = 10 ** OTP_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(OTP_LENGTH, '0');
}

export function hashOtpCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/** Comparação em tempo constante entre o hash informado e o armazenado. */
export function otpCodeMatches(code: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashOtpCode(code), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

function smsMessage(code: string): string {
  return `${env.salon.name}: seu código para redefinir a senha é ${code}. Válido por ${OTP_TTL_MINUTES} minutos.`;
}

/**
 * Entrega o código no celular. Lança apenas se todos os canais configurados
 * falharem — quem chama decide se o erro é exposto ao usuário.
 */
export async function sendPasswordResetCode(phone: string, code: string): Promise<void> {
  const masked = maskPhone(phone);
  const failures: string[] = [];

  if (isWhatsAppConfigured()) {
    try {
      await sendPasswordResetWhatsApp(phone, code);
      return;
    } catch (err) {
      failures.push(`whatsapp: ${String(err)}`);
      console.error('[otp] WhatsApp falhou para', masked, err);
    }
  }

  if (isSmsConfigured()) {
    try {
      await sendSms(phone, smsMessage(code));
      return;
    } catch (err) {
      failures.push(`sms: ${String(err)}`);
      console.error('[otp] SMS falhou para', masked, err);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Não foi possível enviar o código (${failures.join(' | ')})`);
  }

  console.log(`[otp] Nenhum canal configurado — código para ${masked}: ${code}`);
}
