-- Track *who* a user is connected to instead of a bare busy flag, so
-- leave/reap/end can free the partner as well.
ALTER TABLE "Presence" DROP COLUMN "busy",
ADD COLUMN     "peerId" TEXT;
