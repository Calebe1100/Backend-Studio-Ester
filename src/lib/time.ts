/** Fuso padrão quando o salão ainda não declara o seu. */
export const DEFAULT_SALON_TIMEZONE = 'America/Sao_Paulo';

/** Offset fixo de São Paulo, usado quando o fuso não é informado. */
export const SALON_TZ_OFFSET = '-03:00';

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset ISO (`-03:00`) do fuso num instante. */
export function offsetForTimeZone(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
    hour: '2-digit',
  }).formatToParts(instant);
  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return SALON_TZ_OFFSET;
  return `${match[1]}${match[2].padStart(2, '0')}:${match[3] ?? '00'}`;
}

/** Dia da semana civil (0=domingo … 6=sábado) de uma data YYYY-MM-DD no fuso do salão. */
export function weekdayFromISO(date: string, timeZone: string = DEFAULT_SALON_TIMEZONE): number {
  const offset = offsetForTimeZone(timeZone, new Date(`${date}T12:00:00Z`));
  return new Date(`${date}T12:00:00${offset}`).getUTCDay();
}

/** Converte data (YYYY-MM-DD) + hora (HH:MM) do fuso informado em Date UTC. */
export function zonedLocalToDate(date: string, hhmm: string, timeZone: string = DEFAULT_SALON_TIMEZONE): Date {
  const time = hhmm.length === 5 ? `${hhmm}:00` : hhmm;
  const guess = new Date(`${date}T${time}Z`);
  const offset = offsetForTimeZone(timeZone, guess);
  const candidate = new Date(`${date}T${time}${offset}`);
  const corrected = offsetForTimeZone(timeZone, candidate);
  if (corrected === offset) return candidate;
  return new Date(`${date}T${time}${corrected}`);
}

/** Converte data + hora de America/Sao_Paulo em Date UTC. */
export function spLocalToDate(date: string, hhmm: string): Date {
  return zonedLocalToDate(date, hhmm, DEFAULT_SALON_TIMEZONE);
}

/** Extrai YYYY-MM-DD no fuso informado. */
export function dateInZone(value: Date | string, timeZone: string = DEFAULT_SALON_TIMEZONE): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(d);
}

/** Extrai HH:MM no fuso informado. */
export function timeInZone(value: Date | string, timeZone: string = DEFAULT_SALON_TIMEZONE): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Extrai YYYY-MM-DD em America/Sao_Paulo. */
export function dateInSP(value: Date | string): string {
  return dateInZone(value, DEFAULT_SALON_TIMEZONE);
}

/** Extrai HH:MM em America/Sao_Paulo. */
export function timeInSP(value: Date | string): string {
  return timeInZone(value, DEFAULT_SALON_TIMEZONE);
}

/**
 * Dia civil de um timestamptz no fuso gravado do salão.
 * `salonIdParam` é a referência SQL do id (`$1`), não um valor interpolado.
 */
export function civilDateSql(column: string, salonIdParam: string): string {
  return `DATE(${column} AT TIME ZONE COALESCE((SELECT timezone FROM salons WHERE id = ${salonIdParam}), '${DEFAULT_SALON_TIMEZONE}'))`;
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
