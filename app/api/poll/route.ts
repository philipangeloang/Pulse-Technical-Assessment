import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { releasePartnersOf } from "@/lib/connections";
import { authenticateAndTouch, readToken, unauthorized } from "@/lib/auth";
import { clientIp, limitLocal, tooManyRequests } from "@/lib/rate-limit";
import { STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence";
import type { PollResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/poll (Authorization: Bearer <token>) — the single endpoint that
// drives the live map. It (1) authenticates + heartbeats the caller,
// (2) reaps stale presence + orphan signals, (3) returns the filtered online
// peers, and (4) drains this user's mailbox.
export async function GET(request: NextRequest) {
  // Checked before touching the DB. A tab polls ~40×/min; this leaves room
  // for several tabs behind one IP while capping floods.
  if (!limitLocal("poll-ip", clientIp(request), 600, 60_000)) {
    return tooManyRequests(10);
  }

  // 1) Authenticate + heartbeat. 401 = unknown token or already reaped; the
  // client re-joins as a new session when it sees that.
  const me = await authenticateAndTouch(readToken(request));
  if (!me) return unauthorized();
  const id = me.id;

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);

  // 2) Reap stale presence rows and orphaned signals (independent deletes —
  // no atomicity needed, and avoids transactions over a PgBouncer pooler).
  // Anyone reaped mid-connection frees (and notifies) their partner.
  const stale = await prisma.presence.findMany({
    where: { lastSeen: { lt: staleCutoff } },
    select: { id: true, peerId: true, pendingTo: true },
  });
  if (stale.length > 0) {
    await prisma.presence.deleteMany({
      where: { id: { in: stale.map((s) => s.id) }, lastSeen: { lt: staleCutoff } },
    });
    await releasePartnersOf(stale);
  }
  await prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } });

  // 3) Online peers, excluding self.
  const peers = await prisma.presence.findMany({
    where: {
      id: { not: id },
      lastSeen: { gte: staleCutoff },
    },
    select: { id: true, lat: true, lng: true, peerId: true },
  });

  // 4) Drain this user's mailbox: read, then delete exactly what we read so a
  // concurrently-inserted signal is never lost.
  const inbox = await prisma.signal.findMany({
    where: { toId: id },
    orderBy: { createdAt: "asc" },
  });
  if (inbox.length > 0) {
    await prisma.signal.deleteMany({
      where: { id: { in: inbox.map((s) => s.id) } },
    });
  }

  const response: PollResponse = {
    peers: peers.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      busy: p.peerId !== null,
    })),
    signals: inbox.map((s) => ({
      id: s.id,
      fromId: s.fromId,
      toId: s.toId,
      type: s.type as PollResponse["signals"][number]["type"],
      payload: s.payload,
      createdAt: s.createdAt.toISOString(),
    })),
  };

  return Response.json(response);
}
