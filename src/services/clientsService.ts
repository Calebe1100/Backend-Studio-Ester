import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';

export type ClientDTO = {
  id: string;
  name: string;
  phone: string;
  notes: string;
  active: boolean;
};

type ClientRow = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
};

function mapClient(row: ClientRow): ClientDTO {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? '',
    notes: row.notes ?? '',
    active: row.active,
  };
}

function db(pool?: Pool) {
  return pool ?? getPool();
}

export async function listClients(salonId: string, pool?: Pool): Promise<ClientDTO[]> {
  const result = await db(pool).query<ClientRow>(
    `SELECT id, name, phone, notes, active
     FROM clients
     WHERE salon_id = $1
     ORDER BY active DESC, name ASC`,
    [salonId],
  );
  return result.rows.map(mapClient);
}

export async function createClient(
  salonId: string,
  input: { name: string; phone?: string; notes?: string },
  pool?: Pool,
): Promise<ClientDTO> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do cliente.');

  const result = await db(pool).query<ClientRow>(
    `INSERT INTO clients (salon_id, name, phone, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, phone, notes, active`,
    [salonId, name, input.phone?.trim() || null, input.notes?.trim() || null],
  );
  return mapClient(result.rows[0]);
}

export async function updateClient(
  salonId: string,
  id: string,
  input: { name: string; phone?: string; notes?: string },
  pool?: Pool,
): Promise<ClientDTO> {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) throw new HttpError(400, 'Informe o nome do cliente.');

  const result = await db(pool).query<ClientRow>(
    `UPDATE clients
     SET name = $3, phone = $4, notes = $5
     WHERE id = $1 AND salon_id = $2
     RETURNING id, name, phone, notes, active`,
    [id, salonId, name, input.phone?.trim() || null, input.notes?.trim() || null],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Cliente não encontrado.');
  return mapClient(result.rows[0]);
}

export async function setClientActive(
  salonId: string,
  id: string,
  active: boolean,
  pool?: Pool,
): Promise<ClientDTO> {
  const result = await db(pool).query<ClientRow>(
    `UPDATE clients SET active = $3
     WHERE id = $1 AND salon_id = $2
     RETURNING id, name, phone, notes, active`,
    [id, salonId, active],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Cliente não encontrado.');
  return mapClient(result.rows[0]);
}

/** Busca por telefone ou cria cliente (fluxo de agendamento rápido). */
export async function findOrCreateClient(
  salonId: string,
  input: { name: string; phone?: string },
  pool?: Pool,
): Promise<ClientDTO> {
  const phone = input.phone?.trim() || '';
  if (phone) {
    const existing = await db(pool).query<ClientRow>(
      `SELECT id, name, phone, notes, active
       FROM clients
       WHERE salon_id = $1 AND phone = $2 AND active = TRUE
       LIMIT 1`,
      [salonId, phone],
    );
    if (existing.rows[0]) return mapClient(existing.rows[0]);
  }
  return createClient(salonId, input, pool);
}
