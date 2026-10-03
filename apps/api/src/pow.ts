import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { redis } from "./redis";

/* Proof-of-work: the browser must find a nonce so that SHA-256(`${challenge}:${nonce}`)
 * starts with `difficulty` zero bits. Challenges are stateless (HMAC-signed), short-lived
 * and single-use. Difficulty rises with how many challenges were issued in the last 10 s,
 * so a flood makes every scripted request cost more CPU while a lone human solves it in ms. */
export type PowAction = "register" | "join";

const secret = process.env.POW_SECRET ? Buffer.from(process.env.POW_SECRET) : randomBytes(32);
const BASE_BITS = Number(process.env.POW_BASE_BITS ?? 14);
const MAX_BITS = Number(process.env.POW_MAX_BITS ?? 20);
const TARGET_RPS = Number(process.env.POW_TARGET_RPS ?? 5);
const TTL_SECONDS = 120;
export const powEnabled = process.env.POW_ENABLED !== "false";

export const powSchema = z.object({
  token: z.string().max(200),
  signature: z.string().length(64),
  nonce: z.string().regex(/^\d{1,12}$/),
});

const sign = (token: string) => createHmac("sha256", secret).update(token).digest("hex");

async function recentLoad(action: PowAction) {
  const now = Math.floor(Date.now() / 1000);
  const values = await redis.mget(Array.from({ length: 10 }, (_, i) => `powload:${action}:${now - i}`));
  return values.reduce((sum, value) => sum + Number(value ?? 0), 0) / 10;
}

export async function currentDifficulty(action: PowAction) {
  const rps = await recentLoad(action);
  const extra = rps > TARGET_RPS ? Math.floor(Math.log2(rps / TARGET_RPS)) + 1 : 0;
  return { bits: Math.min(MAX_BITS, BASE_BITS + extra), requestsPerSecond: rps };
}

export async function issueChallenge(action: PowAction) {
  const second = Math.floor(Date.now() / 1000);
  void redis.multi().incr(`powload:${action}:${second}`).expire(`powload:${action}:${second}`, 30).exec().catch(() => undefined);
  const { bits } = await currentDifficulty(action);
  const challenge = randomBytes(16).toString("hex");
  const expiresAt = Date.now() + TTL_SECONDS * 1000;
  const token = `${action}.${challenge}.${bits}.${expiresAt}`;
  return { required: true as const, token, signature: sign(token), difficulty: bits, expiresAt, algorithm: "sha256-leading-zero-bits" };
}

function leadingZeroBits(digest: Buffer) {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/** Returns null when the proof is valid, otherwise a user-facing reason. */
export async function verifyProof(action: PowAction, proof: unknown) {
  const parsed = powSchema.safeParse(proof);
  if (!parsed.success) return "A quick security check is required. Please try again.";
  const { token, signature, nonce } = parsed.data;
  const expected = Buffer.from(sign(token), "hex");
  const given = Buffer.from(signature, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "The security check was not valid. Please try again.";
  const [tokenAction, challenge, bitsText, expiresText] = token.split(".");
  if (tokenAction !== action || !challenge) return "The security check was for a different action.";
  if (Date.now() > Number(expiresText)) return "The security check expired. Please try again.";
  const digest = createHash("sha256").update(`${challenge}:${nonce}`, "utf8").digest();
  if (leadingZeroBits(digest) < Number(bitsText)) return "The security check answer was wrong.";
  const fresh = await redis.set(`pow:used:${challenge}`, "1", "EX", TTL_SECONDS + 60, "NX");
  if (!fresh) return "That security check was already used. Please try again.";
  return null;
}
