import { lazy, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Armchair, ArrowRight, BellRing, Check, Clock3, Compass, Dices, Fingerprint, Hourglass, LockKeyhole, ShieldCheck, Ticket, TicketCheck, Trophy, X, Zap } from "lucide-react";
import { api, formatDate, formatRemaining, joinDrop, loadDropsWithEntries, statusLabel, type Drop, type Entry, type User } from "../lib/api";
import { CountUp, Reveal, Ring, SceneBoundary } from "../components/fx";
import { DropCard } from "../components/DropCard";
import { SeatPicker } from "../components/SeatPicker";
import type { TicketFace } from "../three/ticketTexture";

const HoloTicketScene = lazy(() => import("../three/HoloTicketScene"));

const PRIORITY: Entry["status"][] = ["RESERVED", "CONFIRMED", "ENTERED", "WAITLISTED", "EXPIRED"];
const STEPS = ["Entered", "Drawn", "Reserved", "Confirmed"] as const;

function stepIndex(entry: Entry) {
  switch (entry.status) {
    case "ENTERED": return 0;
    case "WAITLISTED": case "EXPIRED": return 1;
    case "RESERVED": return 2;
    case "CONFIRMED": return STEPS.length;
  }
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function faceFor(drop: Drop | undefined, entry: Entry | undefined): TicketFace {
  if (!drop || !entry) return { kicker: "No entry yet", title: "YOUR NEXT DROP", subtitle: "ENTER ONCE · EQUAL ODDS", code: "FD-READY-WHEN-YOU-ARE", stamp: "ENTER ONCE", accent: "#a78bfa", accent2: "#22d3ee" };
  const subtitle = `${drop.venue} · ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(drop.eventDate))}`.toUpperCase().slice(0, 34);
  const title = drop.title.toUpperCase();
  const receipt = `RECEIPT ${entry.id.slice(-8).toUpperCase()}`;
  switch (entry.status) {
    case "CONFIRMED": return { kicker: "Ticket confirmed", title, subtitle, code: (entry.ticketCode ?? receipt).slice(0, 26), stamp: "YOU'RE IN", accent: "#a3e635", accent2: "#22d3ee" };
    case "RESERVED": return { kicker: "Seat reserved · confirm now", title, subtitle, code: entry.rank ? `DRAW RANK #${entry.rank}` : receipt, stamp: "HELD FOR YOU", accent: "#c084fc", accent2: "#f472b6" };
    case "WAITLISTED": return { kicker: "On the waitlist", title, subtitle, code: entry.rank ? `DRAW RANK #${entry.rank}` : receipt, stamp: "ON DECK", accent: "#fbbf24", accent2: "#f472b6" };
    case "EXPIRED": return { kicker: "Reservation expired", title, subtitle, code: receipt, stamp: "RELEASED", accent: "#fb7185", accent2: "#a78bfa" };
    default: return { kicker: "Entry received", title, subtitle, code: receipt, stamp: "IN THE DRAW", accent: "#22d3ee", accent2: "#a78bfa" };
  }
}

export function ParticipantDashboard({ user }: { user: User }) {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [entries, setEntries] = useState<Record<string, Entry | null>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [picking, setPicking] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const result = await loadDropsWithEntries(true);
      setDrops(result.drops); setEntries(result.entries); setError("");
    } catch { setError("We couldn’t reach the drop service. Your entries are safe — we’ll keep retrying."); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 4000); return () => window.clearInterval(timer); }, [refresh]);

  const confirm = async (dropId: string) => {
    setBusy(dropId); setToast("");
    try { await api(`/api/drops/${dropId}/confirm`, { method: "POST", body: "{}" }); setToast("Your ticket is confirmed. You’re going!"); setPicking(""); }
    catch (e) { setToast((e as Error).message); }
    finally { await refresh(); setBusy(""); }
  };
  const join = async (drop: Drop) => {
    setBusy(drop.id); setToast("");
    try { await joinDrop(drop.id); setToast(`You’re in the draw for ${drop.title}.`); }
    catch (e) { setToast((e as Error).message); }
    finally { await refresh(); setBusy(""); }
  };

  const mine = useMemo(() => drops.filter((drop) => entries[drop.id]).map((drop) => ({ drop, entry: entries[drop.id]! }))
    .sort((a, b) => PRIORITY.indexOf(a.entry.status) - PRIORITY.indexOf(b.entry.status)), [drops, entries]);
  const openToEnter = drops.filter((drop) => drop.status === "OPEN" && !entries[drop.id]);
  const featured = mine[0];
  const reservations = mine.filter(({ entry }) => entry.status === "RESERVED" && entry.reservationExpiresAt && new Date(entry.reservationExpiresAt).getTime() > Date.now());
  const count = (status: Entry["status"]) => mine.filter(({ entry }) => entry.status === status).length;
  const faceKey = featured ? `${featured.drop.id}:${featured.entry.status}:${featured.entry.rank}:${featured.entry.ticketCode}` : "none";
  // Keyed on what's printed so the 3D ticket only re-textures when its face changes.
  const face = useMemo(() => faceFor(featured?.drop, featured?.entry), [faceKey]);

  return <div className="dash-page">
    <header className="dash-header" id="overview">
      <div>
        <span className="section-kicker">PARTICIPANT DASHBOARD</span>
        <h1>{greeting()}, <span className="gradient-text">{user.name.split(" ")[0]}</span>.</h1>
        <p>Your entries, holds and tickets — saved server-side, safe across refreshes.</p>
      </div>
      <Link to="/" className="button button-ghost"><Compass size={16} /> Browse all drops</Link>
    </header>

    {toast && <div className="notice-banner" role="status">{toast}<button onClick={() => setToast("")} aria-label="Dismiss"><X size={15} /></button></div>}
    {error && <div className="error-banner">{error}</div>}

    <section className="p-hero-grid">
      <Reveal className="holo-panel glass">
        <div className="holo-head"><span className="section-kicker">{featured ? "YOUR SPOTLIGHT" : "READY WHEN YOU ARE"}</span>{featured && <span className={`receipt-status receipt-${featured.entry.status.toLowerCase()}`}><span className="status-dot" />{statusLabel(featured.entry.status)}</span>}</div>
        <div className="holo-stage"><SceneBoundary fallback={<div className="holo-fallback"><Ticket size={64} strokeWidth={1} /></div>}><HoloTicketScene face={face} /></SceneBoundary></div>
        <div className="holo-foot">{featured ? <><strong>{featured.drop.title}</strong><span>{formatDate(featured.drop.eventDate)} · {featured.drop.venue}</span></> : <><strong>No entries yet</strong><span>Enter an open drop and your holographic pass appears here.</span></>}</div>
      </Reveal>
      <div className="p-stats">
        {[
          { label: "ENTRIES", value: mine.length, icon: <TicketCheck size={18} />, tone: "cyan" },
          { label: "LIVE DROPS", value: drops.filter((d) => d.status === "OPEN").length, icon: <Zap size={18} />, tone: "violet" },
          { label: "SEATS HELD", value: count("RESERVED"), icon: <Hourglass size={18} />, tone: "pink" },
          { label: "TICKETS", value: count("CONFIRMED"), icon: <Trophy size={18} />, tone: "lime" },
        ].map((stat, i) => <Reveal key={stat.label} delay={i * 80} className={`stat-tile glass tone-${stat.tone}`}>
          <span className="stat-icon">{stat.icon}</span>
          <strong>{loaded ? <CountUp value={stat.value} /> : "—"}</strong>
          <span>{stat.label}</span>
        </Reveal>)}
        <Reveal delay={320} className="promise-tile glass"><ShieldCheck size={18} /><div><strong>Fair by design</strong><span>Refreshing never creates another entry. Your draw position can’t be bought with speed.</span></div></Reveal>
      </div>
    </section>

    {reservations.map(({ drop, entry }) => <ReservationAlert key={drop.id} drop={drop} entry={entry} busy={busy === drop.id} onConfirm={() => void confirm(drop.id)} onPickSeat={() => setPicking(drop.id)} />)}

    <section id="tickets" className="dash-section">
      <div className="dash-section-head"><div><span className="section-kicker">YOUR ENTRIES</span><h2>Receipts &amp; tickets</h2></div><span className="table-count">{mine.length} saved</span></div>
      {!loaded ? <div className="entry-grid">{[0, 1].map((i) => <div key={i} className="skeleton-card glass short" />)}</div>
        : mine.length === 0 ? <div className="empty-state glass"><div className="empty-icon"><Ticket size={22} /></div><h3>No entries yet</h3><p>When you enter a drop, your saved receipt appears here.</p><a className="button button-primary" href="#open-drops">See open drops <ArrowRight size={15} /></a></div>
        : <div className="entry-grid">{mine.map(({ drop, entry }, i) => <Reveal key={drop.id} delay={i * 70}><EntryCard drop={drop} entry={entry} busy={busy === drop.id} onConfirm={() => void confirm(drop.id)} onPickSeat={() => setPicking(drop.id)} /></Reveal>)}</div>}
    </section>

    <section id="open-drops" className="dash-section">
      <div className="dash-section-head"><div><span className="section-kicker">ENTER NOW</span><h2>Open drops you haven’t entered</h2></div><span className="drop-count"><span className="live-pulse" /> {openToEnter.length} OPEN</span></div>
      {openToEnter.length === 0 ? <div className="empty-inline glass"><Check size={16} /> You’re in every open drop. We’ll show new ones here the moment they open.</div>
        : <div className="drop-grid">{openToEnter.map((drop, index) => <DropCard key={drop.id} drop={drop} entry={null} index={index} joining={busy === drop.id} onJoin={() => void join(drop)} />)}</div>}
    </section>

    {(() => {
      const target = picking ? mine.find(({ drop }) => drop.id === picking) : undefined;
      return target ? <SeatPicker drop={target.drop} entry={target.entry} busy={busy === target.drop.id} onClose={() => setPicking("")} onChanged={() => void refresh()} onConfirm={() => void confirm(target.drop.id)} /> : null;
    })()}

    <div className="receipt-note glass"><ShieldCheck size={17} /><span>This dashboard checks your saved status every few seconds. It never creates another entry.</span></div>
  </div>;
}

