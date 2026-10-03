CREATE TYPE "Role" AS ENUM ('PARTICIPANT', 'ORGANIZER');
CREATE TYPE "DropStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');
CREATE TYPE "AllocationPolicy" AS ENUM ('FIRST_COME', 'RANDOM_DRAW');
CREATE TYPE "EntryStatus" AS ENUM ('ENTERED', 'RESERVED', 'WAITLISTED', 'CONFIRMED', 'EXPIRED');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PARTICIPANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Drop" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "venue" TEXT NOT NULL DEFAULT 'Online',
    "eventDate" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "allocationPolicy" "AllocationPolicy" NOT NULL DEFAULT 'RANDOM_DRAW',
    "limitsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "DropStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "reservationMinutes" INTEGER NOT NULL DEFAULT 10,
    "drawCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Drop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "dropId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "arrivalSequence" SERIAL NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'ENTERED',
    "rank" INTEGER,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservationExpiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "ticketCode" TEXT,
    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");
CREATE INDEX "Drop_status_closesAt_idx" ON "Drop"("status", "closesAt");
CREATE UNIQUE INDEX "Entry_ticketCode_key" ON "Entry"("ticketCode");
CREATE UNIQUE INDEX "Entry_arrivalSequence_key" ON "Entry"("arrivalSequence");
CREATE UNIQUE INDEX "Entry_dropId_userId_key" ON "Entry"("dropId", "userId");
CREATE UNIQUE INDEX "Entry_dropId_rank_key" ON "Entry"("dropId", "rank");
CREATE INDEX "Entry_dropId_status_rank_idx" ON "Entry"("dropId", "status", "rank");
CREATE INDEX "Entry_dropId_status_arrivalSequence_idx" ON "Entry"("dropId", "status", "arrivalSequence");
CREATE INDEX "Entry_status_reservationExpiresAt_idx" ON "Entry"("status", "reservationExpiresAt");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_dropId_fkey"
    FOREIGN KEY ("dropId") REFERENCES "Drop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
