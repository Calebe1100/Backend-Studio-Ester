import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';
import { readOptionalImage, type ImageContentType } from '../lib/imagePayload';

export type ServiceDTO = {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  active: boolean;
  imageUpdatedAt: string | null;
};

export type ServiceImage = {
  bytes: Buffer;
  contentType: ImageContentType;
};

type ServiceRow = {
  id: string;
  name: string;
  duration: number;
  price: string | number;
  active: boolean;
  image_updated_at: Date | string | null;
};

type ImageRow = {
  image: Buffer | null;
  image_type: string | null;
};

const SERVICE_COLUMNS = 'id, name, duration, price, active, image_updated_at';

const ALLOWED_TYPES = new Set<ImageContentType>(['image/jpeg', 'image/png', 'image/webp']);

function mapService(row: ServiceRow): ServiceDTO {
  return {
    id: row.id,
    name: row.name,
    durationMinutes: row.duration,
    price: Number(row.price),
    active: row.active,
    imageUpdatedAt: toIso(row.image_updated_at),
  };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function db(pool?: Pool) {
  return pool ?? getPool();
}

function assertServiceInput(input: { name?: string; durationMinutes?: number; price?: number }) {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do serviço.');
  if (!input.durationMinutes || input.durationMinutes < 15) {
    throw new HttpError(400, 'A duração mínima é 15 minutos.');
  }
  if (input.price == null || input.price < 0) {
    throw new HttpError(400, 'O preço não pode ser negativo.');
  }
  return name;
}

export async function listServices(salonId: string, pool?: Pool): Promise<ServiceDTO[]> {
  const result = await db(pool).query<ServiceRow>(
    `SELECT ${SERVICE_COLUMNS}
     FROM services
     WHERE salon_id = $1
     ORDER BY active DESC, name ASC`,
    [salonId],
  );
  return result.rows.map(mapService);
}

export async function createService(
  salonId: string,
  input: { name: string; durationMinutes: number; price: number; image?: unknown },
  pool?: Pool,
): Promise<ServiceDTO> {
  const name = assertServiceInput(input);
  const image = readOptionalImage(input);

  const result = await db(pool).query<ServiceRow>(
    `INSERT INTO services (salon_id, name, duration, price, image, image_type, image_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5::bytea IS NULL THEN NULL ELSE NOW() END)
     RETURNING ${SERVICE_COLUMNS}`,
    [
      salonId,
      name,
      input.durationMinutes,
      input.price,
      image?.bytes ?? null,
      image?.contentType ?? null,
    ],
  );
  return mapService(result.rows[0]);
}

export async function updateService(
  salonId: string,
  id: string,
  input: { name: string; durationMinutes: number; price: number; image?: unknown },
  pool?: Pool,
): Promise<ServiceDTO> {
  const name = assertServiceInput(input);
  const image = readOptionalImage(input);
  const touchImage = image !== undefined;

  const result = await db(pool).query<ServiceRow>(
    `UPDATE services
     SET name = $3,
         duration = $4,
         price = $5,
         image = CASE WHEN $6::boolean THEN $7::bytea ELSE image END,
         image_type = CASE WHEN $6::boolean THEN $8::text ELSE image_type END,
         image_updated_at = CASE
           WHEN NOT $6::boolean THEN image_updated_at
           WHEN $7::bytea IS NULL THEN NULL
           ELSE NOW()
         END,
         updated_at = NOW()
     WHERE id = $1 AND salon_id = $2
     RETURNING ${SERVICE_COLUMNS}`,
    [
      id,
      salonId,
      name,
      input.durationMinutes,
      input.price,
      touchImage,
      image?.bytes ?? null,
      image?.contentType ?? null,
    ],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Serviço não encontrado.');
  return mapService(result.rows[0]);
}

export async function setServiceActive(
  salonId: string,
  id: string,
  active: boolean,
  pool?: Pool,
): Promise<ServiceDTO> {
  const result = await db(pool).query<ServiceRow>(
    `UPDATE services SET active = $3, updated_at = NOW()
     WHERE id = $1 AND salon_id = $2
     RETURNING ${SERVICE_COLUMNS}`,
    [id, salonId, active],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Serviço não encontrado.');
  return mapService(result.rows[0]);
}

export async function getActiveService(
  salonId: string,
  id: string,
  pool?: Pool,
): Promise<ServiceDTO> {
  const result = await db(pool).query<ServiceRow>(
    `SELECT ${SERVICE_COLUMNS}
     FROM services
     WHERE id = $1 AND salon_id = $2 AND active = TRUE`,
    [id, salonId],
  );
  if (!result.rows[0]) throw new HttpError(400, 'Selecione um serviço ativo.');
  return mapService(result.rows[0]);
}

export async function getServiceImage(
  salonId: string,
  id: string,
  pool?: Pool,
): Promise<ServiceImage | null> {
  const result = await db(pool).query<ImageRow>(
    `SELECT image, image_type
     FROM services
     WHERE id = $1 AND salon_id = $2`,
    [id, salonId],
  );
  const row = result.rows[0];
  if (!row?.image || !row.image_type || !ALLOWED_TYPES.has(row.image_type as ImageContentType)) {
    return null;
  }
  return {
    bytes: Buffer.isBuffer(row.image) ? row.image : Buffer.from(row.image),
    contentType: row.image_type as ImageContentType,
  };
}