function ReservationAlert({ drop, entry, busy, onConfirm, onPickSeat }: { drop: Drop; entry: Entry; busy: boolean; onConfirm: () => void; onPickSeat: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(id); }, []);
  const total = drop.reservationMinutes * 60_000;
  const left = Math.max(0, new Date(entry.reservationExpiresAt!).getTime() - Date.now());
  return <Reveal className="reservation-alert glass">
    <Ring value={left / total} size={104} stroke={8} tone={left < 60_000 ? "red" : "violet"}><strong>{formatRemaining(entry.reservationExpiresAt)}</strong><span>LEFT</span></Ring>
    <div className="reservation-copy">
      <span className="section-kicker"><BellRing size={13} /> ACTION NEEDED</span>
      <h3>A seat at <span className="gradient-text">{drop.title}</span> is yours — for now.</h3>
      <p>Your draw rank {entry.rank ? `#${entry.rank}` : ""} won a seat. Confirm before the hold expires or it rolls to the next person on the waitlist.</p>
    </div>
    {drop.seatMap && !entry.seat
      ? <button className="button button-primary button-lg" onClick={onPickSeat}><Armchair size={16} /> Pick your seat</button>
      : <button className="button button-primary button-lg" onClick={onConfirm} disabled={busy}>{busy ? "Confirming…" : entry.seat ? `Confirm · seat ${entry.seat.label}` : "Confirm ticket"}<ArrowRight size={16} /></button>}
  </Reveal>;
}

