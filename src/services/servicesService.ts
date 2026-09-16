import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';

export type ServiceDTO = {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  active: boolean;
};

type ServiceRow = {
  id: string;
  name: string;
  duration: number;
  price: string | number;
  active: boolean;
};

function mapService(row: ServiceRow): ServiceDTO {
  return {
    id: row.id,
    name: row.name,
    durationMinutes: row.duration,
    price: Number(row.price),
    active: row.active,
  };
}

function db(pool?: Pool) {
  return pool ?? getPool();
}

export async function listServices(salonId: string, pool?: Pool): Promise<ServiceDTO[]> {
  const result = await db(pool).query<ServiceRow>(
    `SELECT id, name, duration, price, active
     FROM services
     WHERE salon_id = $1
     ORDER BY active DESC, name ASC`,
    [salonId],
  );
  return result.rows.map(mapService);
}

export async function createService(
  salonId: string,
  input: { name: string; durationMinutes: number; price: number },
  pool?: Pool,
): Promise<ServiceDTO> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do serviço.');
  if (!input.durationMinutes || input.durationMinutes < 15) {
    throw new HttpError(400, 'A duração mínima é 15 minutos.');
  }
  if (input.price == null || input.price < 0) {
    throw new HttpError(400, 'O preço não pode ser negativo.');
  }

  const result = await db(pool).query<ServiceRow>(
    `INSERT INTO services (salon_id, name, duration, price)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, duration, price, active`,
    [salonId, name, input.durationMinutes, input.price],
  );
  return mapService(result.rows[0]);
}

export async function updateService(
  salonId: string,
  id: string,
  input: { name: string; durationMinutes: number; price: number },
  pool?: Pool,
): Promise<ServiceDTO> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do serviço.');
  if (!input.durationMinutes || input.durationMinutes < 15) {
    throw new HttpError(400, 'A duração mínima é 15 minutos.');
  }
  if (input.price == null || input.price < 0) {
    throw new HttpError(400, 'O preço não pode ser negativo.');
  }

  const result = await db(pool).query<ServiceRow>(
    `UPDATE services
     SET name = $3, duration = $4, price = $5, updated_at = NOW()
     WHERE id = $1 AND salon_id = $2
     RETURNING id, name, duration, price, active`,
    [id, salonId, name, input.durationMinutes, input.price],
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
     RETURNING id, name, duration, price, active`,
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
    `SELECT id, name, duration, price, active
     FROM services
     WHERE id = $1 AND salon_id = $2 AND active = TRUE`,
    [id, salonId],
  );
  if (!result.rows[0]) throw new HttpError(400, 'Selecione um serviço ativo.');
  return mapService(result.rows[0]);
}
