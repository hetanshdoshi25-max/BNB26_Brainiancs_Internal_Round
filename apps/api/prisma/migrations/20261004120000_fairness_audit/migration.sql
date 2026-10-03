-- Behavioral signal scores (soft, never used to block).
ALTER TABLE "User" ADD COLUMN "signupHumanScore" INTEGER;
ALTER TABLE "Entry" ADD COLUMN "humanScore" INTEGER;

-- Commit-reveal verifiable draw: the seed hash is published when entry opens,
-- the seed itself is revealed once the draw is complete.
ALTER TABLE "Drop" ADD COLUMN "drawSeedHash" TEXT;
ALTER TABLE "Drop" ADD COLUMN "drawSeed" TEXT;
ALTER TABLE "Drop" ADD COLUMN "drawCommittedAt" TIMESTAMP(3);
