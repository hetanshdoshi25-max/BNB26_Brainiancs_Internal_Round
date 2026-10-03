import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Check, Clock3, Fingerprint, Music2, Radio, ShieldCheck, Sparkles } from "lucide-react";
import { formatDate, statusLabel, type Drop, type Entry } from "../lib/api";
import { TiltCard } from "./fx";

const ICONS = [Radio, Music2, Sparkles];

export function DropCard({ drop, entry, onJoin, joining, index, entryHref = "/dashboard" }: { drop: Drop; entry: Entry | null; onJoin: () => void; joining: boolean; index: number; entryHref?: string }) {
  const state = entry?.status;
  const tone = drop.status === "OPEN" ? "open" : drop.status === "DRAFT" ? "draft" : "closed";
  const end = drop.closesAt ? new Date(drop.closesAt).getTime() : 0;
  const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000 / 60));
  const Icon = ICONS[index % ICONS.length]!;
  return <TiltCard className={`drop-card hue-${index % 3}`}>
    <div className="card-art">
      <div className="card-art-web" />
      <span className="card-art-orb" />
      <span className="card-genre">{index % 2 ? "LIVE MUSIC" : "ONE NIGHT ONLY"}</span>
      <span className="card-art-symbol"><Icon size={64} strokeWidth={1.1} /></span>
      <span className="card-art-index">FD/{String(index + 1).padStart(2, "0")}</span>
      <span className={`status-pill status-${tone}`}>{tone === "open" && <span className="live-pulse" />}{statusLabel(drop.status)}</span>
    </div>
    <div className="card-content">
      <div className="card-date">{formatDate(drop.eventDate)} <span>·</span> {drop.venue}</div>
      <h3>{drop.title}</h3>
      <p>{drop.description || "A limited-capacity event. One entry per eligible account."}</p>
      <div className="card-stats">
        <div><strong>{drop.capacity.toLocaleString()}</strong><span>SEATS</span></div>
        <div><strong>{drop.status === "OPEN" && remaining ? `${remaining}m` : state ? statusLabel(state) : drop.status === "DRAFT" ? "SOON" : "DRAWN"}</strong><span>{drop.status === "OPEN" ? "TIME LEFT" : "YOUR STATUS"}</span></div>
        <div><strong>{drop.allocationPolicy === "RANDOM_DRAW" ? "DRAW" : "FCFS"}</strong><span>{drop.allocationPolicy === "RANDOM_DRAW" ? "PROTECTED" : "BASELINE"}</span></div>
      </div>
      <div className="card-bottom">
        {state ? <div className={`entry-chip entry-${state.toLowerCase()}`}><Check size={14} /> {statusLabel(state)}</div>
          : <span className="card-reassurance">{drop.allocationPolicy === "RANDOM_DRAW" ? (drop.drawSeedHash
            ? <span title={`Published seed hash: ${drop.drawSeedHash}`}><Fingerprint size={13} /> Draw sealed · <code>{drop.drawSeedHash.slice(0, 8)}</code></span>
            : <><ShieldCheck size={13} /> Arrival speed won’t set rank</>) : <><Clock3 size={13} /> Arrival order sets rank</>}</span>}
        {drop.status === "OPEN" && !state ? <button className="button button-primary card-cta" disabled={joining} onClick={onJoin}>{joining ? "Verifying & saving…" : "Enter the draw"}<ArrowUpRight size={15} /></button>
          : state ? <Link className="card-link" to={entryHref}>View entry <ArrowRight size={14} /></Link>
          : <span className="card-link muted-link">{drop.status === "DRAFT" ? "Opening soon" : "Entry closed"}</span>}
      </div>
    </div>
  </TiltCard>;
}
