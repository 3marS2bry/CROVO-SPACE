// Distributed Cloudflare KV fixed-window rate limiter (free-tier safe: 0 KV writes on GET)
// Falls back gracefully to in-memory Map in local Node dev/test environments.

import type { Env } from './types.ts';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface MemoryBucket {
  count: number;
  expiresAtMs: number;
}

const memoryBuckets = new Map<string, MemoryBucket>();

function pruneMemoryBuckets(nowMs: number): void {
  if (memoryBuckets.size < 1000) return;
  for (const [k, v] of memoryBuckets.entries()) {
    if (v.expiresAtMs <= nowMs) {
      memoryBuckets.delete(k);
    }
  }
}

export async function checkRateLimit(
  env: Partial<Env>,
  action: string,
  actorKey: string,
  maxRequests: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const safeWindowSec = Math.max(60, Math.floor(windowSeconds));
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const bucket = Math.floor(nowSec / safeWindowSec);
  const resetAt = (bucket + 1) * safeWindowSec * 1000;
  const key = `rl:${action}:${actorKey}:${bucket}`;

  const kv = env.RATE_LIMIT_KV;
  if (kv) {
    try {
      const existingRaw = await kv.get(key, { type: 'text' });
      const currentCount = existingRaw ? Math.max(0, parseInt(existingRaw, 10) || 0) : 0;
      if (currentCount >= maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          resetAt,
        };
      }
      const nextCount = currentCount + 1;
      await kv.put(key, String(nextCount), {
        expirationTtl: safeWindowSec + 30,
      });
      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - nextCount),
        resetAt,
      };
    } catch {
      // Fall through to in-memory limiter if KV hits transient error
    }
  }

  pruneMemoryBuckets(nowMs);
  const entry = memoryBuckets.get(key);
  const activeCount = entry && entry.expiresAtMs > nowMs ? entry.count : 0;
  if (activeCount >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
    };
  }
  const nextCount = activeCount + 1;
  memoryBuckets.set(key, {
    count: nextCount,
    expiresAtMs: resetAt + 5000,
  });

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - nextCount),
    resetAt,
  };
}
