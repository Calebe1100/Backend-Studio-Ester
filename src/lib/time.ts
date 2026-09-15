/** Fuso operacional do salão (REFINAMENTO). */
export const SALON_TZ_OFFSET = '-03:00';

/** Converte data (YYYY-MM-DD) + hora (HH:MM) de America/Sao_Paulo em Date UTC. */
export function spLocalToDate(date: string, hhmm: string): Date {
  const time = hhmm.length === 5 ? `${hhmm}:00` : hhmm;
  return new Date(`${date}T${time}${SALON_TZ_OFFSET}`);
}

/** Extrai YYYY-MM-DD em America/Sao_Paulo. */
export function dateInSP(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

/** Extrai HH:MM em America/Sao_Paulo. */
export function timeInSP(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Normaliza TIME do pg ("09:00:00" | Date) para "HH:MM". */
export function pgTimeToHHMM(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 5);
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function addMinutesHHMM(hhmm: string, minutes: number): string {
  const total = toMinutes(hhmm) + minutes;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