function EntryCard({ drop, entry, busy, onConfirm, onPickSeat }: { drop: Drop; entry: Entry; busy: boolean; onConfirm: () => void; onPickSeat: () => void }) {
  const [time, setTime] = useState(formatRemaining(entry.reservationExpiresAt));
  useEffect(() => { const id = window.setInterval(() => setTime(formatRemaining(entry.reservationExpiresAt)), 1000); return () => window.clearInterval(id); }, [entry.reservationExpiresAt]);
  const canConfirm = entry.status === "RESERVED" && !!entry.reservationExpiresAt && new Date(entry.reservationExpiresAt).getTime() > Date.now();
  const step = stepIndex(entry);
  const offTrack = entry.status === "WAITLISTED" || entry.status === "EXPIRED";
  return <article className={`entry-card glass entry-tone-${entry.status.toLowerCase()}`}>
    <div className="entry-card-top">
      <div><span className="section-kicker">{formatDate(drop.eventDate)} · {drop.venue}</span><h3>{drop.title}</h3></div>
      <span className={`receipt-status receipt-${entry.status.toLowerCase()}`}><span className="status-dot" />{statusLabel(entry.status)}</span>
    </div>
    <ol className={`stepper ${offTrack ? "stepper-off" : ""}`}>
      {STEPS.map((label, i) => <li key={label} className={i < step ? "done" : i === step ? "current" : ""}><span className="step-dot">{i < step ? <Check size={11} /> : i + 1}</span><span>{i === 2 && entry.status === "WAITLISTED" ? "Waitlist" : i === 2 && entry.status === "EXPIRED" ? "Expired" : label}</span></li>)}
    </ol>
    <div className="entry-details">
      <div><span>RECEIPT</span><strong>{entry.id.slice(-8).toUpperCase()}</strong></div>
      <div><span>DRAW POSITION</span><strong>{entry.rank ? `#${entry.rank}` : "Pending"}</strong></div>
      <div><span>POLICY</span><strong>{drop.allocationPolicy === "RANDOM_DRAW" ? "Random draw" : "First come"}</strong>{entry.rank && drop.allocationPolicy === "RANDOM_DRAW" && <Link className="verify-link" to={`/verify/${drop.id}?receipt=${entry.id.slice(-8)}`}><Fingerprint size={12} /> Verify draw</Link>}</div>
    </div>
    {drop.seatMap && (entry.status === "RESERVED" || entry.status === "CONFIRMED") && <div className="seat-chip-row">
      <Armchair size={15} /><span>{entry.seat ? <>Seat <b>{entry.seat.label}</b>{entry.status === "RESERVED" ? " · held for you" : " · booked"}</> : "No seat picked yet"}</span>
      {canConfirm && <button type="button" className="text-link seat-change" onClick={onPickSeat}>{entry.seat ? "Change seat" : "Pick a seat"}</button>}
    </div>}
    {entry.status === "CONFIRMED" && <div className="ticket-confirmed"><div><span>YOUR SIMULATED TICKET{entry.seat ? ` · SEAT ${entry.seat.label}` : ""}</span><strong>{entry.ticketCode}</strong></div><span className="confirmed-stamp"><Check size={14} /> CONFIRMED</span></div>}
    <div className="entry-actions">
      {canConfirm ? <><span className="countdown"><Clock3 size={14} /> {time}</span>{drop.seatMap && !entry.seat
          ? <button className="button button-primary" onClick={onPickSeat}><Armchair size={15} /> Pick your seat</button>
          : <button className="button button-primary" onClick={onConfirm} disabled={busy}>{busy ? "Confirming…" : "Confirm your ticket"}<ArrowRight size={15} /></button>}</>
        : entry.status === "ENTERED" ? <span className="receipt-wait"><Dices size={14} /> Draw runs after the entry window closes</span>
        : entry.status === "WAITLISTED" ? <span className="receipt-wait"><Hourglass size={14} /> Your position is saved. A seat may free up.</span>
        : entry.status === "EXPIRED" ? <span className="receipt-wait"><LockKeyhole size={14} /> This hold expired and was released to the waitlist.</span>
        : <span className="receipt-wait"><Check size={14} /> Your ticket is secured. Safe to close this page.</span>}
    </div>
  </article>;
}
