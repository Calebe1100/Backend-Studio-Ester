/**
 * Rate limit em memória por chave (ex.: IP). Suficiente para um único processo;
 * em múltiplas instâncias cada uma mantém sua própria contagem.
 */
type Bucket = { count: number; resetAt: number };

export type RateLimiter = {
  /** Registra uma tentativa e devolve se ainda está dentro do limite. */
  hit: (key: string) => { allowed: boolean; retryAfterSec: number };
  reset: () => void;
};

export function createRateLimiter(options: { max: number; windowMs: number }): RateLimiter {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  function sweep(now: number) {
    // Limpa entradas expiradas no máximo uma vez por janela para não crescer sem limite.
    if (now - lastSweep < options.windowMs) return;
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    hit(key) {
      const now = Date.now();
      sweep(now);

      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + options.windowMs });
        return { allowed: true, retryAfterSec: 0 };
      }

      bucket.count += 1;
      if (bucket.count > options.max) {
        return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
      }
      return { allowed: true, retryAfterSec: 0 };
    },
    reset() {
      buckets.clear();
    },
  };
}

/** IP do cliente considerando proxies (Railway/Vercel setam x-forwarded-for). */
export function clientIp(req: { headers: Record<string, unknown>; ip?: string }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}
