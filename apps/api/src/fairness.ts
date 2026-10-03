import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { redis } from "./redis";

/* ───────────── Verifiable draw (commit–reveal) ─────────────
 * Algorithm (mirrored byte-for-byte in apps/web/src/lib/verifiableDraw.ts):
 *   stream block k = SHA-256(utf8(`${seed}:${k}`)), read as 8 big-endian uint32s
 *   uniform(bound) = rejection-sample a uint32 below the largest multiple of bound
 *   ids are sorted by UTF-16 code unit, then Fisher–Yates from the end
 *   rank = position + 1
 */
export const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export function newDrawSeed() {
  const seed = randomBytes(32).toString("hex");
  return { seed, seedHash: sha256Hex(seed) };
}

function seededUint32(seed: string) {
  let block = 0;
  let words: number[] = [];
  return () => {
    if (!words.length) {
      const digest = createHash("sha256").update(`${seed}:${block++}`, "utf8").digest();
      words = Array.from({ length: 8 }, (_, i) => digest.readUInt32BE(i * 4));
    }
    return words.shift()!;
  };
}

export function seededShuffle(ids: string[], seed: string) {
  const next = seededUint32(seed);
  const uniform = (bound: number) => {
    const limit = 2 ** 32 - (2 ** 32 % bound);
    for (;;) {
      const value = next();
      if (value < limit) return value % bound;
    }
  };
  const items = [...ids].sort();
  for (let i = items.length - 1; i > 0; i--) {
    const j = uniform(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/* ───────────── Live traffic + per-account request volume ───────────── */
export type JoinOutcome = "accepted" | "throttled" | "rejected";
const TRAFFIC_TTL = 60 * 60;
const ATTEMPTS_TTL = 14 * 24 * 60 * 60;

export function recordJoinAttempt(dropId: string, userId: string, outcome: JoinOutcome) {
  const second = Math.floor(Date.now() / 1000);
  const key = `traffic:${dropId}:${second}`;
  void redis.multi()
    .hincrby(key, outcome, 1).expire(key, TRAFFIC_TTL)
    .hincrby(`attempts:${dropId}`, userId, 1).expire(`attempts:${dropId}`, ATTEMPTS_TTL)
    .exec()
    .catch((error) => console.error("Could not record join traffic", error));
}

export async function trafficSeries(dropId: string, seconds = 120) {
  const now = Math.floor(Date.now() / 1000);
  const pipeline = redis.pipeline();
  for (let s = now - seconds + 1; s <= now; s++) pipeline.hgetall(`traffic:${dropId}:${s}`);
  const results = (await pipeline.exec()) ?? [];
  return results.map(([, value], index) => {
    const row = (value ?? {}) as Record<string, string>;
    return { t: now - seconds + 1 + index, accepted: Number(row.accepted ?? 0), throttled: Number(row.throttled ?? 0), rejected: Number(row.rejected ?? 0) };
  });
}

/* ───────────── Fairness report ───────────── */
type Bucket = { label: string; detail: string; entrants: number; winners: number; winRate: number | null };

function bucket(label: string, detail: string, members: Array<{ won: boolean }>, drawn: boolean): Bucket {
  const winners = members.filter((member) => member.won).length;
  return { label, detail, entrants: members.length, winners, winRate: drawn && members.length ? winners / members.length : null };
}

/** Spearman rank correlation between arrival order and draw rank (no ties). */
function spearman(pairs: Array<{ arrival: number; rank: number }>) {
  const n = pairs.length;
  if (n < 3) return null;
  let sum = 0;
  for (const pair of pairs) sum += (pair.arrival - pair.rank) ** 2;
  return 1 - (6 * sum) / (n * (n * n - 1));
}

export const HUMAN_BANDS = [
  { label: "No signal", detail: "Sent no interaction data (scripts, API clients)", test: (s: number | null) => s === null },
  { label: "Low", detail: "Score below 40", test: (s: number | null) => s !== null && s < 40 },
  { label: "Medium", detail: "Score 40–69", test: (s: number | null) => s !== null && s >= 40 && s < 70 },
  { label: "High", detail: "Score 70 or more", test: (s: number | null) => s !== null && s >= 70 },
];

export async function fairnessReport(dropId: string) {
  const drop = await prisma.drop.findUnique({ where: { id: dropId }, select: { id: true, capacity: true, status: true, allocationPolicy: true, drawCompletedAt: true } });
  if (!drop) return null;
  const [entries, attempts] = await Promise.all([
    prisma.entry.findMany({ where: { dropId }, select: { userId: true, rank: true, arrivalSequence: true, humanScore: true }, orderBy: { arrivalSequence: "asc" } }),
    redis.hgetall(`attempts:${dropId}`),
  ]);
  const drawn = !!drop.drawCompletedAt;
  const people = entries.map((entry, index) => ({
    arrival: index + 1,
    rank: entry.rank,
    won: entry.rank !== null && entry.rank <= drop.capacity,
    requests: Math.max(1, Number(attempts[entry.userId] ?? 1)),
    humanScore: entry.humanScore,
  }));
  const n = people.length;
  const ranked = people.filter((person): person is typeof person & { rank: number } => person.rank !== null);
  // Re-rank arrival among ranked entries only, so both sides run 1..n.
  const correlation = drawn ? spearman(ranked.map((person, index) => ({ arrival: index + 1, rank: person.rank }))) : null;
  const overallRate = drawn && n ? Math.min(1, drop.capacity / n) : null;

  const quintiles = Array.from({ length: 5 }, (_, q) => {
    const from = Math.floor((q * n) / 5);
    const to = Math.floor(((q + 1) * n) / 5);
    return bucket(`Q${q + 1}`, q === 0 ? "Earliest 20% to arrive" : q === 4 ? "Latest 20% to arrive" : `Arrival ${q * 20}–${(q + 1) * 20}%`, people.slice(from, to), drawn);
  });
  const volume = [
    bucket("1", "Sent one entry request", people.filter((p) => p.requests === 1), drawn),
    bucket("2–3", "Retried a little", people.filter((p) => p.requests >= 2 && p.requests <= 3), drawn),
    bucket("4+", "Hammered the endpoint", people.filter((p) => p.requests >= 4), drawn),
  ];
  const human = HUMAN_BANDS.map((band) => bucket(band.label, band.detail, people.filter((p) => band.test(p.humanScore)), drawn));

  const earlyCount = Math.max(1, Math.floor(n / 10));
  const early = people.slice(0, earlyCount);
  const earlyRate = drawn && n ? early.filter((p) => p.won).length / early.length : null;
  const lowSignal = people.filter((p) => p.humanScore === null || p.humanScore < 40);
  const totalWinners = people.filter((p) => p.won).length;

  return {
    dropId, policy: drop.allocationPolicy, status: drop.status, capacity: drop.capacity, entrants: n, drawn,
    correlation, overallRate,
    earlyBirdAdvantage: earlyRate !== null && overallRate ? earlyRate / overallRate : null,
    lowSignal: {
      entrants: lowSignal.length,
      entrantShare: n ? lowSignal.length / n : 0,
      seatShare: drawn && totalWinners ? lowSignal.filter((p) => p.won).length / totalWinners : null,
    },
    buckets: { arrival: quintiles, volume, human },
  };
}
