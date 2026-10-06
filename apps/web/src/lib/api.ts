export type User = { id: string; email: string; name: string; role: "PARTICIPANT" | "ORGANIZER" };
export type Drop = {
  id: string; title: string; description: string; venue: string; eventDate: string;
  capacity: number; allocationPolicy: "FIRST_COME" | "RANDOM_DRAW"; limitsEnabled: boolean;
  status: "DRAFT" | "OPEN" | "CLOSED"; opensAt: string | null;
  closesAt: string | null; reservationMinutes: number; drawCompletedAt: string | null;
  drawSeedHash?: string | null; drawCommittedAt?: string | null; seatMap?: boolean;
};
export type Entry = {
  id: string; status: "ENTERED" | "RESERVED" | "WAITLISTED" | "CONFIRMED" | "EXPIRED";
  rank: number | null; enteredAt: string; reservationExpiresAt: string | null;
  confirmedAt: string | null; ticketCode: string | null; seat?: { label: string } | null;
};
export type Metrics = { entered: number; reserved: number; waitlisted: number; confirmed: number; expired: number };
export type Overview = { drops: number; accounts: number; entries: number; confirmed: number; throttled: number };
export type OrganizerEntry = { id: string; status: Entry["status"]; rank: number | null; enteredAt: string; user: { email: string; name: string }; seat?: { label: string } | null };
export type SeatInfo = { label: string; row: string; number: number; state: "available" | "held" | "booked" | "mine" };
export type FairnessBucket = { label: string; detail: string; entrants: number; winners: number; winRate: number | null };
export type Difficulty = { bits: number; requestsPerSecond: number };
export type FairnessReport = {
  dropId: string; policy: Drop["allocationPolicy"]; status: Drop["status"]; capacity: number; entrants: number; drawn: boolean;
  correlation: number | null; overallRate: number | null; earlyBirdAdvantage: number | null;
  lowSignal: { entrants: number; entrantShare: number; seatShare: number | null };
  buckets: { arrival: FairnessBucket[]; volume: FairnessBucket[]; human: FairnessBucket[] };
  pow: { enabled: boolean; join: Difficulty; register: Difficulty };
};
export type TrafficPoint = { t: number; accepted: number; throttled: number; rejected: number };
type ApiError = Error & { status?: number };

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init, credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? "Something went wrong.") as ApiError;
    error.status = response.status;
    throw error;
  }
  return body as T;
}

/** Loads every drop plus the signed-in user's entry for each one. */
export async function loadDropsWithEntries(withEntries: boolean) {
  const { drops } = await api<{ drops: Drop[] }>("/api/drops");
  if (!withEntries) return { drops, entries: {} as Record<string, Entry | null> };
  const mine = await Promise.all(drops.map(async (drop) => {
    try { return [drop.id, (await api<{ entry: Entry | null }>(`/api/drops/${drop.id}/my-entry`)).entry] as const; }
    catch { return [drop.id, null] as const; }
  }));
  return { drops, entries: Object.fromEntries(mine) as Record<string, Entry | null> };
}

export function homeFor(user: User | null) {
  if (!user) return "/";
  return user.role === "ORGANIZER" ? "/organizer" : "/dashboard";
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
export function formatRemaining(value: string | null) {
  if (!value) return "—";
  const seconds = Math.max(0, Math.floor((new Date(value).getTime() - Date.now()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function localDateTimeValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
export function statusLabel(status: Drop["status"] | Entry["status"]) {
  return ({ DRAFT: "Draft", OPEN: "Entry open", CLOSED: "Draw complete", ENTERED: "Entry received", RESERVED: "Seat reserved", WAITLISTED: "Waitlisted", CONFIRMED: "Ticket confirmed", EXPIRED: "Reservation expired" } as Record<string, string>)[status];
}
export function totalOf(metrics: Metrics | null) {
  return metrics ? metrics.entered + metrics.reserved + metrics.waitlisted + metrics.confirmed + metrics.expired : 0;
}

/** Enters a drop: solves the proof-of-work puzzle when the drop requires one and attaches
 *  aggregate interaction signals. Retries once if the puzzle expired or was reused. */
export async function joinDrop(dropId: string, onStage?: (stage: "verifying" | "saving") => void) {
  const [{ solvePow }, { getSignals }] = await Promise.all([import("./pow"), import("./humanSignals")]);
  for (let attempt = 0; ; attempt++) {
    onStage?.("verifying");
    const pow = await solvePow("join", dropId);
    onStage?.("saving");
    try {
      return await api<{ entry: Entry; existing: boolean }>(`/api/drops/${dropId}/entries`, { method: "POST", body: JSON.stringify({ pow: pow?.proof, signals: getSignals() }) });
    } catch (error) {
      if ((error as ApiError).status === 428 && attempt === 0) continue;
      throw error;
    }
  }
}

export const loadSeats = (dropId: string) => api<{ seatsPerRow: number; seats: SeatInfo[] }>(`/api/drops/${dropId}/seats`);
export const holdSeat = (dropId: string, label: string) => api<{ seat: string; holdUntil: string }>(`/api/drops/${dropId}/seats/${encodeURIComponent(label)}`, { method: "POST", body: "{}" });
