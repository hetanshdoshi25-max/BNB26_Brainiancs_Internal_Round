import "./env";
import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
  // Resolve IPv4 and IPv6 alike; hosted private networks (e.g. Railway) may be IPv6-only.
  family: 0,
  retryStrategy: (attempt) => Math.min(attempt * 250, 3000),
});

const tokenBucket = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillPerMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local state = redis.call('HMGET', key, 'tokens', 'at')
local tokens = tonumber(state[1]) or capacity
local at = tonumber(state[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - at) * refillPerMs)
local allowed = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 end
redis.call('HSET', key, 'tokens', tokens, 'at', now)
redis.call('PEXPIRE', key, math.ceil(capacity / refillPerMs))
return {allowed, math.floor(tokens), math.ceil((cost - tokens) / refillPerMs)}
`;

export async function enforceBudget(keys: string[], capacity: number, refillEveryMs: number, cost = 1) {
  const now = Date.now();
  for (const key of keys) {
    const result = (await redis.eval(tokenBucket, 1, `budget:${key}`, now, capacity, 1 / refillEveryMs, cost)) as number[];
    if (result[0] !== 1) {
      const metric = redis.multi().incr("metrics:throttled").expire("metrics:throttled", 90 * 24 * 60 * 60).exec();
      void metric.catch((error) => console.error("Could not record a throttle metric", error));
      return { allowed: false, retryAfterMs: Math.max(500, Number(result[2] ?? refillEveryMs)) };
    }
  }
  return { allowed: true, retryAfterMs: 0 };
}

export async function redisHealth() {
  return redis.ping();
}
