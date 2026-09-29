import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { releasePartnersOf } from "@/lib/connections";
import { authenticate, readToken, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { token } (or Authorization: Bearer). Removes the
// caller's presence row and any pending signals to/from them, and frees
// their partner if connected. Called via navigator.sendBeacon on tab close
// (which can't set headers, hence the token in the body), so the body may
// arrive as text — parse defensively.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  const me = await authenticate(readToken(request, body));
  if (!me) return unauthorized();
  const { id } = me;

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });

  // After the mailbox purge, so the partner's "end" isn't deleted with it.
  await releasePartnersOf([me]);

  return Response.json({ ok: true });
}
