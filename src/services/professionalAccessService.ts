import { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';
import { pgTimeToHHMM } from '../lib/time';
import type { AppointmentDTO } from './appointmentsService';
import type { ClientDTO, ClientKind, ClientSummary } from './clientsService';
import { createProfessional, updateProfessional } from './professionalsService';
import type { ServiceDTO } from './servicesService';

export type ProfessionalPermissions = {
  agendaPropria: true;
  agendaEquipe: boolean;
  clienteContato: boolean;
  listaClientes: boolean;
  precos: boolean;
  agendar: boolean;
};

export type ProfessionalAccessDTO = {
  professionalId: string;
  revoked: boolean;
  workStart: string;
  workEnd: string;
  workDays: number[];
  serviceIds: string[];
  agendaEquipe: boolean;
  clienteContato: boolean;
  listaClientes: boolean;
  precos: boolean;
  agendar: boolean;
};

export type AccountRole = 'dono' | 'recepcao' | 'profissional' | 'cliente';

export type AccountDTO = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: AccountRole;
  active: boolean;
  professionalAccess: ProfessionalAccessDTO | null;
};

export type LiveAccount = {
  id: string;
  name: string;
  email: string;
  role: AccountRole;
  active: boolean;
  professionalId: string | null;
  permissions: ProfessionalPermissions | null;
};

export type AccessInput = {
  workStart?: string;
  workEnd?: string;
  workDays?: number[];
  serviceIds?: string[];
  professionalId?: string | null;
  agendaEquipe?: boolean;
  clienteContato?: boolean;
  listaClientes?: boolean;
  precos?: boolean;
  agendar?: boolean;
  agenda_equipe?: boolean;
  cliente_contato?: boolean;
  lista_clientes?: boolean;
};

type Queryable = Pool | PoolClient;

const DEFAULT_FLAGS = {
  agendaEquipe: false,
  clienteContato: false,
  listaClientes: false,
  precos: false,
  agendar: true,
};

export function defaultPermissions(): ProfessionalPermissions {
  return { agendaPropria: true, ...DEFAULT_FLAGS };
}

export function firstName(name: string): string {
  const token = name.trim().split(/\s+/)[0];
  return token || 'Cliente';
}

function db(pool?: Queryable): Queryable {
  return pool ?? getPool();
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function parseAccessFlags(input: AccessInput): Omit<ProfessionalPermissions, 'agendaPropria'> {
  return {
    agendaEquipe: flag(input.agendaEquipe ?? input.agenda_equipe, DEFAULT_FLAGS.agendaEquipe),
    clienteContato: flag(input.clienteContato ?? input.cliente_contato, DEFAULT_FLAGS.clienteContato),
    listaClientes: flag(input.listaClientes ?? input.lista_clientes, DEFAULT_FLAGS.listaClientes),
    precos: flag(input.precos, DEFAULT_FLAGS.precos),
    agendar: flag(input.agendar, DEFAULT_FLAGS.agendar),
  };
}

export function permissionsFromFlags(
  flags: Omit<ProfessionalPermissions, 'agendaPropria'>,
): ProfessionalPermissions {
  return { agendaPropria: true, ...flags };
}

type Viewer = {
  role: string;
  professionalId: string | null;
  permissions: ProfessionalPermissions | null;
};

export type AppointmentView = Omit<AppointmentDTO, 'servicePriceSnapshot'> & {
  clientName: string;
  clientKind: ClientKind;
  servicePriceSnapshot: number | null;
};

function resolveClient(client: string | ClientSummary | undefined): ClientSummary {
  if (!client) return { name: 'Cliente', kind: 'cadastrado' };
  if (typeof client === 'string') return { name: client, kind: 'cadastrado' };
  return client;
}

/** Omite preço, contato e nome completo conforme a concessão. Dono e recepção não são reduzidos. */
export function presentAppointment(
  appointment: AppointmentDTO,
  client: string | ClientSummary | undefined,
  viewer: Viewer,
): AppointmentView {
  const summary = resolveClient(client);
  const fullName = summary.name.trim() || 'Cliente';
  if (viewer.role !== 'profissional' || !viewer.permissions) {
    return { ...appointment, clientName: fullName, clientKind: summary.kind };
  }

  const own = appointment.professionalId === viewer.professionalId;
  const showContact = viewer.permissions.clienteContato;
  return {
    ...appointment,
    clientName: showContact ? fullName : firstName(fullName),
    clientKind: summary.kind,
    notes: own || showContact ? appointment.notes : '',
    servicePriceSnapshot: viewer.permissions.precos ? appointment.servicePriceSnapshot : null,
  };
}

export function presentService<T extends ServiceDTO>(
  service: T,
  viewer: Viewer,
): Omit<T, 'price'> & { price: number | null } {
  if (viewer.role === 'profissional' && viewer.permissions && !viewer.permissions.precos) {
    return { ...service, price: null };
  }
  return service;
}

/** A lista de clientes da profissional não inclui e-mail nem o id da conta. */
export function presentClient(client: ClientDTO): ClientDTO {
  return { ...client, email: '', userId: null };
}

function normalizeWorkDays(value: number[] | null | undefined): number[] {
  if (!value || value.length === 0) return [0, 1, 2, 3, 4, 5, 6];
  return value.map(Number);
}

type AccessRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: AccountRole;
  active: boolean;
  professional_id: string | null;
  agenda_equipe: boolean | null;
  cliente_contato: boolean | null;
  lista_clientes: boolean | null;
  precos: boolean | null;
  agendar: boolean | null;
  revoked_at: Date | null;
  work_start: string | Date | null;
  work_end: string | Date | null;
  work_days: number[] | null;
};

