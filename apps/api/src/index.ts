import "./env";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { enforceBudget, redis, redisHealth } from "./redis";
import { hashToken, requireOrganizer, requireUser, SESSION_COOKIE, startSession } from "./auth";
import { fairnessReport, newDrawSeed, recordJoinAttempt, seededShuffle, trafficSeries } from "./fairness";
import { currentDifficulty, issueChallenge, powEnabled, verifyProof, type PowAction } from "./pow";
import { humanScore } from "./signals";
import { MAX_SEAT_MAP, moveEntryToSeat, releaseExpiredSeats, SEATS_PER_ROW, SeatTakenError, seatLayout, seatMapFor } from "./seats";

const app = express();
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const appEnv = process.env.NODE_ENV ?? "development";

app.disable("x-powered-by");
app.set("trust proxy", appEnv === "production" ? 1 : false);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);
}

function clientIp(req: Request) { return req.ip || req.socket.remoteAddress || "unknown"; }

// Per-account token buckets: [capacity, refill one token every N ms]. Seat picking is
// generous because a winner may try several seats that others grab first.
const ACCOUNT_BUDGETS: Record<string, [number, number]> = { join: [3, 60_000], seat: [30, 2_000] };

async function budgetOr429(req: Request, res: Response, action: string, accountId?: string) {
  const [accountCapacity, accountRefillMs] = ACCOUNT_BUDGETS[action] ?? [12, 10_000];
  const accountBudget = accountId
    ? await enforceBudget([`${action}:user:${accountId}`], accountCapacity, accountRefillMs)
    : { allowed: true, retryAfterMs: 0 };
  const ipCapacity = action === "join"
    ? Number(process.env.JOIN_IP_CAPACITY ?? 5000)
    : action === "auth" ? Number(process.env.AUTH_IP_CAPACITY ?? 120) : Number(process.env.CONFIRM_IP_CAPACITY ?? 500);
  const ipBudget = accountBudget.allowed
    ? await enforceBudget([`${action}:ip:${clientIp(req)}`], ipCapacity, action === "join" ? 60_000 : 10_000)
    : accountBudget;
  const budget = ipBudget;
  if (!budget.allowed) {
    res.setHeader("Retry-After", String(Math.ceil(budget.retryAfterMs / 1000)));
    res.status(429).json({ error: "Too many requests. Please wait before trying again.", retryAfterMs: budget.retryAfterMs });
    return false;
  }
  return true;
}

const publicUser = (user: { id: string; email: string; name: string; role: string }) => ({
  id: user.id, email: user.email, name: user.name, role: user.role,
});
const passwordDigest = (password: string) => createHash("sha256").update(password, "utf8").digest("hex");

app.get("/api/health", asyncRoute(async (_req, res) => {
  const [database, redis] = await Promise.all([
    prisma.$queryRaw`SELECT 1`,
    redisHealth(),
  ]);
  res.json({ status: "ok", services: { database: database ? "ok" : "down", redis } });
}));

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
});
app.post("/api/auth/register", asyncRoute(async (req, res) => {
  if (!(await budgetOr429(req, res, "auth"))) return;
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check your details." });
  if (powEnabled) {
    const powError = await verifyProof("register", req.body?.pow);
    if (powError) return res.status(428).json({ error: powError });
  }
  const email = parsed.data.email.toLowerCase();
  const passwordHash = await bcrypt.hash(passwordDigest(parsed.data.password), 12);
  const organizerEmails = (process.env.ORGANIZER_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  try {
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email,
        passwordHash,
        role: organizerEmails.includes(email) ? "ORGANIZER" : "PARTICIPANT",
        signupHumanScore: humanScore(req.body?.signals),
      },
      select: { id: true, email: true, name: true, role: true },
    });
    await startSession(user.id, res);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    throw error;
  }
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  if (!(await budgetOr429(req, res, "auth"))) return;
  const parsed = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(passwordDigest(parsed.data.password), user.passwordHash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  await startSession(user.id, res);
  return res.json({ user: publicUser(user) });
}));

