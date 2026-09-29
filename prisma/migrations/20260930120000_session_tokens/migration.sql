-- Sessions now authenticate with a server-issued bearer token (only its hash
-- is stored). Presence/Signal rows are transient coordination state and
-- pre-token sessions can't authenticate, so clear them first.
DELETE FROM "Signal";
DELETE FROM "Presence";

-- AlterTable
ALTER TABLE "Presence" ADD COLUMN     "tokenHash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Presence_tokenHash_key" ON "Presence"("tokenHash");
