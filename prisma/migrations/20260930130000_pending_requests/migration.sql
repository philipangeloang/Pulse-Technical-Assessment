-- Track outstanding connection requests so the server can enforce the
-- request -> accept/decline handshake.
-- AlterTable
ALTER TABLE "Presence" ADD COLUMN     "pendingTo" TEXT;

-- CreateIndex
CREATE INDEX "Presence_pendingTo_idx" ON "Presence"("pendingTo");

