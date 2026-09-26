/**
 * Normalização de telefones brasileiros.
 * Os números são gravados de formas diferentes no banco (com ou sem DDI, com
 * ou sem máscara), então a busca usa variantes em vez de comparação exata.
 */

/** Mantém apenas dígitos e remove zeros à esquerda (trunk code). */
export function toDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

/** Telefone BR válido: 10/11 dígitos com DDD, ou 12/13 já com o DDI 55. */
export function isValidBrPhone(raw: string): boolean {
  const digits = toDigits(raw);
  if (digits.startsWith('55')) return digits.length === 12 || digits.length === 13;
  return digits.length === 10 || digits.length === 11;
}

/** Remove o DDI 55 quando presente, devolvendo DDD + número. */
function toLocalNumber(digits: string): string {
  return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
}

/**
 * Telefone pronto para gravar: só dígitos, sem DDI.
 * Retorna null quando vazio ou inválido.
 */
export function normalizeStoredPhone(raw?: string | null): string | null {
  const digits = toDigits(raw);
  if (!isValidBrPhone(digits)) return null;
  return toLocalNumber(digits);
}

/**
 * Variantes de um telefone para comparar com o que está salvo no banco.
 * Cobre DDI opcional e o nono dígito dos celulares, que pode faltar em
 * cadastros antigos.
 */
export function phoneLookupVariants(raw: string): string[] {
  const digits = toDigits(raw);
  if (!digits) return [];

  const local = toLocalNumber(digits);
  const locals = new Set([local]);

  const ddd = local.slice(0, 2);
  const subscriber = local.slice(2);
  if (subscriber.length === 9 && subscriber.startsWith('9')) {
    locals.add(`${ddd}${subscriber.slice(1)}`);
  } else if (subscriber.length === 8 && /^[6-9]/.test(subscriber)) {
    locals.add(`${ddd}9${subscriber}`);
  }

  const variants = new Set<string>();
  for (const value of locals) {
    variants.add(value);
    variants.add(`55${value}`);
  }
  return [...variants];
}

/** Converte para E.164 sem '+' (formato exigido pela API do WhatsApp). */
export function toE164Digits(raw: string): string | null {
  let digits = toDigits(raw);
  if (!digits) return null;
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  if (digits.length < 12 || digits.length > 13) return null;
  return digits;
}

/** Converte para E.164 com '+' (formato exigido pela Twilio). */
export function toE164(raw: string): string | null {
  const digits = toE164Digits(raw);
  return digits ? `+${digits}` : null;
}

/** Máscara para logs: mantém só os 4 últimos dígitos. */
export function maskPhone(raw: string): string {
  const digits = toDigits(raw);
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}
