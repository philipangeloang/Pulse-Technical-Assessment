import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { releasePartnersOf } from "@/lib/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { id }. Removes the presence row and any pending
// signals to/from this user, and frees their partner if connected. Called via navigator.sendBeacon on tab close, so
// the body may arrive as text — parse defensively.
export async function POST(request: NextRequest) {
  let id: string | undefined;
  try {
    const text = await request.text();
    id = text ? (JSON.parse(text)?.id as string | undefined) : undefined;
  } catch {
    id = undefined;
  }

  if (typeof id !== "string" || !id) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }

  const me = await prisma.presence.findUnique({
    where: { id },
    select: { id: true, peerId: true },
  });

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });

  // After the mailbox purge, so the partner's "end" isn't deleted with it.
  if (me) await releasePartnersOf([me]);

  return Response.json({ ok: true });
}
