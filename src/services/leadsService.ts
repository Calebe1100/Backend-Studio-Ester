/**
 * Leads comerciais da landing page (SalonSign).
 * Valida, deduplica por telefone (janela de 24h), grava e avisa a equipe por e-mail.
 */
import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';
import { sendNewLeadEmail } from '../lib/mailer';
import { normalizeStoredPhone } from '../lib/phone';
import { env } from '../config/env';
import { parseSalonTheme, themeLabel, type SalonTheme } from './salonsService';

export type LeadInput = {
  name: string;
  phone: string;
  email?: string | null;
  salonName: string;
  teamSize?: string | null;
  theme?: string | null;
  consent: boolean;
  source?: string | null;
  utm?: Record<string, string> | null;
  /** Honeypot: se preenchido, é bot. */
  website?: string | null;
};

export type LeadDTO = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  salonName: string;
  teamSize: string | null;
  theme: SalonTheme;
  source: string;
  createdAt: string;
};

export type ValidatedLead = {
  name: string;
  phone: string;
  email: string | null;
  salonName: string;
  teamSize: string | null;
  theme: SalonTheme;
  source: string;
  utm: Record<string, string>;
};

const DEDUPE_WINDOW_HOURS = 24;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanUtm(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^utm_[a-z_]{1,32}$/i.test(k)) continue;
    const value = clean(v, 120);
    if (value) out[k.toLowerCase()] = value;
  }
  return out;
}

/** Valida e normaliza o payload. Lança HttpError 400 quando inválido. */
export function validateLead(input: Partial<LeadInput> | null | undefined): ValidatedLead {
  const data = input ?? {};

  const name = clean(data.name, 120);
  if (name.length < 2) throw new HttpError(400, 'Informe seu nome.');

  const phone = normalizeStoredPhone(clean(data.phone, 32));
  if (!phone) throw new HttpError(400, 'Informe um WhatsApp válido com DDD.');

  const salonName = clean(data.salonName, 160);
  if (salonName.length < 2) throw new HttpError(400, 'Informe o nome do salão.');

  const emailRaw = clean(data.email, 160).toLowerCase();
  if (emailRaw && !EMAIL_RE.test(emailRaw)) throw new HttpError(400, 'E-mail inválido.');

  if (data.consent !== true) {
    throw new HttpError(400, 'É necessário autorizar o contato para continuar.');
  }

  const teamSize = clean(data.teamSize, 40) || null;
  const source = clean(data.source, 60) || 'landing';
  const theme = parseSalonTheme(data.theme, { required: true });

  return {
    name,
    phone,
    email: emailRaw || null,
    salonName,
    teamSize,
    theme,
    source,
    utm: cleanUtm(data.utm),
  };
}

/** Honeypot preenchido = bot. */
export function isHoneypotTriggered(input: Partial<LeadInput> | null | undefined): boolean {
  return clean(input?.website, 10).length > 0;
}

function db(pool?: Pool) {
  return pool ?? getPool();
}

type LeadRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  salon_name: string;
  team_size: string | null;
  theme: string;
  source: string;
  created_at: Date;
};

function mapLead(row: LeadRow): LeadDTO {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    salonName: row.salon_name,
    teamSize: row.team_size,
    theme: parseSalonTheme(row.theme),
    source: row.source,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Cria o lead. Se o mesmo telefone já enviou nas últimas 24h, devolve o lead
 * existente sem duplicar (e sem reenviar e-mail).
 */
export async function createLead(
  input: Partial<LeadInput>,
  pool?: Pool,
): Promise<{ lead: LeadDTO; duplicated: boolean }> {
  const data = validateLead(input);
  const client = db(pool);

  const existing = await client.query<LeadRow>(
    `SELECT id, name, phone, email, salon_name, team_size, theme, source, created_at
       FROM leads
      WHERE phone = $1
        AND created_at > NOW() - ($2 || ' hours')::interval
      ORDER BY created_at DESC
      LIMIT 1`,
    [data.phone, String(DEDUPE_WINDOW_HOURS)],
  );

  if (existing.rows[0]) {
    return { lead: mapLead(existing.rows[0]), duplicated: true };
  }

  const inserted = await client.query<LeadRow>(
    `INSERT INTO leads (name, phone, email, salon_name, team_size, theme, source, utm)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id, name, phone, email, salon_name, team_size, theme, source, created_at`,
    [
      data.name,
      data.phone,
      data.email,
      data.salonName,
      data.teamSize,
      data.theme,
      data.source,
      JSON.stringify(data.utm),
    ],
  );

  const lead = mapLead(inserted.rows[0]);

  // Aviso por e-mail é best-effort: falha não derruba a captação.
  const to = env.salon.email || env.smtp.user;
  if (to) {
    sendNewLeadEmail(to, {
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      salonName: lead.salonName,
      teamSize: lead.teamSize,
      theme: themeLabel(lead.theme),
      source: lead.source,
      utm: data.utm,
    }).catch((err) => {
      console.error('[leads] falha ao enviar e-mail de novo lead:', err);
    });
  }

  return { lead, duplicated: false };
}
