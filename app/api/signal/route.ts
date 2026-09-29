import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { pair, unpair } from "@/lib/connections";
import { authenticate, readToken, unauthorized } from "@/lib/auth";
import { isSessionId, isSignalType, normalizePayload } from "@/lib/validate";
import type { SignalType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/signal (Authorization: Bearer <token>) — body { toId, type,
// payload? }. Drops one message from the caller into the recipient's
// mailbox. The sender is always the token holder; there is no fromId to
// spoof.
//
// The server enforces the connection handshake, so a signal is only
// delivered if the relationship it implies actually exists:
//   request              caller is free; records caller.pendingTo = target
//   accept / decline     target has an outstanding request to the caller
//   offer / answer / ice caller and target are paired
//   end                  hangs up the caller's own connection, or cancels
//                        the caller's own outstanding request
export async function POST(request: NextRequest) {
  const me = await authenticate(readToken(request));
  if (!me) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid body");
  }

  const { toId, type, payload } = (body ?? {}) as Record<string, unknown>;

  if (!isSessionId(toId) || toId === me.id) return badRequest("invalid toId");
  if (!isSignalType(type)) return badRequest("invalid type");
  const payloadStr = normalizePayload(type, payload);
  if (payloadStr === undefined) return badRequest("invalid payload");

  switch (type) {
    case "request": {
      if (me.peerId) return conflict("already in a connection");
      const target = await prisma.presence.findUnique({
        where: { id: toId },
        select: { peerId: true },
      });
      if (!target || target.peerId !== null) {
        // Target went offline or is busy — tell the initiator it was declined.
        await deliver(toId, me.id, "decline");
        return Response.json({ ok: true, autoDeclined: true });
      }
      await prisma.presence.update({
        where: { id: me.id },
        data: { pendingTo: toId },
      });
      break;
    }

    case "accept": {
      // Consume the requester's pending request (only if it's really to us).
      const claimed = await prisma.presence.updateMany({
        where: { id: toId, pendingTo: me.id },
        data: { pendingTo: null },
      });
      if (claimed.count === 0) return forbidden();
      if (!(await pair(me.id, toId))) {
        // One side got busy/vanished meanwhile — the acceptor's UI resets.
        await deliver(toId, me.id, "end");
        return Response.json({ ok: false, error: "peer unavailable" });
      }
      break;
    }

    case "decline": {
      const claimed = await prisma.presence.updateMany({
        where: { id: toId, pendingTo: me.id },
        data: { pendingTo: null },
      });
      if (claimed.count === 0) return forbidden();
      break;
    }

    case "offer":
    case "answer":
    case "ice": {
      if (me.peerId !== toId) return forbidden();
      break;
    }

    case "end": {
      if (me.peerId === toId) {
        await unpair(me.id, toId);
      } else if (me.pendingTo === toId) {
        await prisma.presence.updateMany({
          where: { id: me.id, pendingTo: toId },
          data: { pendingTo: null },
        });
      } else {
        return forbidden();
      }
      break;
    }
  }

  await deliver(me.id, toId, type, payloadStr);
  return Response.json({ ok: true });
}

async function deliver(
  fromId: string,
  toId: string,
  type: SignalType,
  payload: string | null = null,
) {
  await prisma.signal.create({ data: { fromId, toId, type, payload } });
}

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

function forbidden() {
  return Response.json(
    { error: "no such request or connection" },
    { status: 403 },
  );
}

function conflict(error: string) {
  return Response.json({ error }, { status: 409 });
}
