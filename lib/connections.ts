// Server-side connection bookkeeping. A connection is a pair of presence rows
// whose peerId point at each other; an outstanding request is a row whose
// pendingTo points at the target. Everything here keeps both sides in sync.
import { prisma } from "@/lib/prisma";

// Pair two available users. Each side is claimed with a conditional update
// (only if still free), so a user can never end up in two connections and a
// vanished user can't leave the other side stuck as busy. Returns false (and
// releases any half-claimed side) if either user is gone or already paired.
export async function pair(a: string, b: string): Promise<boolean> {
  const first = await prisma.presence.updateMany({
    where: { id: a, peerId: null },
    data: { peerId: b },
  });
  if (first.count === 0) return false;

  const second = await prisma.presence.updateMany({
    where: { id: b, peerId: null },
    data: { peerId: a },
  });
  if (second.count === 0) {
    await prisma.presence.updateMany({
      where: { id: a, peerId: b },
      data: { peerId: null },
    });
    return false;
  }
  return true;
}

// Release a pair, but only if a and b are actually paired with each other —
// a stray decline/end must never free someone from a different connection.
export async function unpair(a: string, b: string): Promise<void> {
  await prisma.presence.updateMany({
    where: {
      OR: [
        { id: a, peerId: b },
        { id: b, peerId: a },
      ],
    },
    data: { peerId: null },
  });
}

type Departed = { id: string; peerId: string | null; pendingTo: string | null };

// Users who went away (left or went stale): unwind every relationship they
// had, and tell the other side right away instead of letting them wait on a
// WebRTC or request timeout.
// - their partner is freed and gets an "end";
// - whoever they had requested gets an "end" (dismisses the prompt);
// - whoever had requested *them* gets a "decline".
export async function releasePartnersOf(gone: Departed[]): Promise<void> {
  if (gone.length === 0) return;
  const notices: { fromId: string; toId: string; type: string }[] = [];

  for (const g of gone) {
    if (g.peerId) {
      await prisma.presence.updateMany({
        where: { id: g.peerId, peerId: g.id },
        data: { peerId: null },
      });
      notices.push({ fromId: g.id, toId: g.peerId, type: "end" });
    }
    if (g.pendingTo) {
      notices.push({ fromId: g.id, toId: g.pendingTo, type: "end" });
    }
  }

  const goneIds = gone.map((g) => g.id);
  const requesters = await prisma.presence.findMany({
    where: { pendingTo: { in: goneIds } },
    select: { id: true, pendingTo: true },
  });
  if (requesters.length > 0) {
    await prisma.presence.updateMany({
      where: { pendingTo: { in: goneIds } },
      data: { pendingTo: null },
    });
    for (const r of requesters) {
      notices.push({ fromId: r.pendingTo!, toId: r.id, type: "decline" });
    }
  }

  if (notices.length > 0) {
    await prisma.signal.createMany({
      data: notices.map((n) => ({ ...n, payload: null })),
    });
  }
}
