import { api } from "./api";

type Challenge = { required: false } | { required: true; token: string; signature: string; difficulty: number };
export type PowProof = { token: string; signature: string; nonce: string };
export type PowResult = { proof: PowProof; difficulty: number; attempts: number; ms: number } | null;

/** Fetches a proof-of-work challenge and solves it off the main thread. Null when not required. */
export async function solvePow(action: "register" | "join", dropId?: string): Promise<PowResult> {
  const query = new URLSearchParams({ action, ...(dropId ? { dropId } : {}) });
  const challenge = await api<Challenge>(`/api/pow/challenge?${query}`);
  if (!challenge.required) return null;
  const [, challengeId] = challenge.token.split(".");
  const worker = new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" });
  try {
    const result = await new Promise<{ nonce: string; attempts: number; ms: number }>((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data);
      worker.onerror = (event) => reject(new Error(event.message || "The security check could not run."));
      worker.postMessage({ challenge: challengeId, difficulty: challenge.difficulty });
    });
    return { proof: { token: challenge.token, signature: challenge.signature, nonce: result.nonce }, difficulty: challenge.difficulty, attempts: result.attempts, ms: result.ms };
  } finally {
    worker.terminate();
  }
}
