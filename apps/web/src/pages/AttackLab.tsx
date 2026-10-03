import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowRight, Check, Gauge, LockKeyhole, ShieldCheck, Terminal } from "lucide-react";
import { api, statusLabel, type Drop } from "../lib/api";
import { Reveal } from "../components/fx";

const descriptions: Record<string, { title: string; body: string; note: string; intensity: number }> = {
  baseline: { title: "Normal arrivals", body: "One join request per virtual user, with a little natural spacing.", note: "Establishes the entry-success baseline.", intensity: 0.25 },
  repeat: { title: "Repeat attempts", body: "The same accounts retry entry and poll their saved receipt.", note: "Shows one-entry idempotency and rate-limit decisions.", intensity: 0.6 },
  burst: { title: "Arrival burst", body: "Virtual users arrive together to stress the entry endpoint.", note: "Use a dedicated local test environment and fresh accounts.", intensity: 1 },
  mixed: { title: "Mixed cohort", body: "A mix of ordinary one-time joins and a smaller repeat-attempt cohort.", note: "Compares ordinary entry success with repeat traffic.", intensity: 0.7 },
  recovery: { title: "Refresh & recovery", body: "Users join, reload their saved state, and retry without creating extra entries.", note: "Checks persistent user state and idempotent retries.", intensity: 0.45 },
};

export function AttackLab() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [copied, setCopied] = useState(false);
  const [scenario, setScenario] = useState("baseline");
  const [vus, setVus] = useState(24);
  const [duration, setDuration] = useState(30);
  const [dropId, setDropId] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:4000");
  useEffect(() => { api<{ drops: Drop[] }>("/api/drops").then(({ drops }) => { setDrops(drops); setDropId(drops[0]?.id ?? ""); }).catch(() => undefined); }, []);
  const command = `k6 run -e BASE_URL=${baseUrl.trim().replace(/\s/g, "")} -e DROP_ID=${dropId || "<drop-id>"} -e SCENARIO=${scenario} -e VUS=${vus} -e DURATION=${duration}s -e ACCOUNTS_FILE=./accounts.local.json tests/load/fair-drop.js`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  };
  const active = descriptions[scenario]!;
  return <div className="dash-page">
    <header className="dash-header">
      <div><span className="section-kicker">ORGANIZER · THE TEST ENVIRONMENT</span><h1>Attack <span className="gradient-text">lab</span>.</h1><p>Configurable k6 scenarios against the same booking API real participants use.</p></div>
      <span className="role-badge role-organizer"><Gauge size={13} /> K6 LOAD SCENARIOS</span>
    </header>
    <div className="lab-banner glass"><div className="lab-shield"><ShieldCheck size={18} /></div><div><strong>Test only a deployment you own.</strong><span>The lab prepares a k6 command. Run it on a dedicated local/test environment with throwaway accounts and fresh inventory.</span></div></div>
    <div className="lab-grid">
      <div className="glass lab-config">
        <div className="panel-heading"><div className="panel-heading-icon tone-violet"><Gauge size={16} /></div><div><span className="section-kicker">EXPERIMENT SETUP</span><h2>Choose a scenario</h2></div></div>
        <div className="scenario-list">{Object.entries(descriptions).map(([key, value], index) => <button className={`scenario-option ${scenario === key ? "scenario-selected" : ""}`} key={key} onClick={() => setScenario(key)}>
          <span className="scenario-number">0{index + 1}</span>
          <span className="scenario-copy"><strong>{value.title}</strong><small>{value.body}</small></span>
          <span className="scenario-meter" aria-hidden="true">{[0, 1, 2, 3, 4].map((bar) => <i key={bar} className={bar < Math.round(value.intensity * 5) ? "on" : ""} />)}</span>
        </button>)}</div>
        <div className="lab-fields">
          <label className="field-label">Test deployment API<input className="plain-input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} /></label>
          <label className="field-label">Drop<input className="plain-input" list="lab-drops" value={dropId} onChange={(event) => setDropId(event.target.value)} placeholder="Paste a drop ID" /><datalist id="lab-drops">{drops.map((drop) => <option key={drop.id} value={drop.id}>{drop.title} · {statusLabel(drop.status)}</option>)}</datalist></label>
          <div className="field-row"><label className="field-label">Virtual users<input className="plain-input" type="number" min={1} max={2000} value={vus} onChange={(event) => setVus(Math.max(1, Math.min(2000, Number(event.target.value))))} /></label><label className="field-label">Duration (seconds)<input className="plain-input" type="number" min={5} max={600} value={duration} onChange={(event) => setDuration(Math.max(5, Math.min(600, Number(event.target.value))))} /></label></div>
        </div>
      </div>
      <div className="lab-summary-column">
        <Reveal key={scenario} className="glass scenario-summary">
          <span className="section-kicker">SCENARIO {String(Object.keys(descriptions).indexOf(scenario) + 1).padStart(2, "0")}</span>
          <h2>{active.title}</h2><p>{active.body}</p>
          <div className="traffic-viz" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ animationDuration: `${(2.6 - active.intensity * 1.8) + (i % 5) * 0.15}s`, animationDelay: `${(i * 0.137) % 1.6}s`, top: `${(i * 37) % 100}%` }} />)}<span className="traffic-shield"><ShieldCheck size={20} /></span></div>
          <div className="summary-note"><ShieldCheck size={16} /><span>{active.note}</span></div>
          <div className="scenario-facts"><div><span>VIRTUAL USERS</span><strong>{vus.toLocaleString()}</strong></div><div><span>DURATION</span><strong>{duration}s</strong></div><div><span>ENTRY POLICY</span><strong>ONE / ACCOUNT</strong></div></div>
        </Reveal>
        <div className="glass run-panel">
          <div className="panel-heading"><div className="panel-heading-icon tone-lime"><Terminal size={16} /></div><div><span className="section-kicker">RUN IT LOCALLY</span><h2>Command preview</h2></div></div>
          <p>Requires k6 installed, participant accounts in your local account file, and an open drop in a test deployment.</p>
          <pre className="command-block"><code><span className="prompt">$</span> {command}</code></pre>
          <button className="button button-primary full-button" onClick={() => void copy()}>{copied ? <><Check size={15} /> Copied to clipboard</> : <>Copy k6 command <ArrowRight size={15} /></>}</button>
          <span className="command-footnote"><LockKeyhole size={12} /> Credentials stay in your ignored local file; never commit it.</span>
        </div>
      </div>
    </div>
    <div className="comparison-method glass"><div className="method-heading"><span className="section-kicker">COMPARE THREE POLICIES</span><span>Use the same test population and fresh drops.</span></div><div className="policy-grid"><div><span>3A · BASELINE</span><strong>First come</strong><small>Create a drop with first-come allocation and limits off.</small></div><div><span>3B · LIMITED BASELINE</span><strong>First come + limits</strong><small>Keep first-come allocation and turn account/IP limits on.</small></div><div><span>3C · PROTECTED DRAW</span><strong>Random order + limits</strong><small>Use the defaults: random draw and limits on.</small></div></div></div>
    <div className="evidence-steps">{[
      ["01", "Keep the run comparable", "Fresh inventory, same account population, similar hardware."],
      ["02", "Measure the real API", "Actual throughput, p95 latency, errors and throttles."],
      ["03", "Report the limits too", "Saved accounts are not unique people or simultaneous users."],
    ].map(([n, title, body]) => <div key={n} className="glass"><span>{n}</span><div><strong>{title}</strong><small>{body}</small></div><ArrowDownRight size={15} className="evidence-arrow" /></div>)}</div>
  </div>;
}
