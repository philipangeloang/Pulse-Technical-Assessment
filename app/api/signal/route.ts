import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { pair, unpair } from "@/lib/connections";
import type { SignalType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

const MAX_PAYLOAD = 64 * 1024; // SDP/ICE are small; cap to be safe.

// POST /api/signal — body { fromId, toId, type, payload? }
// Drops one message into the recipient's mailbox. Also manages the pairing
// (Presence.peerId) so a user can only be in one connection at a time.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { fromId, toId, type, payload } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof fromId !== "string" || typeof toId !== "string") {
    return Response.json({ error: "invalid ids" }, { status: 400 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  if (
    payload !== undefined &&
    payload !== null &&
    (typeof payload !== "string" || payload.length > MAX_PAYLOAD)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const signalType = type as SignalType;
  const payloadStr = typeof payload === "string" ? payload : null;

  // Enforce "one active connection at a time": if the target is already busy,
  // auto-decline the request instead of delivering it.
  if (signalType === "request") {
    const target = await prisma.presence.findUnique({
      where: { id: toId },
      select: { peerId: true },
    });
    if (!target || target.peerId !== null) {
      // Target went offline or is busy — tell the initiator it was declined.
      await sendDecline(toId, fromId);
      return Response.json({ ok: true, autoDeclined: true });
    }
  }

  // Connection transitions:
  // - accept: pair both peers (fails if either vanished or got busy meanwhile,
  //   in which case the acceptor is told the connection ended).
  // - decline/end: release the pair.
  if (signalType === "accept") {
    if (!(await pair(fromId, toId))) {
      await prisma.signal.create({
        data: { fromId: toId, toId: fromId, type: "end", payload: null },
      });
      return Response.json({ ok: false, error: "peer unavailable" });
    }
  } else if (signalType === "decline" || signalType === "end") {
    await unpair(fromId, toId);
  }

  await prisma.signal.create({
    data: { fromId, toId, type: signalType, payload: payloadStr },
  });

  return Response.json({ ok: true });
}

// Helper: deliver an auto-decline from `target` back to `initiator`.
async function sendDecline(targetId: string, initiatorId: string) {
  await prisma.signal.create({
    data: { fromId: targetId, toId: initiatorId, type: "decline", payload: null },
  });
}