const ACCOUNT_SELECT = `
  SELECT u.id, u.name, u.email, u.phone, u.role, u.active,
         pa.professional_id, pa.agenda_equipe, pa.cliente_contato, pa.lista_clientes,
         pa.precos, pa.agendar, pa.revoked_at,
         p.work_start, p.work_end, p.work_days
  FROM users u
  LEFT JOIN professional_access pa ON pa.user_id = u.id
  LEFT JOIN professionals p ON p.id = pa.professional_id
`;

async function attachServiceIds(
  accounts: AccountDTO[],
  pool?: Queryable,
): Promise<void> {
  const ids = accounts
    .map((account) => account.professionalAccess?.professionalId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;

  const result = await db(pool).query<{ professional_id: string; service_id: string }>(
    `SELECT professional_id, service_id
     FROM professional_services
     WHERE professional_id = ANY($1::uuid[])`,
    [ids],
  );
  const map = new Map<string, string[]>();
  for (const row of result.rows) {
    const list = map.get(row.professional_id) ?? [];
    list.push(row.service_id);
    map.set(row.professional_id, list);
  }
  for (const account of accounts) {
    if (!account.professionalAccess) continue;
    account.professionalAccess.serviceIds = map.get(account.professionalAccess.professionalId) ?? [];
  }
}

function mapAccount(row: AccessRow): AccountDTO {
  const access = row.professional_id
    ? {
        professionalId: row.professional_id,
        revoked: row.revoked_at != null,
        workStart: row.work_start ? pgTimeToHHMM(row.work_start) : '09:00',
        workEnd: row.work_end ? pgTimeToHHMM(row.work_end) : '18:00',
        workDays: normalizeWorkDays(row.work_days),
        serviceIds: [] as string[],
        agendaEquipe: Boolean(row.agenda_equipe),
        clienteContato: Boolean(row.cliente_contato),
        listaClientes: Boolean(row.lista_clientes),
        precos: Boolean(row.precos),
        agendar: row.agendar !== false,
      }
    : null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? '',
    role: row.role,
    active: row.active,
    professionalAccess: access,
  };
}

export async function listAccounts(
  salonId: string,
  query = '',
  pool?: Queryable,
): Promise<AccountDTO[]> {
  const term = query.trim();
  const pattern = term ? `%${term.replace(/[%_\\]/g, '')}%` : null;
  const digits = term.replace(/\D/g, '');
  const result = await db(pool).query<AccessRow>(
    `${ACCOUNT_SELECT}
     WHERE u.salon_id = $1
       AND (
         $2::text IS NULL
         OR u.name ILIKE $2
         OR u.email ILIKE $2
         OR COALESCE(u.phone, '') ILIKE $2
         OR ($3::text <> '' AND regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE '%' || $3 || '%')
       )
     ORDER BY u.active DESC, u.name ASC`,
    [salonId, pattern, digits],
  );
  const accounts = result.rows.map(mapAccount);
  await attachServiceIds(accounts, pool);
  return accounts;
}

async function readAccount(salonId: string, userId: string, pool?: Queryable): Promise<AccountDTO | null> {
  const result = await db(pool).query<AccessRow>(
    `${ACCOUNT_SELECT}
     WHERE u.salon_id = $1 AND u.id = $2`,
    [salonId, userId],
  );
  if (!result.rows[0]) return null;
  const account = mapAccount(result.rows[0]);
  await attachServiceIds([account], pool);
  return account;
}

