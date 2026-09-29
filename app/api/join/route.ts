import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyPrivacyOffset, isValidLatLng } from "@/lib/geo";
import { newSessionToken } from "@/lib/auth";
import {
  clientIp,
  limitShared,
  sweepRateLimits,
  tooManyRequests,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — body { lat, lng } (raw coords) → { id, token }.
// Starts a new session: applies a 1–3 km privacy offset, creates the
// presence row under a server-assigned public id, and returns the secret
// token the client must present on every other call. Raw coordinates are
// never stored.
export async function POST(request: NextRequest) {
  // Room for a household/office sharing an IP (plus rejoins), but stops
  // scripts from flooding the globe with fake dots.
  if (!(await limitShared("join", clientIp(request), 30, 5 * 60_000))) {
    return tooManyRequests(60);
  }
  await sweepRateLimits();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { lat, lng } = (body ?? {}) as Record<string, unknown>;

  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }

  const offset = applyPrivacyOffset(lat as number, lng as number);
  const { token, tokenHash } = newSessionToken();

  const { id } = await prisma.presence.create({
    data: {
      tokenHash,
      lat: offset.lat,
      lng: offset.lng,
      lastSeen: new Date(),
    },
    select: { id: true },
  });

  return Response.json({ id, token });
}
