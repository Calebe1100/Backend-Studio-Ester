import { Pool } from 'pg';
import { getPool } from '../db/pool';
import { HttpError } from '../lib/httpError';

export type NotificationDraft = {
  userId: string;
  title: string;
  body: string;
  href?: string | null;
};

export type NotificationDTO = {
  id: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function db(pool?: Pool) {
  return pool ?? getPool();
}

export async function recordNotifications(
  salonId: string,
  items: NotificationDraft[],
  pool?: Pool,
): Promise<void> {
  const rows = items.filter((item) => item.userId && item.title && item.body);
  if (rows.length === 0) return;

  const values: unknown[] = [];
  const placeholders = rows.map((item, index) => {
    const base = index * 5;
    values.push(salonId, item.userId, item.title, item.body, item.href ?? null);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });

  await db(pool).query(
    `INSERT INTO notifications (salon_id, user_id, title, body, href)
     VALUES ${placeholders.join(', ')}`,
    values,
  );
}

export async function listUnseenNotifications(
  salonId: string,
  userId: string,
  limit = 15,
  pool?: Pool,
): Promise<NotificationDTO[]> {
  const cap = Math.min(Math.max(limit, 1), 30);
  const result = await db(pool).query<{
    id: string;
    title: string;
    body: string;
    href: string | null;
    created_at: Date;
  }>(
    `SELECT id, title, body, href, created_at
     FROM notifications
     WHERE salon_id = $1 AND user_id = $2 AND seen_at IS NULL
     ORDER BY created_at DESC
     LIMIT $3`,
    [salonId, userId, cap],
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    href: row.href,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function markNotificationsSeen(
  salonId: string,
  userId: string,
  ids?: string[],
  pool?: Pool,
): Promise<void> {
  if (ids && ids.length === 0) return;
  if (ids?.some((id) => !UUID_RE.test(id))) {
    throw new HttpError(400, 'Identificador de notificação inválido.');
  }

  if (ids) {
    await db(pool).query(
      `UPDATE notifications
       SET seen_at = NOW()
       WHERE salon_id = $1 AND user_id = $2 AND seen_at IS NULL AND id = ANY($3::uuid[])`,
      [salonId, userId, ids],
    );
    return;
  }

  await db(pool).query(
    `UPDATE notifications
     SET seen_at = NOW()
     WHERE salon_id = $1 AND user_id = $2 AND seen_at IS NULL`,
    [salonId, userId],
  );
}
