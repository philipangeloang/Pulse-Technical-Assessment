// Session authentication. A session has two identifiers:
// - id:    public, handed to every other user (it's how they tap your dot).
// - token: secret bearer credential, known only to your tab.
// The server stores only a SHA-256 hash of the token, so a leaked database
// doesn't leak live sessions. Tokens live in the tab's memory only — closing
// the tab ends the session.
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Reads "Authorization: Bearer <token>", or a token from a JSON body (for
// navigator.sendBeacon, which can't set headers).
export function readToken(request: Request, body?: unknown): string | null {
  const header = request.headers.get("authorization");
  const fromHeader = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const fromBody =
    body && typeof body === "object" && "token" in body
      ? (body as { token: unknown }).token
      : null;
  const token = fromHeader ?? fromBody;
  return typeof token === "string" && TOKEN_RE.test(token) ? token : null;
}

// The caller's presence row, or null if the token is missing/unknown/reaped.
export async function authenticate(token: string | null) {
  if (!token) return null;
  return prisma.presence.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, peerId: true },
  });
}

// Authenticate and heartbeat in one round trip (the poll hot path).
export async function authenticateAndTouch(token: string | null) {
  if (!token) return null;
  const rows = await prisma.presence.updateManyAndReturn({
    where: { tokenHash: hashToken(token) },
    data: { lastSeen: new Date() },
    select: { id: true, peerId: true },
  });
  return rows[0] ?? null;
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
