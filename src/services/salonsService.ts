import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { hashPassword } from '../lib/crypto';
import { HttpError } from '../lib/httpError';
import { normalizeStoredPhone } from '../lib/phone';
import { invalidateOriginCache } from '../lib/corsOrigins';
import { DEFAULT_SALON_TIMEZONE, isValidTimeZone } from '../lib/time';

export const ANA_ESTER_SLUG = 'ana-ester';
export const ANA_ESTER_BRAND_COLOR = '#7c2d3e';
export const NEUTRAL_BRAND_COLOR = '#4b5563';
export const DEFAULT_CANCEL_LEAD_MINUTES = 120;

export const ANA_ESTER_ORIGINS = [
  'https://app-studio-ester-rodrigues.vercel.app',
  'https://app-studio-ester.vercel.app',
  'https://studio-ester.vercel.app',
];

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SalonSettings = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  locale: string;
  contactEmail: string | null;
  brandColor: string;
  frontendOrigins: string[];
  clientCancelLeadMinutes: number;
  active: boolean;
};

type SalonRow = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  locale: string;
  contact_email: string | null;
  brand_color: string;
  frontend_origins: string[] | null;
  client_cancel_lead_minutes: number;
  active: boolean;
};

const SALON_SELECT = `id, name, slug, phone, address, timezone, currency, locale,
  contact_email, brand_color, frontend_origins, client_cancel_lead_minutes, active`;

export type ProvisionSalonInput = {
  name: string;
  slug: string;
  timezone?: string;
  currency?: string;
  locale?: string;
  phone?: string | null;
  address?: string | null;
  contactEmail?: string | null;
  brandColor?: string;
  frontendOrigins?: string[];
  clientCancelLeadMinutes?: number;
  owner: {
    name: string;
    email: string;
    password: string;
    phone: string;
  };
};

export type ProvisionedSalon = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  locale: string;
  owner: { id: string; name: string; email: string; role: 'dono' };
};

function db(pool?: Pool): Pool {
  return pool ?? getPool();
}

function mapSalon(row: SalonRow): SalonSettings {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    phone: row.phone,
    address: row.address,
    timezone: row.timezone || DEFAULT_SALON_TIMEZONE,
    currency: row.currency || 'BRL',
    locale: row.locale || 'pt-BR',
    contactEmail: row.contact_email,
    brandColor: row.brand_color || NEUTRAL_BRAND_COLOR,
    frontendOrigins: row.frontend_origins ?? [],
    clientCancelLeadMinutes: row.client_cancel_lead_minutes ?? DEFAULT_CANCEL_LEAD_MINUTES,
    active: row.active,
  };
}

export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export function assertSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug) || slug.length > 63) {
    throw new HttpError(400, 'O slug deve usar letras minúsculas, números e hífen.');
  }
}

function assertBrandColor(value: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new HttpError(400, 'Cor da marca inválida. Use o formato #rrggbb.');
  }
}