export async function loadLiveAccount(
  salonId: string,
  userId: string,
  pool?: Queryable,
): Promise<LiveAccount | null> {
  const user = await db(pool).query<{
    id: string;
    name: string;
    email: string;
    role: AccountRole;
    active: boolean;
  }>(
    `SELECT id, name, email, role, active
     FROM users
     WHERE id = $1 AND salon_id = $2`,
    [userId, salonId],
  );
  const row = user.rows[0];
  if (!row) return null;

  const account: LiveAccount = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    professionalId: null,
    permissions: null,
  };

  if (row.role !== 'profissional') return account;

  const access = await db(pool).query<{
    professional_id: string;
    agenda_equipe: boolean;
    cliente_contato: boolean;
    lista_clientes: boolean;
    precos: boolean;
    agendar: boolean;
  }>(
    `SELECT pa.professional_id, pa.agenda_equipe, pa.cliente_contato,
            pa.lista_clientes, pa.precos, pa.agendar
     FROM professional_access pa
     JOIN professionals p ON p.id = pa.professional_id
     WHERE pa.user_id = $1 AND pa.revoked_at IS NULL AND p.salon_id = $2`,
    [userId, salonId],
  );

  if (access.rows[0]) {
    const flags = access.rows[0];
    account.professionalId = flags.professional_id;
    account.permissions = permissionsFromFlags({
      agendaEquipe: flags.agenda_equipe,
      clienteContato: flags.cliente_contato,
      listaClientes: flags.lista_clientes,
      precos: flags.precos,
      agendar: flags.agendar,
    });
    return account;
  }

  const legacy = await db(pool).query<{ id: string }>(
    `SELECT id FROM professionals
     WHERE salon_id = $1 AND user_id = $2
     ORDER BY active DESC
     LIMIT 1`,
    [salonId, userId],
  );
  account.professionalId = legacy.rows[0]?.id ?? null;
  account.permissions = defaultPermissions();
  return account;
}

async function withTransaction<T>(pool: Pool | undefined, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await (pool ?? getPool()).connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function scheduleOf(input: AccessInput) {
  const workStart = input.workStart ?? '';
  const workEnd = input.workEnd ?? '';
  return {
    workStart,
    workEnd,
    workDays: input.workDays,
    serviceIds: Array.isArray(input.serviceIds) ? input.serviceIds.map(String) : [],
  };
}

async function saveProfessional(
  client: PoolClient,
  salonId: string,
  user: { id: string; name: string },
  input: AccessInput,
  existingId: string | null,
): Promise<string> {
  const schedule = scheduleOf(input);
  const payload = {
    name: user.name,
    ...schedule,
    userId: user.id,
  };

  if (existingId) {
    await updateProfessional(salonId, existingId, payload, client as unknown as Pool);
    await client.query(`UPDATE professionals SET active = TRUE WHERE id = $1 AND salon_id = $2`, [
      existingId,
      salonId,
    ]);
    return existingId;
  }

  if (input.professionalId) {
    const linked = await client.query<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM professionals
       WHERE id = $1 AND salon_id = $2
       FOR UPDATE`,
      [input.professionalId, salonId],
    );
    if (!linked.rows[0]) throw new HttpError(404, 'Ficha de profissional não encontrada.');
    if (linked.rows[0].user_id && linked.rows[0].user_id !== user.id) {
      throw new HttpError(409, 'Esta ficha já está vinculada a outra conta.');
    }
    await updateProfessional(salonId, linked.rows[0].id, payload, client as unknown as Pool);
    await client.query(`UPDATE professionals SET active = TRUE WHERE id = $1 AND salon_id = $2`, [
      linked.rows[0].id,
      salonId,
    ]);
    return linked.rows[0].id;
  }

  const created = await createProfessional(salonId, payload, client as unknown as Pool);
  return created.id;
}

async function upsertAccess(
  client: PoolClient,
  professionalId: string,
  userId: string,
  actorId: string,
  flags: Omit<ProfessionalPermissions, 'agendaPropria'>,
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO professional_access (
         professional_id, user_id, agenda_equipe, cliente_contato, lista_clientes,
         precos, agendar, granted_by, granted_at, revoked_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NULL)
       ON CONFLICT (professional_id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         agenda_equipe = EXCLUDED.agenda_equipe,
         cliente_contato = EXCLUDED.cliente_contato,
         lista_clientes = EXCLUDED.lista_clientes,
         precos = EXCLUDED.precos,
         agendar = EXCLUDED.agendar,
         granted_by = EXCLUDED.granted_by,
         granted_at = NOW(),
         revoked_at = NULL`,
      [
        professionalId,
        userId,
        flags.agendaEquipe,
        flags.clienteContato,
        flags.listaClientes,
        flags.precos,
        flags.agendar,
        actorId,
      ],
    );
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw new HttpError(409, 'Esta conta já está vinculada a outra ficha.');
    }
    throw err;
  }
}