app.post("/api/auth/logout", requireUser, asyncRoute(async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: appEnv === "production", sameSite: "lax", path: "/" });
  res.status(204).end();
}));

app.get("/api/auth/me", requireUser, (req, res) => res.json({ user: req.user }));

const dropSummary = {
  id: true, title: true, description: true, venue: true, eventDate: true,
  capacity: true, allocationPolicy: true, limitsEnabled: true, status: true, opensAt: true, closesAt: true,
  reservationMinutes: true, drawCompletedAt: true, createdAt: true, drawSeedHash: true, drawCommittedAt: true, seatMap: true,
} as const;

app.get("/api/drops", asyncRoute(async (_req, res) => {
  const drops = await prisma.drop.findMany({ orderBy: [{ status: "asc" }, { eventDate: "asc" }], select: dropSummary });
  res.json({ drops });
}));

app.get("/api/drops/:dropId", asyncRoute(async (req, res) => {
  const drop = await prisma.drop.findUnique({ where: { id: req.params.dropId }, select: dropSummary });
  if (!drop) return res.status(404).json({ error: "Drop not found." });
  const [entries, confirmed] = await Promise.all([
    prisma.entry.count({ where: { dropId: drop.id } }),
    prisma.entry.count({ where: { dropId: drop.id, status: "CONFIRMED" } }),
  ]);
  res.json({ drop, counts: { entries, confirmed } });
}));

app.get("/api/drops/:dropId/my-entry", requireUser, asyncRoute(async (req, res) => {
  const entry = await prisma.entry.findUnique({
    where: { dropId_userId: { dropId: req.params.dropId, userId: req.user!.id } },
    select: { id: true, status: true, rank: true, enteredAt: true, reservationExpiresAt: true, confirmedAt: true, ticketCode: true, seat: { select: { label: true } } },
  });
  res.json({ entry });
}));

