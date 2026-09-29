// Server-side connection bookkeeping. A connection is a pair of presence rows
// whose peerId point at each other; everything here keeps both sides in sync.
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

// Users who went away (left or went stale) while connected: free their
// partners and drop an "end" in each partner's mailbox so the survivor's UI
// tears down immediately instead of waiting for WebRTC to time out.
export async function releasePartnersOf(
  gone: { id: string; peerId: string | null }[],
): Promise<void> {
  const paired = gone.filter(
    (g): g is { id: string; peerId: string } => g.peerId !== null,
  );
  if (paired.length === 0) return;

  for (const g of paired) {
    await prisma.presence.updateMany({
      where: { id: g.peerId, peerId: g.id },
      data: { peerId: null },
    });
  }
  await prisma.signal.createMany({
    data: paired.map((g) => ({
      fromId: g.id,
      toId: g.peerId,
      type: "end",
      payload: null,
    })),
  });
}
