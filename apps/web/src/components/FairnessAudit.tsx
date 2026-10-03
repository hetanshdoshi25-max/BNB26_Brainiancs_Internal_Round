import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Cpu, Fingerprint, Scale, ShieldCheck, Table2, Timer } from "lucide-react";
import { api, type FairnessReport, type TrafficPoint } from "../lib/api";
import { TrafficChart, WinRateChart } from "./FairnessCharts";

const pct = (value: number) => `${Math.round(value * 100)}%`;

function correlationNote(value: number | null, policy: FairnessReport["policy"]) {
  if (value === null) return "Appears after the draw";
  if (Math.abs(value) < 0.1) return "Arrival time had no effect on rank";
  if (value > 0.9) return policy === "FIRST_COME" ? "Earlier arrivals took the best ranks" : "Ranks closely follow arrival order";
  return value > 0 ? "Weak link: earlier arrivals ranked slightly better" : "Weak link: later arrivals ranked slightly better";
}

/** Organizer evidence panel: fairness statistics from durable state plus live request traffic. */
export function FairnessAudit({ dropId }: { dropId: string }) {
  const [report, setReport] = useState<FairnessReport | null>(null);
  const [traffic, setTraffic] = useState<TrafficPoint[]>([]);
  const [table, setTable] = useState(false);

  const loadReport = useCallback(() => api<FairnessReport>(`/api/organizer/drops/${dropId}/fairness`).then(setReport).catch(() => undefined), [dropId]);
  const loadTraffic = useCallback(() => api<{ series: TrafficPoint[] }>(`/api/organizer/drops/${dropId}/traffic`).then((data) => setTraffic(data.series)).catch(() => undefined), [dropId]);
  useEffect(() => {
    void loadReport(); void loadTraffic();
    const slow = window.setInterval(() => void loadReport(), 5000);
    const fast = window.setInterval(() => void loadTraffic(), 2000);
    return () => { window.clearInterval(slow); window.clearInterval(fast); };
  }, [loadReport, loadTraffic]);

  if (!report) return <section className="audit-panel glass"><div className="audit-loading">Loading fairness evidence…</div></section>;
  const groups = [
    { key: "arrival", title: "Win rate by arrival time", subtitle: "Did arriving early help?", buckets: report.buckets.arrival },
    { key: "volume", title: "Win rate by request volume", subtitle: "Did spamming the endpoint help?", buckets: report.buckets.volume },
    { key: "human", title: "Win rate by human signal", subtitle: "Who got seats: humans or scripts?", buckets: report.buckets.human },
  ] as const;
  const rho = report.correlation;

  return <section className="audit-panel glass" aria-labelledby="audit-title">
    <div className="dash-section-head">
      <div><span className="section-kicker"><Scale size={13} /> FAIRNESS AUDIT</span><h2 id="audit-title">Evidence, not claims</h2></div>
      <div className="audit-actions">
        {report.drawn && report.policy === "RANDOM_DRAW" && <Link className="button button-ghost button-small" to={`/verify/${dropId}`}><Fingerprint size={14} /> Verify draw</Link>}
        <button className={`button button-ghost button-small ${table ? "is-on" : ""}`} onClick={() => setTable(!table)} aria-pressed={table}><Table2 size={14} /> {table ? "Show charts" : "Show as table"}</button>
      </div>
    </div>

    <div className="audit-stats">
      <div className="audit-stat">
        <span className="audit-stat-icon"><Timer size={16} /></span>
        <span className="audit-stat-label">Arrival vs rank correlation</span>
        <strong>{rho === null ? "—" : `${rho >= 0 ? "+" : "−"}${Math.abs(rho).toFixed(2)}`}</strong>
        <small>{correlationNote(rho, report.policy)}</small>
      </div>
      <div className="audit-stat">
        <span className="audit-stat-icon"><Activity size={16} /></span>
        <span className="audit-stat-label">Early-bird advantage</span>
        <strong>{report.earlyBirdAdvantage === null ? "—" : `${report.earlyBirdAdvantage.toFixed(2)}×`}</strong>
        <small>Win rate of the first 10% vs everyone. 1.00× is fair</small>
      </div>
      <div className="audit-stat">
        <span className="audit-stat-icon"><ShieldCheck size={16} /></span>
        <span className="audit-stat-label">Seats to low-signal accounts</span>
        <strong>{report.lowSignal.seatShare === null ? "—" : pct(report.lowSignal.seatShare)}</strong>
        <small>They are {pct(report.lowSignal.entrantShare)} of {report.entrants.toLocaleString()} entrants</small>
      </div>
      <div className="audit-stat">
        <span className="audit-stat-icon"><Cpu size={16} /></span>
        <span className="audit-stat-label">Proof-of-work difficulty</span>
        <strong>{report.pow.enabled ? `${report.pow.join.bits} bits` : "Off"}</strong>
        <small>{report.pow.enabled ? `≈${(2 ** report.pow.join.bits).toLocaleString()} hashes per entry · ${report.pow.join.requestsPerSecond.toFixed(1)} challenges/s` : "Set POW_ENABLED to turn it on"}</small>
      </div>
    </div>

    {table ? <div className="table-scroll audit-table"><table>
      <thead><tr><th>VIEW</th><th>GROUP</th><th>DESCRIPTION</th><th>ENTRANTS</th><th>WON A SEAT</th><th>WIN RATE</th></tr></thead>
      <tbody>{groups.flatMap((group) => group.buckets.map((bucket) => <tr key={group.key + bucket.label}>
        <td>{group.title.replace("Win rate by ", "")}</td><td>{bucket.label}</td><td className="email-cell">{bucket.detail}</td>
        <td className="num">{bucket.entrants.toLocaleString()}</td><td className="num">{bucket.winRate === null ? "—" : bucket.winners.toLocaleString()}</td>
        <td className="num">{bucket.winRate === null ? "—" : pct(bucket.winRate)}</td>
      </tr>))}</tbody>
    </table></div>
      : <div className="audit-charts">{groups.map((group) => <WinRateChart key={group.key} title={group.title} subtitle={group.subtitle} buckets={group.buckets} fairRate={report.overallRate} />)}</div>}

    <p className="audit-caption">{report.drawn
      ? `Fair means every group's bar sits on the fair-share line (${report.overallRate !== null ? pct(report.overallRate) : "—"} = ${report.capacity.toLocaleString()} seats ÷ ${report.entrants.toLocaleString()} entrants). Groups with few entrants vary more by chance.`
      : "The draw hasn't run yet. Close the entry window to see who won, broken down by arrival, request volume and human signal."}</p>

    <div className="audit-traffic">
      <div className="dash-section-head"><div><span className="section-kicker"><Activity size={13} /> LIVE ENTRY TRAFFIC</span><h3>Requests per second · last 2 minutes</h3></div><span className="live-mini"><span className="live-pulse" /> UPDATES EVERY 2S</span></div>
      <TrafficChart points={traffic} />
    </div>
  </section>;
}