app.post("/api/drops/:dropId/entries", requireUser, asyncRoute(async (req, res) => {
  const currentDrop = await prisma.drop.findUnique({ where: { id: req.params.dropId }, select: { id: true, limitsEnabled: true } });
  if (!currentDrop) return res.status(404).json({ error: "Drop not found." });
  const userId = req.user!.id;
  if (currentDrop.limitsEnabled && !(await budgetOr429(req, res, "join", userId))) {
    recordJoinAttempt(currentDrop.id, userId, "throttled");
    return;
  }
  // Protected drops also require a solved proof-of-work puzzle on every entry request.
  if (currentDrop.limitsEnabled && powEnabled) {
    const powError = await verifyProof("join", req.body?.pow);
    if (powError) {
      recordJoinAttempt(currentDrop.id, userId, "rejected");
      return res.status(428).json({ error: powError });
    }
  }
  const score = humanScore(req.body?.signals);
  try {
    const result = await prisma.$transaction(async (tx) => {
      // A shared lock lets joins for the same drop run concurrently, while the draw's
      // exclusive lock still waits for in-flight joins before freezing the eligible list.
      // Duplicate joins are prevented by the (dropId, userId) unique index (P2002 below).
      // Read committed is enough: the share lock pins the drop's status, and serializable
      // isolation would abort concurrent inserts into the same index range under load.
      await shareDrop(tx, req.params.dropId);
      const drop = await tx.drop.findUnique({ where: { id: req.params.dropId } });
      if (!drop) return { kind: "missing" as const };
      const now = new Date();
      if (drop.status !== "OPEN" || !drop.opensAt || !drop.closesAt || now < drop.opensAt || now >= drop.closesAt) return { kind: "closed" as const };
      const prior = await tx.entry.findUnique({ where: { dropId_userId: { dropId: drop.id, userId } } });
      if (prior) return { kind: "existing" as const, entry: prior };
      return { kind: "created" as const, entry: await tx.entry.create({ data: { dropId: drop.id, userId, humanScore: score } }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    recordJoinAttempt(currentDrop.id, userId, result.kind === "created" || result.kind === "existing" ? "accepted" : "rejected");
    if (result.kind === "missing") return res.status(404).json({ error: "Drop not found." });
    if (result.kind === "closed") return res.status(409).json({ error: "The entry window is closed." });
    return res.status(result.kind === "created" ? 201 : 200).json({ entry: result.entry, existing: result.kind === "existing" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      recordJoinAttempt(currentDrop.id, userId, "accepted");
      const entry = await prisma.entry.findUnique({ where: { dropId_userId: { dropId: req.params.dropId, userId } } });
      return res.json({ entry, existing: true });
    }
    recordJoinAttempt(currentDrop.id, userId, "rejected");
    throw error;
  }
}));

async function lockDrop(tx: Prisma.TransactionClient, dropId: string) {
  await tx.$queryRaw`SELECT id FROM "Drop" WHERE id = ${dropId} FOR UPDATE`;
}

async function shareDrop(tx: Prisma.TransactionClient, dropId: string) {
  await tx.$queryRaw`SELECT id FROM "Drop" WHERE id = ${dropId} FOR SHARE`;
}

async function closeDrop(dropId: string) {
  return prisma.$transaction(async (tx) => {
    // Read committed (set below) matters here: under serializable the snapshot is taken at this
    // first statement, before the lock wait, so joins that commit while we wait would be missed.
    await lockDrop(tx, dropId);
    const drop = await tx.drop.findUnique({ where: { id: dropId } });
    if (!drop) return null;
    if (drop.status === "CLOSED") return drop;
    const entries = await tx.entry.findMany({
      where: { dropId, status: "ENTERED" }, select: { id: true },
      orderBy: drop.allocationPolicy === "FIRST_COME" ? { arrivalSequence: "asc" } : undefined,
    });
    // Random draws shuffle with the seed committed when entry opened, so anyone can
    // re-run the draw from the revealed seed. Drops opened before commitments existed get
    // a fresh seed now (reported as uncommitted by the audit endpoint).
    const fallback = drop.allocationPolicy === "RANDOM_DRAW" && !drop.drawSeed ? newDrawSeed() : null;
    const seed = drop.drawSeed ?? fallback?.seed ?? "";
    const ordered = drop.allocationPolicy === "FIRST_COME" ? entries : seededShuffle(entries.map((entry) => entry.id), seed).map((id) => ({ id }));
    const completedAt = new Date();
    const expiry = new Date(completedAt.getTime() + drop.reservationMinutes * 60_000);
    // Null ranks first, then assign in bounded statements. The unique index makes
    // persisted draw positions durable and safe to inspect after a restart.
    for (let start = 0; start < ordered.length; start += 350) {
      const batch = ordered.slice(start, start + 350);
      const values = batch.map((entry, offset) => Prisma.sql`(${entry.id}::text, ${start + offset + 1}::int)`);
      if (values.length) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "Entry" AS e SET "rank" = v.rank
          FROM (VALUES ${Prisma.join(values)}) AS v(id, rank)
          WHERE e.id = v.id
        `);
      }
    }
    await tx.entry.updateMany({ where: { dropId, rank: { lte: drop.capacity } }, data: { status: "RESERVED", reservationExpiresAt: expiry } });
    await tx.entry.updateMany({ where: { dropId, rank: { gt: drop.capacity } }, data: { status: "WAITLISTED" } });
    return tx.drop.update({
      where: { id: dropId },
      data: { status: "CLOSED", closesAt: completedAt, drawCompletedAt: completedAt, ...(fallback ? { drawSeed: fallback.seed, drawSeedHash: fallback.seedHash } : {}) },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 120_000 });
}

async function promoteWaitlist(dropId: string) {
  return prisma.$transaction(async (tx) => {
    await lockDrop(tx, dropId);
    const drop = await tx.drop.findUnique({ where: { id: dropId } });
    if (!drop || !drop.drawCompletedAt) return;
    const now = new Date();
    await tx.entry.updateMany({
      where: { dropId, status: "RESERVED", reservationExpiresAt: { lte: now } },
      data: { status: "EXPIRED", reservationExpiresAt: null },
    });
    // Seats picked by expired holds go back on the seat map.
    if (drop.seatMap) await releaseExpiredSeats(tx, dropId);
    // Refill every free seat, not just one: several holds can expire in the same tick.
    const held = await tx.entry.count({ where: { dropId, status: { in: ["RESERVED", "CONFIRMED"] } } });
    const freeSeats = drop.capacity - held;
    if (freeSeats > 0) {
      const next = await tx.entry.findMany({ where: { dropId, status: "WAITLISTED" }, orderBy: { rank: "asc" }, take: freeSeats, select: { id: true } });
      if (next.length) {
        await tx.entry.updateMany({
          where: { id: { in: next.map((entry) => entry.id) }, status: "WAITLISTED" },
          data: { status: "RESERVED", reservationExpiresAt: new Date(now.getTime() + drop.reservationMinutes * 60_000) },
        });
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

const createDropSchema = z.object({
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().max(1000).default(""),
  venue: z.string().trim().min(2).max(100).default("Online"),
  eventDate: z.string().datetime(),
  capacity: z.number().int().min(1).max(50_000),
  reservationMinutes: z.number().int().min(1).max(120).default(10),
  allocationPolicy: z.enum(["FIRST_COME", "RANDOM_DRAW"]).default("RANDOM_DRAW"),
  limitsEnabled: z.boolean().default(true),
  seatMap: z.boolean().default(false),
}).refine((drop) => !drop.seatMap || drop.capacity <= MAX_SEAT_MAP, { message: `Seat selection supports up to ${MAX_SEAT_MAP.toLocaleString()} seats.` });

app.post("/api/organizer/drops", requireUser, requireOrganizer, asyncRoute(async (req, res) => {
  const parsed = createDropSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the drop details." });
  const drop = await prisma.$transaction(async (tx) => {
    const created = await tx.drop.create({ data: parsed.data });
    if (created.seatMap) await tx.seat.createMany({ data: seatLayout(created.capacity).map((seat) => ({ ...seat, dropId: created.id })) });
    return created;
  });
  res.status(201).json({ drop });
}));

app.post("/api/organizer/drops/:dropId/open", requireUser, requireOrganizer, asyncRoute(async (req, res) => {
  const parsed = z.object({ durationMinutes: z.number().int().min(1).max(1440) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Entry window duration must be between 1 minute and 24 hours." });
  const drop = await prisma.drop.findUnique({ where: { id: req.params.dropId } });
  if (!drop) return res.status(404).json({ error: "Drop not found." });
  if (drop.status !== "DRAFT") return res.status(409).json({ error: "Only a draft drop can be opened." });
  const now = new Date();
  const opened = await prisma.drop.updateMany({
    where: { id: drop.id, status: "DRAFT" },
    data: {
      status: "OPEN", opensAt: now, closesAt: new Date(now.getTime() + parsed.data.durationMinutes * 60_000),
      // Commit to the draw seed before anyone enters: only its hash is public until the draw.
      ...(drop.allocationPolicy === "RANDOM_DRAW" ? (({ seed, seedHash }) => ({ drawSeed: seed, drawSeedHash: seedHash, drawCommittedAt: now }))(newDrawSeed()) : {}),
    },
  });
  if (!opened.count) return res.status(409).json({ error: "This drop was already opened." });
  return res.json({ drop: await prisma.drop.findUnique({ where: { id: drop.id }, select: dropSummary }) });
}));

app.post("/api/organizer/drops/:dropId/close", requireUser, requireOrganizer, asyncRoute(async (req, res) => {
  const drop = await prisma.drop.findUnique({ where: { id: req.params.dropId } });
  if (!drop) return res.status(404).json({ error: "Drop not found." });
  if (drop.status !== "OPEN") return res.status(409).json({ error: "Only an open drop can be closed." });
  const closed = await closeDrop(drop.id);
  res.json({ drop: closed });
}));

app.get("/api/organizer/drops/:dropId/metrics", requireUser, requireOrganizer, asyncRoute(async (req, res) => {
  const drop = await prisma.drop.findUnique({ where: { id: req.params.dropId }, select: dropSummary });
  if (!drop) return res.status(404).json({ error: "Drop not found." });
  const groups = await prisma.entry.groupBy({ by: ["status"], where: { dropId: drop.id }, _count: { _all: true } });
  const metrics: Record<string, number> = { entered: 0, reserved: 0, waitlisted: 0, confirmed: 0, expired: 0 };
  for (const group of groups) metrics[group.status.toLowerCase()] = group._count._all;
  res.json({ drop, metrics, totalEntries: Object.values(metrics).reduce((sum, value) => sum + value, 0) });
}));

app.get("/api/organizer/drops/:dropId/entries", requireUser, requireOrganizer, asyncRoute(async (req, res) => {
  const requestedPage = Number(req.query.page ?? 1);
  const page = Number.isInteger(requestedPage) ? Math.max(1, Math.min(1000, requestedPage)) : 1;
  const take = 100;
  const entries = await prisma.entry.findMany({
    where: { dropId: req.params.dropId }, orderBy: [{ rank: "asc" }, { enteredAt: "asc" }],
    skip: (page - 1) * take, take,
    select: { id: true, status: true, rank: true, enteredAt: true, reservationExpiresAt: true, confirmedAt: true, user: { select: { email: true, name: true } }, seat: { select: { label: true } } },
  });
  const total = await prisma.entry.count({ where: { dropId: req.params.dropId } });
  res.json({ entries, page, pages: Math.ceil(total / take), total });
}));

app.post("/api/drops/:dropId/confirm", requireUser, asyncRoute(async (req, res) => {
  if (!(await budgetOr429(req, res, "confirm", req.user!.id))) return;
  const result = await prisma.$transaction(async (tx) => {
      // Shared locks allow crowd joins to run concurrently. The draw's exclusive
      // lock waits until in-flight joins finish before it freezes the eligible list.
      await shareDrop(tx, req.params.dropId);
    const entry = await tx.entry.findUnique({ where: { dropId_userId: { dropId: req.params.dropId, userId: req.user!.id } } });
    if (!entry) return { code: 404 as const, error: "Join the entry window before checking for a ticket." };
    if (entry.status === "CONFIRMED") return { entry };
    if (entry.status !== "RESERVED") return { code: 409 as const, error: entry.status === "WAITLISTED" ? "You are on the waitlist. Check back for a reservation." : "There is no active reservation to confirm." };
    if (!entry.reservationExpiresAt || entry.reservationExpiresAt <= new Date()) {
      await tx.entry.update({ where: { id: entry.id }, data: { status: "EXPIRED", reservationExpiresAt: null } });
      await tx.seat.updateMany({ where: { entryId: entry.id }, data: { entryId: null } });
      return { code: 409 as const, error: "This reservation expired. The next eligible waitlisted entry will be promoted." };
    }
    const drop = await tx.drop.findUnique({ where: { id: entry.dropId }, select: { seatMap: true } });
    if (drop?.seatMap && !(await tx.seat.findUnique({ where: { entryId: entry.id }, select: { id: true } }))) {
      return { code: 409 as const, error: "Pick your seat before confirming." };
    }
    const confirmed = await tx.entry.update({ where: { id: entry.id }, data: { status: "CONFIRMED", confirmedAt: new Date(), ticketCode: `FD-${randomUUID().toUpperCase()}` } });
    return { entry: confirmed };
    });
  if ("error" in result) {
    if (result.code === 409) void promoteWaitlist(req.params.dropId).catch((error) => console.error("Waitlist promotion failed", error));
    return res.status(result.code ?? 409).json({ error: result.error });
  }
  return res.json({ entry: result.entry });
}));

app.get("/api/organizer/overview", requireUser, requireOrganizer, asyncRoute(async (_req, res) => {
  const [drops, accounts, entries, confirmed, throttled] = await Promise.all([
    prisma.drop.count(), prisma.user.count(), prisma.entry.count(),
    prisma.entry.count({ where: { status: "CONFIRMED" } }),
    redis.get("metrics:throttled"),
  ]);
  res.json({ drops, accounts, entries, confirmed, throttled: Number(throttled ?? 0) });
}));

// Seat selection: the seat map as the signed-in participant sees it.
app.get("/api/drops/:dropId/seats", requireUser, asyncRoute(async (req, res) => {
  const drop = await prisma.drop.findUnique({ where: { id: req.params.dropId }, select: { seatMap: true } });
  if (!drop) return res.status(404).json({ error: "Drop not found." });
  if (!drop.seatMap) return res.status(409).json({ error: "This drop doesn’t use seat selection." });
  const mine = await prisma.entry.findUnique({ where: { dropId_userId: { dropId: req.params.dropId, userId: req.user!.id } }, select: { id: true } });
  res.setHeader("Cache-Control", "no-store");
  res.json({ seatsPerRow: SEATS_PER_ROW, seats: await seatMapFor(req.params.dropId, mine?.id ?? null) });
}));

// Pick (or switch to) a seat. Only winners with an active reservation can hold a seat;
// the hold lasts as long as their reservation and becomes a booking when they confirm.
app.post("/api/drops/:dropId/seats/:label", requireUser, asyncRoute(async (req, res) => {
  if (!(await budgetOr429(req, res, "seat", req.user!.id))) return;
  const label = String(req.params.label).toUpperCase();
  if (!/^[A-Z]{1,3}\d{1,3}$/.test(label)) return res.status(400).json({ error: "Unknown seat." });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const drop = await tx.drop.findUnique({ where: { id: req.params.dropId }, select: { seatMap: true } });
      if (!drop?.seatMap) return { code: 409 as const, error: "This drop doesn’t use seat selection." };
      const entry = await tx.entry.findUnique({ where: { dropId_userId: { dropId: req.params.dropId, userId: req.user!.id } } });
      if (!entry || entry.status !== "RESERVED" || !entry.reservationExpiresAt || entry.reservationExpiresAt <= new Date()) {
        return { code: 409 as const, error: entry?.status === "CONFIRMED" ? "Your ticket is already confirmed." : "Only entries with an active seat reservation can pick a seat." };
      }
      const seat = await tx.seat.findUnique({ where: { dropId_label: { dropId: req.params.dropId, label } }, select: { id: true } });
      if (!seat) return { code: 404 as const, error: "Unknown seat." };
      await moveEntryToSeat(tx, req.params.dropId, entry.id, label);
      return { seat: label, holdUntil: entry.reservationExpiresAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if ("error" in result) return res.status(result.code ?? 409).json({ error: result.error });
    return res.json(result);
  } catch (error) {
    if (error instanceof SeatTakenError) return res.status(409).json({ error: error.message, taken: true });
    throw error;
  }
}));

// Proof-of-work challenge. Entry to a drop without abuse limits (the baseline policy) needs none.
app.get("/api/pow/challenge", asyncRoute(async (req, res) => {
  const action = req.query.action === "join" ? "join" : req.query.action === "register" ? "register" : null;
  if (!action) return res.status(400).json({ error: "Unknown action." });
  if (!powEnabled) return res.json({ required: false });
  if (action === "join") {
    const dropId = typeof req.query.dropId === "string" ? req.query.dropId : "";
    const drop = await prisma.drop.findUnique({ where: { id: dropId }, select: { limitsEnabled: true } });
    if (!drop) return res.status(404).json({ error: "Drop not found." });
    if (!drop.limitsEnabled) return res.json({ required: false });
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(await issueChallenge(action as PowAction));
}));

// Public draw audit: the committed hash always, the seed and full rank list once drawn,
// so anyone can recompute the shuffle independently.
app.get("/api/drops/:dropId/audit", asyncRoute(async (req, res) => {
  const drop = await prisma.drop.findUnique({
    where: { id: req.params.dropId },
    select: { id: true, title: true, capacity: true, status: true, allocationPolicy: true, opensAt: true, drawCompletedAt: true, drawSeedHash: true, drawSeed: true, drawCommittedAt: true },
  });
  if (!drop) return res.status(404).json({ error: "Drop not found." });
  const { drawSeed, ...publicDrop } = drop;
  const revealed = !!drop.drawCompletedAt;
  const entries = revealed
    ? await prisma.entry.findMany({ where: { dropId: drop.id, rank: { not: null } }, select: { id: true, rank: true, arrivalSequence: true }, orderBy: { rank: "asc" } })
    : [];
  res.json({
    drop: publicDrop,
    revealed,
    seed: revealed && drop.allocationPolicy === "RANDOM_DRAW" ? drawSeed : null,
    committedBeforeEntry: !!drop.drawCommittedAt && !!drop.opensAt && drop.drawCommittedAt.getTime() <= drop.opensAt.getTime(),
    entries: entries.map((entry) => ({ id: entry.id, rank: entry.rank, arrival: entry.arrivalSequence })),
  });
}));

app.get("/api/organizer/drops/:dropId/fairness", requireUser, requireOrganizer, asyncRoute(async (req, res) => {
  const [report, join, register] = await Promise.all([fairnessReport(req.params.dropId), currentDifficulty("join"), currentDifficulty("register")]);
  if (!report) return res.status(404).json({ error: "Drop not found." });
  res.json({ ...report, pow: { enabled: powEnabled, join, register } });
}));

app.get("/api/organizer/drops/:dropId/traffic", requireUser, requireOrganizer, asyncRoute(async (req, res) => {
  res.json({ series: await trafficSeries(req.params.dropId, 120) });
}));

// In a deployment the API also serves the built web app, so the site and API share one
// origin and the session cookie works without cross-site settings. Skipped in dev (Vite serves it).
const webDist = process.env.WEB_DIST ?? path.resolve(__dirname, "../../../web/dist");
if (existsSync(path.join(webDist, "index.html"))) {
  app.use(express.static(webDist, { index: false, maxAge: "1h" }));
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

app.use((_req, res) => res.status(404).json({ error: "Endpoint not found." }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return res.status(409).json({ error: "Another booking update happened at the same time. Please retry." });
  }
  return res.status(500).json({ error: "Something went wrong. Please try again." });
});

let runningWorker = false;
async function maintainReservations() {
  if (runningWorker) return;
  runningWorker = true;
  try {
    const dueDrops = await prisma.drop.findMany({ where: { status: "OPEN", closesAt: { lte: new Date() } }, select: { id: true }, take: 100 });
    for (const drop of dueDrops) await closeDrop(drop.id);
    const expiredDropIds = await prisma.entry.findMany({
      where: { status: "RESERVED", reservationExpiresAt: { lte: new Date() }, drop: { drawCompletedAt: { not: null } } },
      distinct: ["dropId"], select: { dropId: true }, take: 100,
    });
    for (const item of expiredDropIds) await promoteWaitlist(item.dropId);
    if (Math.random() < 0.005) await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  } catch (error) {
    console.error("Reservation maintenance failed", error);
  } finally {
    runningWorker = false;
  }
}

const server = app.listen(port, () => {
  console.log(`Fair Drop API listening on http://localhost:${port}`);
  void maintainReservations();
  setInterval(() => void maintainReservations(), 2000).unref();
});

async function shutdown() {
  server.close();
  await Promise.all([prisma.$disconnect(), (await import("./redis")).redis.quit()]);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
