/**
 * A per-key token bucket, in memory.
 *
 * Toy-grade on purpose: Azure Static Web Apps may run the function on more
 * than one instance and each keeps its own buckets, so the effective limit is
 * somewhat higher than the nominal one. That is fine for a button. If the
 * site ever needs a real cap, the README points at Table Storage.
 */
export function createRateLimiter({ capacity = 20, refillPerSecond = capacity / 60, now = Date.now } = {}) {
  /** @type {Map<string, {tokens: number, at: number}>} */
  const buckets = new Map();

  /** Drops buckets that have fully refilled, so the map does not grow forever. */
  const sweep = (t) => {
    if (buckets.size < 1000) return;
    for (const [key, b] of buckets) {
      if ((t - b.at) / 1000 * refillPerSecond >= capacity) buckets.delete(key);
    }
  };

  return {
    /**
     * @param {string} key
     * @returns {{ok: true} | {ok: false, retryAfterSeconds: number}}
     */
    take(key) {
      const t = now();
      sweep(t);
      const b = buckets.get(key) ?? { tokens: capacity, at: t };
      b.tokens = Math.min(capacity, b.tokens + ((t - b.at) / 1000) * refillPerSecond);
      b.at = t;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        buckets.set(key, b);
        return { ok: true };
      }
      buckets.set(key, b);
      return { ok: false, retryAfterSeconds: Math.ceil((1 - b.tokens) / refillPerSecond) };
    },
  };
}

/** The client address as SWA forwards it. */
export function clientKey(request) {
  const fwd = request.headers.get('x-forwarded-for') ?? '';
  const first = fwd.split(',')[0].trim();
  return first || request.headers.get('x-client-ip') || 'anonymous';
}