export async function grantProfessionalAccess(
  salonId: string,
  actorId: string,
  userId: string,
  input: AccessInput,
  pool?: Pool,
): Promise<AccountDTO> {
  const flags = parseAccessFlags(input);
  await withTransaction(pool, async (client) => {
    const user = await client.query<{ id: string; name: string; role: AccountRole; active: boolean }>(
      `SELECT id, name, role, active
       FROM users
       WHERE id = $1 AND salon_id = $2
       FOR UPDATE`,
      [userId, salonId],
    );
    const row = user.rows[0];
    if (!row) throw new HttpError(404, 'Usuário não encontrado.');
    if (!row.active) throw new HttpError(409, 'Conta inativa não recebe acesso de profissional.');
    if (row.role === 'dono' || row.role === 'recepcao') {
      throw new HttpError(409, 'Esta conta não pode receber acesso de profissional.');
    }
    if (row.role === 'profissional') {
      throw new HttpError(409, 'Esta conta já tem acesso de profissional.');
    }

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM professionals
       WHERE salon_id = $1 AND user_id = $2
       LIMIT 1`,
      [salonId, userId],
    );
    if (
      input.professionalId &&
      existing.rows[0] &&
      existing.rows[0].id !== input.professionalId
    ) {
      throw new HttpError(409, 'Esta conta já tem uma ficha de profissional.');
    }

    const professionalId = await saveProfessional(
      client,
      salonId,
      row,
      input,
      existing.rows[0]?.id ?? null,
    );
    await upsertAccess(client, professionalId, row.id, actorId, flags);
    await client.query(
      `UPDATE users SET role = 'profissional', updated_at = NOW()
       WHERE id = $1 AND salon_id = $2`,
      [row.id, salonId],
    );
  });

  const account = await readAccount(salonId, userId, pool);
  if (!account) throw new HttpError(404, 'Usuário não encontrado.');
  return account;
}

export async function updateProfessionalAccess(
  salonId: string,
  actorId: string,
  userId: string,
  input: AccessInput,
  pool?: Pool,
): Promise<AccountDTO> {
  const flags = parseAccessFlags(input);
  await withTransaction(pool, async (client) => {
    const current = await client.query<{ id: string; name: string; role: AccountRole }>(
      `SELECT id, name, role
       FROM users
       WHERE id = $1 AND salon_id = $2
       FOR UPDATE`,
      [userId, salonId],
    );
    const user = current.rows[0];
    if (!user || user.role !== 'profissional') {
      throw new HttpError(404, 'Esta conta não tem acesso de profissional vigente.');
    }

    const linked = await client.query<{ id: string }>(
      `SELECT p.id
       FROM professionals p
       LEFT JOIN professional_access pa ON pa.professional_id = p.id
       WHERE p.salon_id = $1 AND p.user_id = $2
         AND (pa.revoked_at IS NULL OR pa.professional_id IS NULL)
       LIMIT 1`,
      [salonId, userId],
    );

    const professionalId = await saveProfessional(
      client,
      salonId,
      user,
      input,
      linked.rows[0]?.id ?? null,
    );
    const existingAccess = await client.query(
      `SELECT professional_id FROM professional_access
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    if (existingAccess.rows[0]) {
      await client.query(
        `UPDATE professional_access
         SET agenda_equipe = $2, cliente_contato = $3, lista_clientes = $4, precos = $5, agendar = $6
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, flags.agendaEquipe, flags.clienteContato, flags.listaClientes, flags.precos, flags.agendar],
      );
    } else {
      await upsertAccess(client, professionalId, userId, actorId, flags);
    }
  });

  const account = await readAccount(salonId, userId, pool);
  if (!account) throw new HttpError(404, 'Usuário não encontrado.');
  return account;
}

export async function revokeProfessionalAccess(
  salonId: string,
  userId: string,
  pool?: Pool,
): Promise<AccountDTO> {
  await withTransaction(pool, async (client) => {
    const current = await client.query<{ professional_id: string }>(
      `UPDATE professional_access pa
       SET revoked_at = NOW()
       FROM users u
       WHERE pa.user_id = u.id
         AND pa.revoked_at IS NULL
         AND u.id = $1
         AND u.salon_id = $2
         AND u.role = 'profissional'
       RETURNING pa.professional_id`,
      [userId, salonId],
    );
    if (!current.rows[0]) throw new HttpError(404, 'Esta conta não tem acesso de profissional vigente.');

    await client.query(
      `UPDATE professionals SET active = FALSE WHERE id = $1 AND salon_id = $2`,
      [current.rows[0].professional_id, salonId],
    );
    await client.query(
      `UPDATE users SET role = 'cliente', updated_at = NOW()
       WHERE id = $1 AND salon_id = $2`,
      [userId, salonId],
    );
  });

  const account = await readAccount(salonId, userId, pool);
  if (!account) throw new HttpError(404, 'Usuário não encontrado.');
  return account;
}
