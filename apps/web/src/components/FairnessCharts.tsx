import { useState } from "react";
import type { FairnessBucket, TrafficPoint } from "../lib/api";

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** Single-series column chart of win rate per bucket, on a shared 0–100% scale. */
export function WinRateChart({ title, subtitle, buckets, fairRate }: { title: string; subtitle: string; buckets: FairnessBucket[]; fairRate: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320, H = 196, left = 34, right = 10, top = 22, plotH = 128;
  const plotW = W - left - right;
  const band = plotW / Math.max(1, buckets.length);
  const barW = Math.min(24, band * 0.55);
  const y = (rate: number) => top + plotH - rate * plotH;
  const drawn = buckets.some((bucket) => bucket.winRate !== null);
  return <figure className="win-chart" onMouseLeave={() => setHover(null)}>
    <figcaption><strong>{title}</strong><span>{subtitle}</span></figcaption>
    <div className="win-chart-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${buckets.map((b) => `${b.label} ${b.winRate === null ? "not drawn" : pct(b.winRate)}`).join(", ")}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => <g key={tick}>
          <line x1={left} x2={W - right} y1={y(tick)} y2={y(tick)} className="chart-grid" />
          <text x={left - 6} y={y(tick) + 3} className="chart-tick" textAnchor="end">{pct(tick)}</text>
        </g>)}
        {buckets.map((bucket, index) => {
          const cx = left + band * index + band / 2;
          const rate = bucket.winRate ?? 0;
          const h = Math.max(rate > 0 ? 2 : 0, rate * plotH);
          const x0 = cx - barW / 2, yTop = top + plotH - h, r = Math.min(4, h);
          return <g key={bucket.label}>
            {bucket.winRate !== null && h > 0 && <path className={`chart-bar ${hover === index ? "chart-bar-hover" : ""}`}
              d={`M${x0},${top + plotH} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + barW - r} Q${x0 + barW},${yTop} ${x0 + barW},${yTop + r} V${top + plotH} Z`} />}
            {bucket.winRate !== null && <text x={cx} y={yTop - 6} className="chart-value" textAnchor="middle">{pct(rate)}</text>}
            <text x={cx} y={top + plotH + 16} className="chart-label" textAnchor="middle">{bucket.label}</text>
            <text x={cx} y={top + plotH + 30} className="chart-tick" textAnchor="middle">n={bucket.entrants.toLocaleString()}</text>
            <rect x={cx - band / 2} y={top} width={band} height={plotH + 34} className="chart-hit" tabIndex={0}
              onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} />
          </g>;
        })}
        {fairRate !== null && <g className="chart-reference">
          <line x1={left} x2={W - right} y1={y(fairRate)} y2={y(fairRate)} />
          <text x={W - right} y={y(fairRate) - 5} textAnchor="end">Fair share {pct(fairRate)}</text>
        </g>}
        <line x1={left} x2={W - right} y1={top + plotH} y2={top + plotH} className="chart-axis" />
      </svg>
      {!drawn && <div className="chart-empty">Win rates appear after the draw</div>}
      {hover !== null && buckets[hover] && <div className="chart-tooltip" style={{ left: `${((left + band * hover + band / 2) / W) * 100}%` }}>
        <strong>{buckets[hover]!.label} · {buckets[hover]!.detail}</strong>
        <span>{buckets[hover]!.winRate === null ? `${buckets[hover]!.entrants.toLocaleString()} entrants · not drawn yet` : `${buckets[hover]!.winners.toLocaleString()} of ${buckets[hover]!.entrants.toLocaleString()} won a seat · ${pct(buckets[hover]!.winRate!)}`}</span>
      </div>}
    </div>
  </figure>;
}

const SERIES = [
  { key: "accepted", label: "Accepted" },
  { key: "throttled", label: "Throttled" },
  { key: "rejected", label: "Rejected" },
] as const;

function niceMax(value: number) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= value / 4)! * magnitude;
  return Math.ceil(value / step) * step;
}

/** Requests per second over the last two minutes: three lines, crosshair + tooltip on hover. */
export function TrafficChart({ points }: { points: TrafficPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 220, left = 40, right = 16, top = 14, plotH = 168;
  const plotW = W - left - right;
  const n = Math.max(2, points.length);
  const max = niceMax(Math.max(0, ...points.flatMap((p) => [p.accepted, p.throttled, p.rejected])));
  const x = (i: number) => left + (i / (n - 1)) * plotW;
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const latest = points[points.length - 1];
  const idle = points.every((p) => p.accepted + p.throttled + p.rejected === 0);
  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  };
  const hovered = hover !== null ? points[hover] : null;
  return <figure className="traffic-chart">
    <div className="traffic-legend">{SERIES.map((series) => <span key={series.key}><i className={`swatch-${series.key}`} />{series.label}<b>{latest ? latest[series.key] : 0}/s</b></span>)}</div>
    <div className="traffic-plot" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Entry requests per second over the last two minutes, split into accepted, throttled and rejected">
        {ticks.map((tick) => <g key={tick}>
          <line x1={left} x2={W - right} y1={y(tick)} y2={y(tick)} className="chart-grid" />
          <text x={left - 6} y={y(tick) + 3} className="chart-tick" textAnchor="end">{Math.round(tick).toLocaleString()}</text>
        </g>)}
        {[0, 30, 60, 90, 119].map((i) => <text key={i} x={x((i / 119) * (n - 1))} y={H - 4} className="chart-tick" textAnchor={i === 0 ? "start" : i === 119 ? "end" : "middle"}>{i === 119 ? "now" : `−${120 - i}s`}</text>)}
        {SERIES.map((series) => <polyline key={series.key} className={`traffic-line line-${series.key}`} points={points.map((p, i) => `${x(i)},${y(p[series.key])}`).join(" ")} />)}
        {latest && SERIES.map((series) => <circle key={series.key} className={`traffic-dot line-${series.key}`} cx={x(points.length - 1)} cy={y(latest[series.key])} r={4} />)}
        {hovered && <g>
          <line x1={x(hover!)} x2={x(hover!)} y1={top} y2={top + plotH} className="chart-crosshair" />
          {SERIES.map((series) => <circle key={series.key} className={`traffic-dot line-${series.key}`} cx={x(hover!)} cy={y(hovered[series.key])} r={4} />)}
        </g>}
        <line x1={left} x2={W - right} y1={top + plotH} y2={top + plotH} className="chart-axis" />
        <rect x={left} y={top} width={plotW} height={plotH} className="chart-hit" onPointerMove={onMove} onPointerDown={onMove} />
      </svg>
      {idle && <div className="chart-empty">No entry traffic in the last 2 minutes. Run a k6 scenario to watch it live.</div>}
      {hovered && <div className="chart-tooltip" style={{ left: `${(x(hover!) / W) * 100}%` }}>
        <strong>{hover === points.length - 1 ? "Now" : `${points.length - 1 - hover!}s ago`}</strong>
        {SERIES.map((series) => <span key={series.key}><i className={`swatch-${series.key}`} />{series.label} <b>{hovered[series.key]}</b></span>)}
      </div>}
    </div>
  </figure>;
}
