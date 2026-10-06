import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Armchair, Clock3, X } from "lucide-react";
import { formatRemaining, holdSeat, loadSeats, type Drop, type Entry, type SeatInfo } from "../lib/api";

const STATE_LABEL: Record<SeatInfo["state"], string> = { available: "available", held: "held by another winner", booked: "booked", mine: "your seat" };

/** Seat map for a winner: pick or switch seats while the reservation is active. */
export function SeatPicker({ drop, entry, busy, onClose, onChanged, onConfirm }: {
  drop: Drop; entry: Entry; busy: boolean; onClose: () => void; onChanged: () => void; onConfirm: () => void;
}) {
  const [seats, setSeats] = useState<SeatInfo[] | null>(null);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [, tick] = useState(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const refresh = useCallback(() => loadSeats(drop.id).then((data) => setSeats(data.seats)).catch((e) => setMessage({ tone: "bad", text: (e as Error).message })), [drop.id]);
  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), 3000);
    const clock = window.setInterval(() => tick((n) => n + 1), 1000);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => { window.clearInterval(poll); window.clearInterval(clock); window.removeEventListener("keydown", onKey); };
  }, [refresh]);

  const rows = useMemo(() => {
    const map = new Map<string, SeatInfo[]>();
    for (const seat of seats ?? []) map.set(seat.row, [...(map.get(seat.row) ?? []), seat]);
    return [...map.entries()];
  }, [seats]);
  const mine = seats?.find((seat) => seat.state === "mine")?.label ?? entry.seat?.label ?? null;
  const free = seats?.filter((seat) => seat.state === "available").length ?? 0;

  const pick = async (label: string) => {
    setPending(label); setMessage(null);
    try {
      await holdSeat(drop.id, label);
      setMessage({ tone: "ok", text: `Seat ${label} is held for you. Confirm before your reservation ends.` });
      onChanged();
    } catch (e) {
      setMessage({ tone: "bad", text: `${label}: ${(e as Error).message}` });
    } finally {
      setPending(""); void refresh();
    }
  };

  return <div className="drawer-backdrop seat-backdrop" onClick={onClose}>
    <div className="seat-modal glass" role="dialog" aria-modal="true" aria-labelledby="seat-title" onClick={(event) => event.stopPropagation()}>
      <div className="panel-heading">
        <div className="panel-heading-icon tone-violet"><Armchair size={16} /></div>
        <div><span className="section-kicker">PICK YOUR SEAT</span><h2 id="seat-title">{drop.title}</h2></div>
        <button type="button" className="icon-btn drawer-close" onClick={onClose} aria-label="Close seat map"><X size={17} /></button>
      </div>
      <div className="seat-meta">
        <span><Clock3 size={13} /> Hold ends in <b>{formatRemaining(entry.reservationExpiresAt)}</b></span>
        <span>{free.toLocaleString()} {free === 1 ? "seat" : "seats"} free</span>
      </div>
      <div className="seat-legend" aria-hidden="true">
        <span><i className="seat-dot seat-available" /> Available</span><span><i className="seat-dot seat-mine" /> Your seat</span>
        <span><i className="seat-dot seat-held" /> Held by another winner</span><span><i className="seat-dot seat-booked" /> Booked</span>
      </div>
      {message && <div className={message.tone === "ok" ? "notice-banner" : "error-banner"} role="status">{message.text}</div>}
      <div className="seat-scroll">
        <div className="seat-stage">STAGE</div>
        {!seats ? <div className="seat-loading">Loading seats…</div> : <div className="seat-grid">
          {rows.map(([row, list]) => <div className="seat-row-line" key={row}>
            <span className="seat-row-label">{row}</span>
            {list.map((seat) => <button key={seat.label} type="button"
              className={`seat seat-${seat.state} ${pending === seat.label ? "seat-pending" : ""}`}
              disabled={!!pending || seat.state === "held" || seat.state === "booked" || seat.state === "mine"}
              onClick={() => void pick(seat.label)}
              aria-label={`Seat ${seat.label}, ${STATE_LABEL[seat.state]}`} title={`${seat.label} · ${STATE_LABEL[seat.state]}`}>{seat.number}</button>)}
            <span className="seat-row-label">{row}</span>
          </div>)}
        </div>}
      </div>
      <div className="seat-footer">
        <span>{mine ? <>Your seat: <b className="seat-label-big">{mine}</b></> : "Tap a free seat to hold it."}</span>
        <button className="button button-primary" disabled={!mine || busy} onClick={onConfirm}>{busy ? "Confirming…" : mine ? `Confirm ticket · ${mine}` : "Pick a seat first"}<ArrowRight size={15} /></button>
      </div>
    </div>
  </div>;
}
