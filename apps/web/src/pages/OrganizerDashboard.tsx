import { lazy, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Activity, ArrowDownRight, ArrowRight, Ban, Check, ChevronDown, CircleHelp, Fingerprint, FlaskConical, Layers,
  LockKeyhole, Plus, Radio, ShieldCheck, Ticket, TicketCheck, Users, X,
} from "lucide-react";
import { api, formatDate, localDateTimeValue, statusLabel, totalOf, type Drop, type Metrics, type OrganizerEntry, type Overview } from "../lib/api";
import { CountUp, Reveal, Ring, SceneBoundary } from "../components/fx";
import { FairnessAudit } from "../components/FairnessAudit";

const SeatArena = lazy(() => import("../three/SeatArena"));

export function OrganizerDashboard() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [selected, setSelected] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [entries, setEntries] = useState<OrganizerEntry[]>([]);
  const [error, setError] = useState(""); const [toast, setToast] = useState(""); const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ drops }, totals] = await Promise.all([api<{ drops: Drop[] }>("/api/drops"), api<Overview>("/api/organizer/overview")]);
      setDrops(drops); setOverview(totals);
      setSelected((old) => old && drops.some((drop) => drop.id === old) ? old : drops[0]?.id ?? "");
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10000); return () => window.clearInterval(timer); }, [load]);
  const loadMetrics = useCallback(async () => {
    if (!selected) return;
    try {
      const [data, list, totals] = await Promise.all([
        api<{ metrics: Metrics }>(`/api/organizer/drops/${selected}/metrics`),
        api<{ entries: OrganizerEntry[] }>(`/api/organizer/drops/${selected}/entries?page=1`),
        api<Overview>("/api/organizer/overview"),
      ]);
      setMetrics(data.metrics); setEntries(list.entries); setOverview(totals);
    } catch (e) { setError((e as Error).message); }
  }, [selected]);
  useEffect(() => { void loadMetrics(); const timer = window.setInterval(() => void loadMetrics(), 5000); return () => window.clearInterval(timer); }, [loadMetrics]);
  useEffect(() => {
    if (!creating) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setCreating(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creating]);
  const active = drops.find((drop) => drop.id === selected);

  const createDrop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      title: String(form.get("title")), description: String(form.get("description")), venue: String(form.get("venue")),
      eventDate: new Date(String(form.get("eventDate"))).toISOString(), capacity: Number(form.get("capacity")), reservationMinutes: Number(form.get("reservationMinutes")),
      allocationPolicy: String(form.get("allocationPolicy")), limitsEnabled: form.get("limitsEnabled") === "on",
    };
    try {
      const { drop } = await api<{ drop: Drop }>("/api/organizer/drops", { method: "POST", body: JSON.stringify(payload) });
      setToast("Your drop is ready to configure."); await load(); setSelected(drop.id); formElement.reset(); setCreating(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const transition = async (action: "open" | "close") => {
    if (!active) return;
    setBusy(true); setError("");
    try {
      await api(`/api/organizer/drops/${active.id}/${action}`, { method: "POST", body: JSON.stringify(action === "open" ? { durationMinutes: 30 } : {}) });
      setToast(action === "open" ? "Entry window is open for 30 minutes." : "Entry closed. The randomized order is saved."); await load(); await loadMetrics();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const csv = async () => {
    const first = await api<{ entries: OrganizerEntry[]; pages: number }>(`/api/organizer/drops/${selected}/entries?page=1`);
    const allEntries = [...first.entries];
    for (let page = 2; page <= first.pages; page++) {
      const result = await api<{ entries: OrganizerEntry[] }>(`/api/organizer/drops/${selected}/entries?page=${page}`);
      allEntries.push(...result.entries);
    }
    const rows = [["rank", "name", "email", "status", "enteredAt"], ...allEntries.map((entry) => [String(entry.rank ?? ""), entry.user.name, entry.user.email, entry.status, entry.enteredAt])];
    const text = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); link.download = `fair-drop-${selected}-entries.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  const total = totalOf(metrics);
  const allocated = metrics ? metrics.confirmed + metrics.reserved : 0;
  const demand = active && active.capacity ? total / active.capacity : 0;
  const bars = useMemo(() => metrics ? [
    { name: "Received", value: metrics.entered, tone: "cyan" },
    { name: "Reserved", value: metrics.reserved, tone: "violet" },
    { name: "Waitlisted", value: metrics.waitlisted, tone: "amber" },
    { name: "Confirmed", value: metrics.confirmed, tone: "lime" },
    { name: "Expired", value: metrics.expired, tone: "red" },
  ] : [], [metrics]);
  const arena = useMemo(() => active && metrics ? { capacity: active.capacity, status: active.status, ...metrics } : null, [active, metrics]);

  return <div className="dash-page">
    <header className="dash-header">
      <div>
        <span className="section-kicker">ORGANIZER · THE CONTROL ROOM</span>
        <h1>Command <span className="gradient-text">center</span>.</h1>
        <p>Set up a drop, run the draw, and watch what actually happened — live.</p>
      </div>
      <div className="dash-header-actions">
        <Link to="/attack-lab" className="button button-ghost"><FlaskConical size={16} /> Attack lab</Link>
        <button className="button button-primary" onClick={() => setCreating(true)}><Plus size={16} /> New drop</button>
      </div>
    </header>

    {error && <div className="error-banner">{error}<button className="error-close" onClick={() => setError("")} aria-label="Dismiss"><X size={14} /></button></div>}
    {toast && <div className="notice-banner" role="status">{toast}<button onClick={() => setToast("")} aria-label="Dismiss"><X size={15} /></button></div>}

    <section className="kpi-row">
      {[
        { label: "DROPS", value: overview?.drops, icon: <Layers size={18} />, tone: "violet" },
        { label: "ACCOUNTS", value: overview?.accounts, icon: <Users size={18} />, tone: "cyan" },
        { label: "ENTRIES", value: overview?.entries, icon: <TicketCheck size={18} />, tone: "pink" },
        { label: "CONFIRMED", value: overview?.confirmed, icon: <Ticket size={18} />, tone: "lime" },
        { label: "RATE LIMITED", value: overview?.throttled, icon: <Ban size={18} />, tone: "red" },
      ].map((kpi, i) => <Reveal key={kpi.label} delay={i * 70} className={`stat-tile glass tone-${kpi.tone}`}>
        <span className="stat-icon">{kpi.icon}</span><strong><CountUp value={kpi.value} /></strong><span>{kpi.label}</span>
      </Reveal>)}
    </section>

    <section className="drop-rail" aria-label="Drops">
      {drops.length === 0 ? <button className="rail-empty glass" onClick={() => setCreating(true)}><Plus size={16} /> Create your first drop</button>
        : drops.map((drop) => <button key={drop.id} className={`rail-card glass ${drop.id === selected ? "rail-active" : ""}`} onClick={() => setSelected(drop.id)}>
          <span className={`status-pill status-${drop.status.toLowerCase()}`}>{drop.status === "OPEN" && <span className="live-pulse" />}{statusLabel(drop.status)}</span>
          <strong>{drop.title}</strong>
          <small>{drop.capacity.toLocaleString()} seats · {drop.allocationPolicy === "RANDOM_DRAW" ? "Random draw" : "First come"}</small>
        </button>)}
    </section>

    <section className="org-grid">
      <div className="arena-panel glass">
        <div className="panel-heading"><div className="panel-heading-icon"><Activity size={16} /></div><div><span className="section-kicker">LIVE SEAT ARENA</span><h2>{active?.title ?? "No drop selected"}</h2></div><span className="live-mini"><span className="live-pulse" /> LIVE</span></div>
        <div className="arena-stage">
          {arena ? <SceneBoundary fallback={<div className="arena-fallback"><Ticket size={48} strokeWidth={1} /><span>3D view unavailable on this device</span></div>}><SeatArena state={arena} /></SceneBoundary>
            : <div className="arena-fallback"><Ticket size={48} strokeWidth={1} /><span>{drops.length ? "Loading arena…" : "Create a drop to see its seats."}</span></div>}
          <div className="arena-legend"><span><i className="lg-lime" /> Confirmed</span><span><i className="lg-violet" /> Reserved</span><span><i className="lg-dim" /> {active?.status === "OPEN" ? "Awaiting draw" : "Unallocated"}</span><span><i className="lg-pink" /> Entrants</span></div>
          <div className="arena-hud">
            <div><span>CAPACITY</span><strong>{active?.capacity.toLocaleString() ?? "—"}</strong></div>
            <div><span>DEMAND</span><strong>{demand ? `${demand >= 10 ? Math.round(demand) : demand.toFixed(1)}×` : "—"}</strong></div>
          </div>
        </div>
        <p className="arena-caption">Drag to orbit. Each block is a seat{active && active.capacity > 2400 ? ` (≈${Math.ceil(active.capacity / 2400)} seats per block)` : ""}; the pink swarm is everyone who entered.</p>
      </div>

      <div className="org-side">
        <div className="control-panel glass">
          <div className="panel-heading"><div className="panel-heading-icon tone-violet"><Radio size={16} /></div><div><span className="section-kicker">DROP OPERATIONS</span><h2>Control</h2></div></div>
          {active ? <div className="selected-drop">
            <div className="selected-drop-top"><span className={`status-pill status-${active.status.toLowerCase()}`}>{statusLabel(active.status)}</span><span>{formatDate(active.eventDate)}</span></div>
            <small>{active.venue}</small>
            <div className="chip-row"><span className="chip">{active.allocationPolicy === "RANDOM_DRAW" ? "Random draw" : "First come"}</span><span className={`chip ${active.limitsEnabled ? "chip-on" : "chip-off"}`}>Limits {active.limitsEnabled ? "on" : "off"}</span><span className="chip">{active.reservationMinutes} min hold</span></div>
            {active.allocationPolicy === "RANDOM_DRAW" && <div className="commitment-row">
              <Fingerprint size={14} />
              <span>{active.drawSeedHash ? <>Draw sealed · <code title={active.drawSeedHash}>{active.drawSeedHash.slice(0, 10)}…{active.drawSeedHash.slice(-6)}</code></> : "Seed is committed when entry opens"}</span>
              {active.drawSeedHash && <Link to={`/verify/${active.id}`} className="text-link">{active.status === "CLOSED" ? "Verify" : "Audit"} <ArrowRight size={13} /></Link>}
            </div>}
          </div> : <div className="select-empty">Create a drop to see its controls.</div>}
          <div className="control-actions">
            {active?.status === "DRAFT" && <button className="button button-primary" disabled={busy} onClick={() => void transition("open")}><Radio size={15} /> Open entry · 30 min</button>}
            {active?.status === "OPEN" && <button className="button button-danger" disabled={busy} onClick={() => void transition("close")}><LockKeyhole size={15} /> Close window &amp; draw</button>}
            {active?.status === "CLOSED" && <span className="closed-note"><Check size={15} /> Draw complete · order saved</span>}
            <button className="button button-ghost" onClick={() => void csv()} disabled={!entries.length}><ArrowDownRight size={15} /> Export CSV</button>
          </div>
          <div className="control-footnote"><CircleHelp size={14} /> Closing freezes the eligible list and saves one random order. It cannot be redrawn.</div>
        </div>

        <div className="alloc-panel glass">
          <div className="alloc-top">
            <Ring value={active?.capacity ? allocated / active.capacity : 0} size={128} stroke={10} tone="lime"><strong>{active?.capacity ? Math.round((allocated / active.capacity) * 100) : 0}%</strong><span>ALLOCATED</span></Ring>
            <div className="alloc-summary">
              <div><strong><CountUp value={total} /></strong><span>TOTAL ENTRIES</span></div>
              <div><strong><CountUp value={metrics?.confirmed} /></strong><span>CONFIRMED</span></div>
              <div><strong><CountUp value={metrics?.reserved} /></strong><span>ON HOLD</span></div>
            </div>
          </div>
          <div className="bar-chart">{bars.map((bar) => <div className="bar-row" key={bar.name}><span>{bar.name}</span><div className="bar-track"><div className={`bar-fill fill-${bar.tone}`} style={{ width: `${Math.max(bar.value ? 2 : 0, (bar.value / Math.max(1, total)) * 100)}%` }} /></div><strong>{bar.value.toLocaleString()}</strong></div>)}</div>
          <div className="chart-caption"><ShieldCheck size={14} /> Counts come from durable entry state in PostgreSQL.</div>
        </div>
      </div>
    </section>

    {active && <FairnessAudit dropId={active.id} />}

    <section className="table-panel glass">
      <div className="dash-section-head"><div><span className="section-kicker">THE ENTRY LIST</span><h2>Participants by draw rank</h2></div><span className="table-count">{total.toLocaleString()} total</span></div>
      {entries.length ? <div className="table-scroll"><table><thead><tr><th>DRAW RANK</th><th>PARTICIPANT</th><th>EMAIL</th><th>STATUS</th><th>ENTRY RECEIVED</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{entry.rank ? <span className="rank-chip">#{entry.rank}</span> : "—"}</td><td><span className="table-avatar">{entry.user.name.slice(0, 1).toUpperCase()}</span>{entry.user.name}</td><td className="email-cell">{entry.user.email}</td><td><span className={`receipt-status receipt-${entry.status.toLowerCase()}`}><span className="status-dot" />{statusLabel(entry.status)}</span></td><td>{formatDate(entry.enteredAt)}</td></tr>)}</tbody></table></div>
        : <div className="table-empty"><Users size={20} /><span>Entries will appear here as people join.</span></div>}
      {total > entries.length && <p className="table-limit-note">Showing the first {entries.length} entries. Export CSV downloads the full entry list.</p>}
    </section>

    <div className="organizer-note glass"><LockKeyhole size={15} /><span><strong>Fair process, visible outcomes.</strong> Limits are enforced per action and account/IP. A verified account does not prove a unique person; multiple accounts and shared networks remain limitations.</span><Link to="/" className="text-link">View participant site <ArrowRight size={14} /></Link></div>

    {creating && <div className="drawer-backdrop" onClick={() => setCreating(false)}>
      <form className="drawer glass" onSubmit={createDrop} onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading"><div className="panel-heading-icon"><Plus size={16} /></div><div><span className="section-kicker">START HERE</span><h2>Create a drop</h2></div><button type="button" className="icon-btn drawer-close" onClick={() => setCreating(false)} aria-label="Close"><X size={17} /></button></div>
        <label className="field-label">Event name<input className="plain-input" name="title" placeholder="An unforgettable night" minLength={3} maxLength={100} required autoFocus /></label>
        <label className="field-label">Description<textarea className="plain-input textarea" name="description" placeholder="Give fans the details…" maxLength={1000} rows={3} /></label>
        <div className="field-row"><label className="field-label">Venue<input className="plain-input" name="venue" placeholder="The Demo Hall" defaultValue="The Demo Hall" required /></label><label className="field-label">Seats<input className="plain-input" name="capacity" type="number" min={1} max={50000} defaultValue={500} required /></label></div>
        <div className="field-row"><label className="field-label">Event date<input className="plain-input" name="eventDate" type="datetime-local" defaultValue={localDateTimeValue(new Date(Date.now() + 7 * 86400000))} required /></label><label className="field-label">Hold time (min)<input className="plain-input" name="reservationMinutes" type="number" min={1} max={120} defaultValue={10} required /></label></div>
        <label className="field-label">Seat allocation<span className="select-wrap"><select name="allocationPolicy" defaultValue="RANDOM_DRAW"><option value="RANDOM_DRAW">Protected random draw</option><option value="FIRST_COME">First come, first served</option></select><ChevronDown size={15} /></span></label>
        <label className="limit-toggle"><input type="checkbox" name="limitsEnabled" defaultChecked /><span className="toggle-mark"><Check size={12} /></span><span><strong>Enable abuse limits</strong><small>Apply account and source budgets to entry requests.</small></span></label>
        <button className="button button-primary full-button" disabled={busy}>{busy ? "Creating…" : "Create draft drop"}<ArrowRight size={15} /></button>
      </form>
    </div>}
  </div>;
}
