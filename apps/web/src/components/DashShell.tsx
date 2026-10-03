import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Compass, FlaskConical, Gauge, LayoutDashboard, LogOut, ShieldCheck, Ticket, TicketCheck, Zap } from "lucide-react";
import { api, type User } from "../lib/api";

type NavItem = { to: string; label: string; icon: ReactNode; hash?: boolean };

function useApiHealth() {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => api("/api/health").then(() => setHealthy(true)).catch(() => setHealthy(false));
    void check();
    const timer = window.setInterval(check, 15000);
    return () => window.clearInterval(timer);
  }, []);
  return healthy;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(id); }, []);
  return <span className="dash-clock">{now.toLocaleTimeString("en", { hour12: false })}</span>;
}

/** Sidebar layout shared by the participant and organizer dashboards. */
export function DashShell({ user, kind, onSignOut }: { user: User; kind: "participant" | "organizer"; onSignOut: () => void }) {
  const healthy = useApiHealth();
  const items: NavItem[] = kind === "organizer"
    ? [
      { to: "/organizer", label: "Command center", icon: <LayoutDashboard size={17} /> },
      { to: "/attack-lab", label: "Attack lab", icon: <FlaskConical size={17} /> },
      { to: "/", label: "Public site", icon: <Compass size={17} /> },
    ]
    : [
      { to: "/dashboard", label: "Overview", icon: <LayoutDashboard size={17} /> },
      { to: "#tickets", label: "My entries", icon: <TicketCheck size={17} />, hash: true },
      { to: "#open-drops", label: "Open drops", icon: <Zap size={17} />, hash: true },
      { to: "/", label: "Discover", icon: <Compass size={17} /> },
    ];
  return <div className={`dash-shell dash-${kind}`}>
    <aside className="dash-side">
      <Link to="/" className="brand" aria-label="Fair Drop home"><span className="brand-mark"><Ticket size={17} strokeWidth={2.3} /></span><span>fair<span className="brand-light">drop</span></span></Link>
      <div className={`role-badge role-${kind}`}>{kind === "organizer" ? <><ShieldCheck size={13} /> ORGANIZER</> : <><Gauge size={13} /> PARTICIPANT</>}</div>
      <nav className="dash-nav" aria-label="Dashboard">
        {items.map((item) => item.hash
          ? <a key={item.to} href={item.to}>{item.icon}<span>{item.label}</span></a>
          : <NavLink key={item.to} to={item.to} end className={({ isActive }) => isActive ? "dash-nav-active" : ""}>{item.icon}<span>{item.label}</span></NavLink>)}
      </nav>
      <div className="dash-side-status">
        <span className={`health-dot ${healthy === false ? "health-down" : healthy ? "health-up" : ""}`} />
        <div><strong>{healthy === false ? "API unreachable" : "All systems live"}</strong><Clock /></div>
      </div>
      <div className="dash-user">
        <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
        <div className="dash-user-text"><strong>{user.name}</strong><small>{user.email}</small></div>
        <button className="icon-btn" onClick={onSignOut} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
      </div>
    </aside>
    <main className="dash-main"><Outlet /></main>
  </div>;
}
