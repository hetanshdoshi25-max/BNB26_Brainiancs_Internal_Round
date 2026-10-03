import { z } from "zod";

/* Behavioral signals are aggregate statistics only (no raw keystrokes or coordinates).
 * The server recomputes the score from these features rather than trusting a client score.
 * It is a soft signal for auditing and review: it never blocks anyone, because real people
 * (keyboard-only, screen-reader, touch users) can legitimately score low and bots can fake it. */
export const signalsSchema = z.object({
  elapsedMs: z.number().min(0).max(86_400_000),
  pointerMoves: z.number().int().min(0).max(1_000_000),
  angleEntropy: z.number().min(0).max(3),
  speedCv: z.number().min(0).max(100),
  keyCount: z.number().int().min(0).max(1_000_000),
  dwellStd: z.number().min(0).max(10_000),
  flightStd: z.number().min(0).max(10_000),
  touch: z.boolean(),
  pasted: z.boolean(),
}).partial();

export type Signals = z.infer<typeof signalsSchema>;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** 0–100, or null when no signal payload was sent at all. */
export function humanScore(input: unknown): number | null {
  if (input === undefined || input === null) return null;
  const parsed = signalsSchema.safeParse(input);
  if (!parsed.success) return null;
  const s = parsed.data;
  const time = clamp(((s.elapsedMs ?? 0) - 800) / 3200);
  const channels: number[] = [];
  if ((s.pointerMoves ?? 0) > 0) {
    const cv = s.speedCv ?? 0;
    channels.push(0.4 * clamp((s.pointerMoves ?? 0) / 30) + 0.4 * clamp((s.angleEntropy ?? 0) / 2) + 0.2 * (cv >= 0.25 && cv <= 4 ? 1 : 0));
  }
  if ((s.keyCount ?? 0) >= 4) {
    channels.push(0.5 * clamp((s.dwellStd ?? 0) / 15) + 0.5 * clamp((s.flightStd ?? 0) / 40));
  }
  if (!channels.length) return Math.round(100 * 0.25 * time * 0.6);
  const interaction = channels.reduce((sum, value) => sum + value, 0) / channels.length;
  return Math.round(100 * (0.25 * time + 0.75 * interaction));
}
