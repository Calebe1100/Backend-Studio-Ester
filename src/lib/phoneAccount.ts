import { Pool } from 'pg';
import { phoneLookupVariants } from './phone';

/** Dígitos do telefone como estão gravados, sem máscara nem zeros à esquerda. */
export function phoneDigitsSql(column: string): string {
  return `regexp_replace(regexp_replace(COALESCE(${column}, ''), '\\D', '', 'g'), '^0+', '')`;
}

/**
 * Localiza o usuário pelo celular. O telefone da equipe fica em `users.phone`
 * e o dos clientes em `clients.phone`.
 */
export async function findUserIdByPhone(
  db: Pool,
  phone: string,
  options?: { activeOnly?: boolean; excludeUserId?: string },
): Promise<string | null> {
  const variants = phoneLookupVariants(phone);
  if (variants.length === 0) return null;

  const result = await db.query<{ id: string }>(
    `SELECT u.id
       FROM users u
       LEFT JOIN clients c ON c.user_id = u.id
      WHERE ($2::boolean = FALSE OR u.active = TRUE)
        AND ($3::text IS NULL OR u.id::text <> $3)
        AND (
          ${phoneDigitsSql('u.phone')} = ANY($1::text[])
          OR ${phoneDigitsSql('c.phone')} = ANY($1::text[])
        )
      ORDER BY u.created_at ASC
      LIMIT 1`,
    [variants, options?.activeOnly ?? false, options?.excludeUserId ?? null],
  );

  return result.rows[0]?.id ?? null;
}
