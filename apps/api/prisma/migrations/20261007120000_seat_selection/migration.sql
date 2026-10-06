-- AlterTable
ALTER TABLE "Drop" ADD COLUMN     "seatMap" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Seat" (
    "id" TEXT NOT NULL,
    "dropId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "row" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "entryId" TEXT,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Seat_entryId_key" ON "Seat"("entryId");

-- CreateIndex
CREATE INDEX "Seat_dropId_idx" ON "Seat"("dropId");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_dropId_label_key" ON "Seat"("dropId", "label");

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "Drop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

