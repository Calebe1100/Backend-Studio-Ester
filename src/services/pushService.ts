import { Pool } from 'pg';
import webpush from 'web-push';
import { getPool } from '../db/pool';
import { env } from '../config/env';
import { HttpError } from '../lib/httpError';

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type PushRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function db(pool?: Pool) {
  return pool ?? getPool();
}

export function isVapidConfigured(): boolean {
  return Boolean(env.vapid.publicKey && env.vapid.privateKey);
}

function configureWebPush(): void {
  if (!isVapidConfigured()) return;
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);
}

export async function savePushSubscription(
  userId: string,
  input: PushSubscriptionInput,
  userAgent?: string,
  pool?: Pool,
): Promise<void> {
  const endpoint = input.endpoint?.trim();
  const p256dh = input.keys?.p256dh?.trim();
  const auth = input.keys?.auth?.trim();
  if (!endpoint || !p256dh || !auth) {
    throw new HttpError(400, 'Subscription de push inválida.');
  }

  await db(pool).query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent`,
    [userId, endpoint, p256dh, auth, userAgent?.slice(0, 400) || null],
  );
}

export async function deletePushSubscription(
  userId: string,
  endpoint: string,
  pool?: Pool,
): Promise<void> {
  const ep = endpoint?.trim();
  if (!ep) throw new HttpError(400, 'Informe o endpoint da subscription.');
  await db(pool).query(
    `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
    [userId, ep],
  );
}

async function deleteByEndpoint(endpoint: string, pool?: Pool): Promise<void> {
  await db(pool).query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export async function listSubscriptionsForUsers(
  userIds: string[],
  pool?: Pool,
): Promise<PushRow[]> {
  if (userIds.length === 0) return [];
  const result = await db(pool).query<PushRow>(
    `SELECT id, user_id, endpoint, p256dh, auth
     FROM push_subscriptions
     WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  return result.rows;
}

export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
  pool?: Pool,
): Promise<void> {
  if (!isVapidConfigured()) {
    console.log('[push] VAPID não configurado — push ignorado');
    return;
  }
  configureWebPush();

  const rows = await listSubscriptionsForUsers(userIds, pool);
  if (rows.length === 0) return;

  const data = JSON.stringify(payload);
  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          data,
        );
      } catch (err: unknown) {
        const statusCode =
          err && typeof err === 'object' && 'statusCode' in err
            ? Number((err as { statusCode: number }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await deleteByEndpoint(row.endpoint, pool);
          return;
        }
        console.error('[push] Falha ao enviar para', row.endpoint.slice(0, 48), err);
      }
    }),
  );
}
