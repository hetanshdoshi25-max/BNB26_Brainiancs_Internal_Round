import { lazy, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Check, LockKeyhole, Ticket } from "lucide-react";
import { api, homeFor, type User } from "../lib/api";
import { solvePow } from "../lib/pow";
import { getSignals } from "../lib/humanSignals";
import { SceneBoundary } from "../components/fx";

const HeroScene = lazy(() => import("../three/HeroScene"));

const AUTH_FACE = {
  kicker: "Your chance · fairly drawn",
  title: "ADMIT ONE",
  subtitle: "ONE ACCOUNT · ONE ENTRY",
  code: "FD-YOUR-NEXT-NIGHT",
  stamp: "ONE ENTRY",
  accent: "#22d3ee",
  accent2: "#a78bfa",
};

export function AuthPage({ mode, onAuth }: { mode: "login" | "register"; onAuth: (user: User) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const location = useLocation(); const navigate = useNavigate();
  const isRegister = mode === "register";
  const requestedNext = new URLSearchParams(location.search).get("next");
  const safeNext = requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { email: String(form.get("email")), password: String(form.get("password")) };
    try {
      if (isRegister) {
        // Sign-up costs a small proof-of-work and carries aggregate interaction signals,
        // which makes mass account creation by scripts expensive.
        setVerifying(true);
        const [pow, signals] = await Promise.all([solvePow("register"), Promise.resolve(getSignals())]);
        setVerifying(false);
        Object.assign(payload, { name: String(form.get("name")), pow: pow?.proof, signals });
      }
      const data = await api<{ user: User }>(`/api/auth/${isRegister ? "register" : "login"}`, { method: "POST", body: JSON.stringify(payload) });
      onAuth(data.user);
      // Each role lands on its own dashboard unless a specific page was requested.
      navigate(safeNext ?? homeFor(data.user));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setVerifying(false); }
  };
  return <section className="auth-wrap container">
    <div className="auth-aside glass">
      <div className="auth-scene" aria-hidden="true"><SceneBoundary><HeroScene face={AUTH_FACE} compact /></SceneBoundary></div>
      <div className="auth-aside-inner">
        <span className="eyebrow"><span className="eyebrow-line" /> ONE ELIGIBLE ACCOUNT · ONE ENTRY</span>
        <h1>Your chance.<br /><span className="gradient-text">Fairly drawn.</span></h1>
        <p>Because getting there first shouldn’t mean getting in first.</p>
        <div className="auth-mini-ticket"><div className="mini-ticket-icon"><Ticket size={20} /></div><div><span>THE FAIR DROP PROMISE</span><strong>Retries don’t multiply chances.</strong></div><Check size={17} /></div>
      </div>
    </div>
    <div className="auth-form-side">
      <form className="auth-form glass" onSubmit={submit}>
        <span className="section-kicker">{isRegister ? "GET IN ON THE NEXT ONE" : "GOOD TO HAVE YOU BACK"}</span>
        <h2>{isRegister ? "Create your account" : "Welcome back"}<span className="heading-period">.</span></h2>
        <p className="auth-subtitle">{isRegister ? "One account keeps every entry in one place." : "Organizers land in the command center. Fans land in their dashboard."}</p>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {isRegister && <label className="field-label">Your name<div className="input-wrap"><input name="name" autoComplete="name" placeholder="Alex Morgan" minLength={2} maxLength={80} required /></div></label>}
        <label className="field-label">Email address<div className="input-wrap"><span className="input-at">@</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required /></div></label>
        <label className="field-label">Password<div className="input-wrap"><LockKeyhole size={16} className="input-icon" /><input name="password" type={showPassword ? "text" : "password"} autoComplete={isRegister ? "new-password" : "current-password"} placeholder={isRegister ? "At least 10 characters" : "Your password"} minLength={isRegister ? 10 : 1} maxLength={128} required /><button type="button" className="show-password" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button></div>{isRegister && <span className="field-hint">Use 10 or more characters.</span>}</label>
        <button className="button button-primary auth-submit" disabled={busy}>{verifying ? "Running security check…" : busy ? "One moment…" : isRegister ? "Create account" : "Sign in"}<ArrowRight size={16} /></button>
        <div className="auth-divider"><span>YOUR ENTRY IS YOURS</span></div>
        <p className="auth-privacy"><LockKeyhole size={13} /> Your account keeps your entry and reservation safe across refreshes.</p>
        <p className="auth-switch">{isRegister ? "Already have an account?" : "New around here?"} <Link to={`${isRegister ? "/sign-in" : "/register"}${location.search}`}>{isRegister ? "Sign in" : "Create an account"}</Link></p>
      </form>
    </div>
  </section>;
}
