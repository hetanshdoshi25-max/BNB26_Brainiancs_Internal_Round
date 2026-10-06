import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export const SEATS_PER_ROW = 20;
export const MAX_SEAT_MAP = 1000;

/** 0 → A, 25 → Z, 26 → AA, 27 → AB … */
export function rowName(index: number): string {
  let name = "";
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

export function seatLayout(capacity: number) {
  return Array.from({ length: capacity }, (_, i) => {
    const row = rowName(Math.floor(i / SEATS_PER_ROW));
    const number = (i % SEATS_PER_ROW) + 1;
    return { row, number, label: `${row}${number}` };
  });
}

export type SeatState = "available" | "held" | "booked" | "mine";

/** The seat map as one participant sees it. */
export async function seatMapFor(dropId: string, myEntryId: string | null) {
  const seats = await prisma.seat.findMany({
    where: { dropId },
    select: { label: true, row: true, number: true, entryId: true, entry: { select: { status: true } } },
    orderBy: [{ row: "asc" }, { number: "asc" }],
  });
  // Sort rows as A…Z, AA…: shorter names first, then alphabetically.
  seats.sort((a, b) => a.row.length - b.row.length || a.row.localeCompare(b.row) || a.number - b.number);
  return seats.map((seat) => {
    let state: SeatState = "available";
    if (seat.entryId && seat.entryId === myEntryId) state = "mine";
    else if (seat.entryId) state = seat.entry?.status === "CONFIRMED" ? "booked" : "held";
    return { label: seat.label, row: seat.row, number: seat.number, state };
  });
}

/**
 * Moves an entry onto `label` atomically. The take is a single conditional UPDATE
 * ("only if nobody holds it"): when two people pick the same seat at the same instant,
 * PostgreSQL's row lock makes the second wait, re-checks the condition after the first
 * commits, and updates 0 rows, so the seat can never be double-booked.
 * Throws SeatTakenError when someone else got it, so the surrounding transaction rolls
 * back and the caller keeps their previous seat.
 */
export async function moveEntryToSeat(tx: Prisma.TransactionClient, dropId: string, entryId: string, label: string) {
  const current = await tx.seat.findUnique({ where: { entryId }, select: { label: true } });
  if (current?.label === label) return true;
  // Release the old seat first (entryId is unique), then try to take the new one.
  if (current) await tx.seat.update({ where: { entryId }, data: { entryId: null } });
  const taken = await tx.seat.updateMany({ where: { dropId, label, entryId: null }, data: { entryId } });
  if (taken.count === 1) return true;
  throw new SeatTakenError();
}

export class SeatTakenError extends Error {
  constructor() { super("That seat was just taken. Please pick another one."); }
}

/** Frees seats whose entries are no longer holding a reservation (expired holds). */
export function releaseExpiredSeats(tx: Prisma.TransactionClient, dropId: string) {
  return tx.seat.updateMany({ where: { dropId, entry: { status: "EXPIRED" } }, data: { entryId: null } });
}