function normalizeOrigins(origins: string[] | undefined): string[] {
  if (!origins) return [];
  if (!Array.isArray(origins)) throw new HttpError(400, 'Origens do frontend inválidas.');
  return origins.map((origin) => {
    const value = String(origin ?? '').trim();
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new HttpError(400, `Origem inválida: ${value}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new HttpError(400, `Origem inválida: ${value}`);
    }
    return parsed.origin;
  });
}

export async function getSalonById(id: string, pool?: Pool): Promise<SalonSettings | null> {
  const result = await db(pool).query<SalonRow>(
    `SELECT ${SALON_SELECT} FROM salons WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? mapSalon(result.rows[0]) : null;
}

export async function getSalonBySlug(slug: string, pool?: Pool): Promise<SalonSettings | null> {
  const result = await db(pool).query<SalonRow>(
    `SELECT ${SALON_SELECT} FROM salons WHERE slug = $1`,
    [normalizeSlug(slug)],
  );
  return result.rows[0] ? mapSalon(result.rows[0]) : null;
}

export async function requireSalonBySlug(slug: string, pool?: Pool): Promise<SalonSettings> {
  const salon = await getSalonBySlug(slug, pool);
  if (!salon || !salon.active) throw new HttpError(404, 'Salão não encontrado.');
  return salon;
}

function uniqueViolation(err: unknown): string | null {
  if (!err || typeof err !== 'object' || !('code' in err)) return null;
  if ((err as { code: string }).code !== '23505') return null;
  return String((err as { constraint?: string }).constraint ?? '');
}

export async function provisionSalon(
  input: ProvisionSalonInput,
  pool?: Pool,
): Promise<ProvisionedSalon> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do salão.');

  const slug = normalizeSlug(input.slug ?? '');
  assertSlug(slug);

  const timezone = (input.timezone ?? DEFAULT_SALON_TIMEZONE).trim();
  if (!isValidTimeZone(timezone)) throw new HttpError(400, 'Fuso horário inválido.');

  const currency = (input.currency ?? 'BRL').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Moeda inválida.');

  const locale = (input.locale ?? 'pt-BR').trim();
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) throw new HttpError(400, 'Locale inválido.');

  const brandColor = (input.brandColor ?? NEUTRAL_BRAND_COLOR).trim();
  assertBrandColor(brandColor);

  const lead = input.clientCancelLeadMinutes ?? DEFAULT_CANCEL_LEAD_MINUTES;
  if (!Number.isInteger(lead) || lead < 0 || lead > 10080) {
    throw new HttpError(400, 'A antecedência de cancelamento deve ser um número de minutos.');
  }

  const origins = normalizeOrigins(input.frontendOrigins);
  const ownerName = input.owner?.name?.trim() ?? '';
  const ownerEmail = input.owner?.email?.trim().toLowerCase() ?? '';
  const ownerPassword = input.owner?.password ?? '';
  if (ownerName.length < 2) throw new HttpError(400, 'Informe o nome do responsável.');
  if (!ownerEmail.includes('@')) throw new HttpError(400, 'Informe o e-mail do responsável.');
  if (ownerPassword.length < 8) throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
  const ownerPhone = normalizeStoredPhone(input.owner?.phone);
  if (!ownerPhone) throw new HttpError(400, 'Informe um telefone válido com DDD.');

  const passwordHash = await hashPassword(ownerPassword);
  const client = await db(pool).connect();
  try {
    await client.query('BEGIN');
    const salonResult = await client.query<{ id: string }>(
      `INSERT INTO salons (
         name, slug, phone, address, timezone, currency, locale,
         contact_email, brand_color, frontend_origins, client_cancel_lead_minutes, active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)
       RETURNING id`,
      [
        name,
        slug,
        input.phone?.trim() || null,
        input.address?.trim() || null,
        timezone,
        currency,
        locale,
        input.contactEmail?.trim() || null,
        brandColor,
        origins,
        lead,
      ],
    );
    const salonId = salonResult.rows[0].id;
    const ownerResult = await client.query<{ id: string }>(
      `INSERT INTO users (salon_id, name, email, password_hash, role, phone)
       VALUES ($1, $2, $3, $4, 'dono', $5)
       RETURNING id`,
      [salonId, ownerName, ownerEmail, passwordHash, ownerPhone],
    );
    await client.query('COMMIT');
    invalidateOriginCache();
    return {
      id: salonId,
      name,
      slug,
      timezone,
      currency,
      locale,
      owner: {
        id: ownerResult.rows[0].id,
        name: ownerName,
        email: ownerEmail,
        role: 'dono',
      },
    };
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    const constraint = uniqueViolation(err);
    if (constraint) {
      if (constraint.includes('email')) {
        throw new HttpError(409, 'Já existe um usuário com este e-mail neste salão.');
      }
      throw new HttpError(409, 'Já existe um salão com este slug.');
    }
    throw err;
  } finally {
    client.release();
  }
}
