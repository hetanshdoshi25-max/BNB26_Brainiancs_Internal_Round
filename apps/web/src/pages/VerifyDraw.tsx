import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, CircleAlert, Fingerprint, LoaderCircle, LockKeyhole, Search, ShieldCheck, X } from "lucide-react";
import { api, formatDate, type Drop } from "../lib/api";
import { seededShuffle, sha256Hex } from "../lib/verifiableDraw";

type Audit = {
  drop: Pick<Drop, "id" | "title" | "capacity" | "status" | "allocationPolicy" | "opensAt" | "drawCompletedAt" | "drawSeedHash" | "drawCommittedAt">;
  revealed: boolean;
  seed: string | null;
  committedBeforeEntry: boolean;
  entries: Array<{ id: string; rank: number; arrival: number }>;
};
type StepState = "pending" | "running" | "pass" | "fail" | "skip";
type Step = { key: string; label: string; state: StepState; detail?: string };

export function VerifyDraw() {
  const { dropId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [progress, setProgress] = useState(0);
  const [receipt, setReceipt] = useState(params.get("receipt") ?? "");

  useEffect(() => {
    api<Audit>(`/api/drops/${dropId}/audit`).then(setAudit).catch((e) => setError((e as Error).message));
  }, [dropId]);

  useEffect(() => {
    if (!audit?.revealed) return;
    let cancelled = false;
    const update = (key: string, patch: Partial<Step>) => setSteps((all) => all.map((step) => (step.key === key ? { ...step, ...patch } : step)));
    const n = audit.entries.length;
    const random = audit.drop.allocationPolicy === "RANDOM_DRAW";
    setSteps(random
      ? [
        { key: "hash", label: "Revealed seed matches the published commitment", state: "pending" },
        { key: "timing", label: "Commitment was published when entry opened, before anyone entered", state: "pending" },
        { key: "shuffle", label: `Re-ran the shuffle for ${n.toLocaleString()} entries in your browser`, state: "pending" },
      ]
      : [{ key: "arrival", label: `First-come policy: ranks follow arrival order for ${n.toLocaleString()} entries`, state: "pending" }]);

    (async () => {
      if (!random) {
        const byArrival = [...audit.entries].sort((a, b) => a.arrival - b.arrival);
        const mismatches = byArrival.filter((entry, index) => entry.rank !== index + 1).length;
        update("arrival", { state: mismatches ? "fail" : "pass", detail: mismatches ? `${mismatches} ranks differ from arrival order` : "Every rank equals arrival position" });
        return;
      }
      update("hash", { state: "running" });
      const hash = await sha256Hex(audit.seed ?? "");
      if (cancelled) return;
      update("hash", { state: hash === audit.drop.drawSeedHash ? "pass" : "fail", detail: `SHA-256(seed) = ${hash.slice(0, 16)}…` });
      update("timing", audit.committedBeforeEntry
        ? { state: "pass", detail: `Committed ${formatDate(audit.drop.drawCommittedAt!)}` }
        : { state: "fail", detail: "This drop opened before commitments existed, so its seed was generated at draw time." });
      update("shuffle", { state: "running" });
      const started = performance.now();
      const order = await seededShuffle(audit.entries.map((entry) => entry.id), audit.seed ?? "", (done) => !cancelled && setProgress(done / Math.max(1, n)));
      if (cancelled) return;
      const rankById = new Map(audit.entries.map((entry) => [entry.id, entry.rank]));
      const mismatches = order.filter((id, index) => rankById.get(id) !== index + 1).length;
      setProgress(1);
      update("shuffle", {
        state: mismatches ? "fail" : "pass",
        detail: mismatches ? `${mismatches} of ${n} ranks differ` : `All ${n.toLocaleString()} ranks match · ${Math.round(performance.now() - started)} ms`,
      });
    })().catch((e) => setError((e as Error).message));
    return () => { cancelled = true; };
  }, [audit]);

  const found = useMemo(() => {
    const code = receipt.trim().toLowerCase();
    if (!audit || code.length < 6) return null;
    return audit.entries.find((entry) => entry.id.toLowerCase().endsWith(code)) ?? undefined;
  }, [audit, receipt]);

  const verdict = steps.length && steps.every((step) => step.state === "pass") ? "pass" : steps.some((step) => step.state === "fail") ? "fail" : "running";

  return <section className="container verify-page">
    <button type="button" onClick={() => navigate(-1)} className="text-link back-link"><ArrowLeft size={14} /> Back</button>
    <div className="dash-header">
      <div>
        <span className="section-kicker">PUBLIC DRAW AUDIT</span>
        <h1>Verify the <span className="gradient-text">draw</span>.</h1>
        <p>{audit ? audit.drop.title : "Loading drop…"} · Anyone can check this, in their own browser, without trusting our server.</p>
      </div>
      {audit?.revealed && <span className={`verdict verdict-${verdict}`}>{verdict === "pass" ? <><ShieldCheck size={16} /> Draw verified</> : verdict === "fail" ? <><CircleAlert size={16} /> Check failed</> : <><LoaderCircle size={16} className="spin" /> Verifying…</>}</span>}
    </div>
    {error && <div className="error-banner">{error}</div>}

    {audit && <div className="verify-grid">
      <div className="glass verify-card">
        <div className="panel-heading"><div className="panel-heading-icon tone-violet"><Fingerprint size={16} /></div><div><span className="section-kicker">THE COMMITMENT</span><h2>{audit.drop.allocationPolicy === "RANDOM_DRAW" ? "Sealed before entry opened" : "First come, first served"}</h2></div></div>
        {audit.drop.allocationPolicy === "RANDOM_DRAW" ? <>
          <span className="hash-label">PUBLISHED SEED HASH</span>
          <code className="hash-block">{audit.drop.drawSeedHash ?? "Not published yet: the entry window hasn’t opened."}</code>
          <span className="hash-label">REVEALED SEED</span>
          <code className="hash-block">{audit.seed ?? <span className="muted-inline"><LockKeyhole size={13} /> Stays secret until the draw is complete</span>}</code>
          <p className="verify-note">When entry opens, the server picks a secret random seed and publishes only its SHA-256 fingerprint. The draw shuffles entries with that seed. Afterwards the seed is revealed, so you can confirm it matches the fingerprint and re-run the exact shuffle.</p>
        </> : <p className="verify-note">This is a baseline drop: rank equals arrival order. It exists to compare against the protected random draw.</p>}
      </div>

      <div className="glass verify-card">
        <div className="panel-heading"><div className="panel-heading-icon tone-lime"><ShieldCheck size={16} /></div><div><span className="section-kicker">CHECKS IN YOUR BROWSER</span><h2>{audit.revealed ? "Independent re-run" : "Waiting for the draw"}</h2></div></div>
        {!audit.revealed ? <p className="verify-note">Come back after the entry window closes. The checks run automatically once the seed is revealed.</p>
          : <ol className="check-list">{steps.map((step) => <li key={step.key} className={`check-${step.state}`}>
            <span className="check-icon">{step.state === "pass" ? <Check size={14} /> : step.state === "fail" ? <X size={14} /> : step.state === "running" ? <LoaderCircle size={14} className="spin" /> : null}</span>
            <div><strong>{step.label}</strong>{step.detail && <small>{step.detail}</small>}{step.key === "shuffle" && step.state === "running" && <span className="check-progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>}</div>
          </li>)}</ol>}
      </div>
    </div>}

    {audit?.revealed && <div className="glass verify-card find-card">
      <div className="panel-heading"><div className="panel-heading-icon"><Search size={16} /></div><div><span className="section-kicker">FIND YOUR ENTRY</span><h2>Check your own rank</h2></div></div>
      <label className="field-label">Receipt code (shown on your entry card)<input className="plain-input" value={receipt} onChange={(event) => setReceipt(event.target.value)} placeholder="e.g. 7K2D9QXA" spellCheck={false} /></label>
      {found === undefined && <p className="verify-note">No entry ends with that code in this draw.</p>}
      {found && <div className={`found-entry ${found.rank <= audit.drop.capacity ? "found-won" : ""}`}>
        <span>DRAW RANK</span><strong>#{found.rank.toLocaleString()}</strong>
        <small>{found.rank <= audit.drop.capacity ? `Within the ${audit.drop.capacity.toLocaleString()} seats: a seat was reserved for this entry.` : `Waitlisted: ${(found.rank - audit.drop.capacity).toLocaleString()} places behind the last seat.`}</small>
      </div>}
    </div>}
  </section>;
}
