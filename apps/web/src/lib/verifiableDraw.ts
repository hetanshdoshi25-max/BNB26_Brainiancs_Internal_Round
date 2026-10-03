// Browser re-implementation of the server's seeded draw (apps/api/src/fairness.ts).
// stream block k = SHA-256(`${seed}:${k}`) → 8 big-endian uint32s; Fisher–Yates over ids
// sorted by UTF-16 code unit; uniform() rejection-samples to avoid modulo bias.
const encoder = new TextEncoder();

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

class SeedStream {
  private words: number[] = [];
  private block = 0;
  constructor(private readonly seed: string) {}
  private async refill() {
    const blocks = Array.from({ length: 256 }, (_, i) => this.block + i);
    this.block += blocks.length;
    const digests = await Promise.all(blocks.map((k) => crypto.subtle.digest("SHA-256", encoder.encode(`${this.seed}:${k}`))));
    for (const digest of digests) {
      const view = new DataView(digest);
      for (let i = 0; i < 8; i++) this.words.push(view.getUint32(i * 4, false));
    }
  }
  async next() {
    if (!this.words.length) await this.refill();
    return this.words.shift()!;
  }
}

export async function seededShuffle(ids: string[], seed: string, onProgress?: (done: number) => void) {
  const stream = new SeedStream(seed);
  const items = [...ids].sort();
  for (let i = items.length - 1; i > 0; i--) {
    const bound = i + 1;
    const limit = 2 ** 32 - (2 ** 32 % bound);
    let value = await stream.next();
    while (value >= limit) value = await stream.next();
    const j = value % bound;
    [items[i], items[j]] = [items[j]!, items[i]!];
    if (onProgress && i % 2000 === 0) onProgress(items.length - i);
  }
  return items;
}
