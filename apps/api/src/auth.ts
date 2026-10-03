import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db";

export const SESSION_COOKIE = "fairdrop_session";
const SESSION_DAYS = 14;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function startSession(userId: string, res: Response) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) return res.status(401).json({ error: "Sign in to continue." });
    const session = await prisma.session.findFirst({
      where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } },
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
    });
    if (!session) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    req.user = session.user;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireOrganizer(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ORGANIZER") return res.status(403).json({ error: "Organizer access is required." });
  return next();
}

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string; role: "PARTICIPANT" | "ORGANIZER" };
    }
  }
}
