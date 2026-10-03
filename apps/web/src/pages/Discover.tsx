import { lazy, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bot, Dices, Gauge, LockKeyhole, RefreshCcw, ShieldCheck, Ticket, Timer, UserRound, X, Zap } from "lucide-react";
import { homeFor, joinDrop, loadDropsWithEntries, type Drop, type Entry, type User } from "../lib/api";
import { CountUp, Reveal, SceneBoundary, ScrambleText } from "../components/fx";
import { DropCard } from "../components/DropCard";

const HeroScene = lazy(() => import("../three/HeroScene"));

const MARQUEE = ["ONE ELIGIBLE ACCOUNT", "ONE ENTRY", "RANDOM DRAW", "RATE LIMITED", "IDEMPOTENT RETRIES", "NO OVERSELLING", "SAVED STATE", "RETRIES DON'T MULTIPLY CHANCES"];

export function Discover({ user }: { user: User | null }) {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [entries, setEntries] = useState<Record<string, Entry | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    try {
      const result = await loadDropsWithEntries(!!user);
      setDrops(result.drops); setEntries(result.entries); setError("");
    } catch { setError("We couldn’t reach the drop service. Check that the API and database are running."); }
    finally { setLoading(false); }
  }, [user]);
  useEffect(() => { void refresh(); const interval = window.setInterval(() => void refresh(), 8000); return () => window.clearInterval(interval); }, [refresh]);

  const join = async (drop: Drop) => {
    if (!user) { navigate(`/sign-in?next=${encodeURIComponent("/")}`); return; }
    setBusy(drop.id); setNotice("");
    try {
      await joinDrop(drop.id);
      setNotice("You’re in. Your receipt is saved to your dashboard."); await refresh();
    } catch (e) { setNotice((e as Error).message); }
    finally { setBusy(""); }
  };

  const openCount = drops.filter((drop) => drop.status === "OPEN").length;
  const seats = drops.reduce((sum, drop) => sum + drop.capacity, 0);
  return <>
    <section className="hero">
      <div className="hero-scene" aria-hidden="true"><SceneBoundary fallback={<div className="hero-fallback" />}><HeroScene /></SceneBoundary></div>
      <div className="container hero-inner">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /><ScrambleText text="THE DROP, REIMAGINED" /></div>
          <h1><span className="h1-line">Speed should not</span><span className="h1-line gradient-text">buy an extra chance.</span></h1>
          <p className="hero-description">Fair Drop separates entry from allocation. Eligible users enter during a fixed window, repeated requests don’t create extra entries, and allocation happens only after the window closes.</p>
          <div className="hero-actions">
            <a href="#drops" className="button button-primary button-lg">Find your drop <ArrowRight size={17} /></a>
            {user ? <Link to={homeFor(user)} className="button button-ghost button-lg">Open dashboard</Link> : <Link to="/register" className="button button-ghost button-lg">Create account</Link>}
          </div>
          <div className="hero-stats">
            <div><strong><CountUp value={openCount} /></strong><span>LIVE DROPS</span></div>
            <div><strong><CountUp value={seats} /></strong><span>SEATS ON OFFER</span></div>
            <div><strong>1</strong><span>ENTRY / ELIGIBLE ACCOUNT</span></div>
          </div>
        </div>
        <div className="hero-hud" aria-hidden="true">
          <div className="hud-chip hud-a"><span className="hud-dot gold" /> 500 golden seats in the swarm</div>
          <div className="hud-chip hud-b"><ShieldCheck size={13} /> Automation shouldn’t buy an advantage</div>
        </div>
      </div>
      <a href="#how" className="scroll-cue" aria-label="Scroll down"><span /></a>
    </section>

    <div className="marquee" aria-hidden="true"><div className="marquee-track">{[...MARQUEE, ...MARQUEE, ...MARQUEE].map((word, i) => <span key={i}>{word}<i>✳</i></span>)}</div></div>

    <section id="how" className="container how-section">
      <Reveal className="section-heading centered"><span className="section-kicker">BUILT FOR THE BIG MOMENT</span><h2>Good luck shouldn’t need <span className="gradient-text">a faster connection.</span></h2></Reveal>
      <div className="how-grid">
        {[
          { icon: <UserRound size={22} />, n: "01", title: "Enter once", body: "Your spot is saved server-side. Retrying never creates a second entry." },
          { icon: <Timer size={22} />, n: "02", title: "Let the window close", body: "No race, no refresh. In a protected drop, entering in minute one or minute twenty gives the same chance." },
          { icon: <Dices size={22} />, n: "03", title: "The sealed draw", body: "The eligible list is frozen and shuffled once. The order is saved for good." },
          { icon: <Ticket size={22} />, n: "04", title: "Confirm your seat", body: "Winners get a timed hold. Expired holds roll to the next on the waitlist." },
        ].map((step, i) => <Reveal key={step.n} delay={i * 110} className="how-card glass">
          <div className="how-card-top"><span className="how-icon">{step.icon}</span><span className="how-n">{step.n}</span></div>
          <h3>{step.title}</h3><p>{step.body}</p>
        </Reveal>)}
      </div>
    </section>

    <section className="container versus-section">
      <Reveal className="versus glass">
        <div className="versus-side versus-bad">
          <span className="section-kicker">THE USUAL DROP</span>
          <h3><Bot size={20} /> A race between scripts</h3>
          <ul>
            <li><Zap size={14} /> Thousands of requests per second win the queue</li>
            <li><RefreshCcw size={14} /> Refreshing and retrying improves your odds</li>
            <li><Gauge size={14} /> Systems buckle under the flash crowd</li>
          </ul>
          <div className="race-bars">{[96, 88, 82, 14, 9, 6].map((w, i) => <div key={i} className={i < 3 ? "race-bot" : "race-human"} style={{ width: `${w}%` }}><span>{i < 3 ? "BOT" : "FAN"}</span></div>)}</div>
        </div>
        <div className="versus-divider"><span>VS</span></div>
        <div className="versus-side versus-good">
          <span className="section-kicker">FAIR DROP</span>
          <h3><ShieldCheck size={20} /> A randomized draw between eligible entries</h3>
          <ul>
            <li><LockKeyhole size={14} /> One eligible account, one entry, enforced in the database</li>
            <li><ShieldCheck size={14} /> Per-account and per-IP budgets throttle floods; retries don’t multiply chances</li>
            <li><Dices size={14} /> Allocation happens after the window closes, so speed doesn’t buy an extra chance</li>
          </ul>
          <div className="race-bars">{[50, 50, 50, 50, 50, 50].map((w, i) => <div key={i} className="race-fair" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }}><span>{i < 3 ? "BOT" : "FAN"}</span></div>)}</div>
        </div>
      </Reveal>
    </section>

    <section id="drops" className="drops-section container">
      <Reveal className="section-heading"><div><span className="section-kicker">THE LINEUP</span><h2>Drops worth the wait<span className="heading-period">.</span></h2></div><span className="drop-count"><span className="live-pulse" /> {openCount} LIVE NOW</span></Reveal>
      {notice && <div className="notice-banner" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
      {error && <div className="error-banner">{error}</div>}
      {loading ? <div className="drop-grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton-card glass" />)}</div>
        : drops.length === 0 ? <div className="empty-state glass"><div className="empty-icon"><Ticket size={22} /></div><h3>No drops just yet</h3><p>Check back soon. When a drop opens, you’ll find it right here.</p></div>
        : <div className="drop-grid">{drops.map((drop, index) => <Reveal key={drop.id} delay={(index % 3) * 90}><DropCard drop={drop} entry={entries[drop.id] ?? null} onJoin={() => void join(drop)} joining={busy === drop.id} index={index} /></Reveal>)}</div>}
      <Reveal className="fairness-callout glass"><div className="fairness-seal"><ShieldCheck size={20} /></div><div><strong>Compare the baseline with the protected draw.</strong><span>Protected drops freeze the eligible list, draw a random order, and save it. Entry timing doesn’t determine rank in that mode.</span></div><Link to={user ? homeFor(user) : "/register"} className="text-link">{user ? "Open dashboard" : "Get started"} <ArrowRight size={14} /></Link></Reveal>
    </section>
  </>;
}
