import { lazy, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, LayoutDashboard, LockKeyhole, LogOut, Menu, ShieldCheck, Ticket, X } from "lucide-react";
import { api, homeFor, type User } from "./lib/api";
import { SceneBoundary, usePrefersReducedMotion } from "./components/fx";
import { DashShell } from "./components/DashShell";
import { Discover } from "./pages/Discover";
import { AuthPage } from "./pages/AuthPage";
import { ParticipantDashboard } from "./pages/ParticipantDashboard";
import { OrganizerDashboard } from "./pages/OrganizerDashboard";
import { AttackLab } from "./pages/AttackLab";
import { VerifyDraw } from "./pages/VerifyDraw";

const BackgroundScene = lazy(() => import("./three/BackgroundScene"));

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    api<{ user: User }>("/api/auth/me").then(({ user }) => setUser(user)).catch(() => setUser(null)).finally(() => setAuthReady(true));
  }, []);

  const signOut = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } finally {
      setUser(null); navigate("/");
    }
  };

  return <>
    <SceneBoundary fallback={<div className="bg-fallback" aria-hidden="true" />}><BackgroundScene still={reduced} /></SceneBoundary>
    {!authReady ? <div className="boot"><span className="brand-mark boot-mark"><Ticket size={22} /></span><span className="boot-text">fair<span>drop</span></span><span className="boot-bar" /></div>
      : <Routes>
        <Route element={<PublicLayout user={user} onSignOut={() => void signOut()} />}>
          <Route path="/" element={<Discover user={user} />} />
          <Route path="/sign-in" element={<AuthPage mode="login" onAuth={setUser} />} />
          <Route path="/register" element={<AuthPage mode="register" onAuth={setUser} />} />
          <Route path="/verify/:dropId" element={<VerifyDraw />} />
          <Route path="*" element={<Discover user={user} />} />
        </Route>
        <Route path="/my-entry" element={<Navigate to="/dashboard" replace />} />
        <Route element={<RequireRole user={user} role="PARTICIPANT"><DashShell user={user!} kind="participant" onSignOut={() => void signOut()} /></RequireRole>}>
          <Route path="/dashboard" element={<ParticipantDashboard user={user!} />} />
        </Route>
        <Route element={<RequireRole user={user} role="ORGANIZER"><DashShell user={user!} kind="organizer" onSignOut={() => void signOut()} /></RequireRole>}>
          <Route path="/organizer" element={<OrganizerDashboard />} />
          <Route path="/attack-lab" element={<AttackLab />} />
        </Route>
      </Routes>}
  </>;
}

/** Sends signed-out visitors to sign in, and each role to its own dashboard. */
function RequireRole({ user, role, children }: { user: User | null; role: User["role"]; children: ReactNode }) {
  const location = useLocation();
  if (!user) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (user.role === role) return children;
  if (user.role === "ORGANIZER") return <Navigate to="/organizer" replace />;
  return <div className="public-shell"><section className="container restricted glass"><div className="empty-icon"><LockKeyhole size={20} /></div><h2>Organizer access only</h2><p>Your account doesn’t have organizer permissions yet. Add its email to ORGANIZER_EMAILS in your environment and create a new account.</p><Link className="button button-primary" to="/dashboard">Go to my dashboard <ArrowRight size={15} /></Link></section></div>;
}

function PublicLayout({ user, onSignOut }: { user: User | null; onSignOut: () => void }) {
  const [drawer, setDrawer] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setDrawer(false), [location.pathname]);
  const dashboard = homeFor(user);
  return <div className="public-shell">
    <header className={`topbar ${scrolled ? "topbar-scrolled" : ""}`}>
      <Link to="/" className="brand" aria-label="Fair Drop home"><span className="brand-mark"><Ticket size={17} strokeWidth={2.3} /></span><span>fair<span className="brand-light">drop</span></span></Link>
      <nav className={`nav-links ${drawer ? "nav-open" : ""}`} aria-label="Main navigation">
        <Link to="/" className={location.pathname === "/" ? "nav-active" : ""}>Discover</Link>
        <a href="/#how">How it works</a>
        <a href="/#drops">Drops</a>
        {user && <Link to={dashboard}>{user.role === "ORGANIZER" ? "Command center" : "My dashboard"}</Link>}
        {user ? <button className="mobile-signout" onClick={onSignOut}><LogOut size={15} /> Sign out</button>
          : <><Link to="/sign-in" className="mobile-only">Sign in</Link><Link to="/register" className="mobile-only">Create account</Link></>}
      </nav>
      <div className="topbar-actions">
        <span className="live-note"><span className="live-pulse" /> FAIR BY DESIGN</span>
        {user ? <Link className="button button-small button-glow" to={dashboard}><LayoutDashboard size={15} /> Dashboard</Link>
          : <><Link className="button button-small button-quiet" to="/sign-in">Sign in</Link><Link className="button button-small button-glow" to="/register">Get started <ArrowRight size={15} /></Link></>}
      </div>
      <button className="menu-toggle" onClick={() => setDrawer(!drawer)} aria-label={drawer ? "Close menu" : "Open menu"}>{drawer ? <X size={21} /> : <Menu size={21} />}</button>
    </header>
    <main><Outlet /></main>
    <footer className="site-footer"><Link to="/" className="footer-brand">FAIR<span>DROP</span></Link><span>Test every policy. Show the evidence.</span><span className="footer-right"><ShieldCheck size={14} /> One account. One entry. Saved state.</span></footer>
  </div>;
}
