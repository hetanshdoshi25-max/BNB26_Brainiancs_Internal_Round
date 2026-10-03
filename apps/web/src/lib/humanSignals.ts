// Collects aggregate interaction statistics for the soft "human signal" score.
// Only running totals are kept: no coordinates, no key identities, nothing typed.
const startedAt = performance.now();
let pointerMoves = 0;
let touch = false;
let pasted = false;
const angleBins = new Array<number>(8).fill(0);
let lastPoint: { x: number; y: number; t: number } | null = null;
const speed = { n: 0, mean: 0, m2: 0 };
let keyCount = 0;
const dwell = { n: 0, mean: 0, m2: 0 };
const flight = { n: 0, mean: 0, m2: 0 };
const keyDownAt = new Map<string, number>();
let lastKeyUpAt: number | null = null;

function push(stat: { n: number; mean: number; m2: number }, value: number) {
  stat.n++;
  const delta = value - stat.mean;
  stat.mean += delta / stat.n;
  stat.m2 += delta * (value - stat.mean);
}
const std = (stat: { n: number; m2: number }) => (stat.n > 1 ? Math.sqrt(stat.m2 / (stat.n - 1)) : 0);

if (typeof window !== "undefined") {
  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") touch = true;
    const point = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    if (lastPoint) {
      const dx = point.x - lastPoint.x;
      const dy = point.y - lastPoint.y;
      const distance = Math.hypot(dx, dy);
      const dt = point.t - lastPoint.t;
      if (distance > 2) {
        pointerMoves++;
        const bin = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 8) % 8;
        angleBins[bin]!++;
        if (dt > 0) push(speed, distance / dt);
      }
    }
    lastPoint = point;
  }, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    const now = event.timeStamp;
    keyDownAt.set(event.code, now);
    if (lastKeyUpAt !== null) push(flight, now - lastKeyUpAt);
  }, { passive: true });
  window.addEventListener("keyup", (event) => {
    const down = keyDownAt.get(event.code);
    if (down === undefined) return;
    keyDownAt.delete(event.code);
    keyCount++;
    push(dwell, event.timeStamp - down);
    lastKeyUpAt = event.timeStamp;
  }, { passive: true });
  window.addEventListener("paste", () => { pasted = true; }, { passive: true });
}

export function getSignals() {
  const total = angleBins.reduce((sum, value) => sum + value, 0);
  const angleEntropy = total ? -angleBins.reduce((sum, value) => (value ? sum + (value / total) * Math.log2(value / total) : sum), 0) : 0;
  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    pointerMoves,
    angleEntropy: Number(angleEntropy.toFixed(3)),
    speedCv: speed.mean > 0 ? Number((std(speed) / speed.mean).toFixed(3)) : 0,
    keyCount,
    dwellStd: Number(std(dwell).toFixed(1)),
    flightStd: Number(std(flight).toFixed(1)),
    touch,
    pasted,
  };
}
