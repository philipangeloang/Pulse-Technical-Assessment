// Client-side helpers for talking to the coordination API.
import type { PollResponse, SignalType } from "@/lib/types";
import { applyPrivacyOffset } from "@/lib/geo";

// A live session: `id` is public (others see it on your dot), `token` is the
// secret credential for every other call. `lat`/`lng` is the public, offset
// position this session was placed at. Kept in memory only.
export interface Session {
  id: string;
  token: string;
  lat: number;
  lng: number;
}

// The server no longer knows this session (reaped or left) — re-join.
export class SessionExpiredError extends Error {}

const authHeaders = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

// Starts a new session at the user's real location. The 1–3 km privacy
// offset is applied here, in the browser, so the raw location never leaves
// the device. Every join (including re-joins) draws a fresh offset for a
// fresh, unlinkable session id.
export async function join(rawLat: number, rawLng: number): Promise<Session> {
  const { lat, lng } = applyPrivacyOffset(rawLat, rawLng);
  const res = await fetch("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng }),
  });
  if (!res.ok) throw new Error(`join failed: ${res.status}`);
  const { id, token } = (await res.json()) as { id: string; token: string };
  return { id, token, lat, lng };
}

export async function poll(session: Session): Promise<PollResponse> {
  const res = await fetch("/api/poll", {
    cache: "no-store",
    headers: authHeaders(session),
  });
  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

// Resolves false if the server refused the signal (e.g. accepting a request
// that was cancelled a moment ago) or it couldn't be sent.
export async function sendSignal(
  session: Session,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<boolean> {
  try {
    const res = await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(session) },
      body: JSON.stringify({ toId, type, payload }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body.ok !== false;
  } catch {
    return false;
  }
}

// Fire-and-forget leave that survives the tab closing. sendBeacon can't set
// headers, so the token travels in the body.
export function leave(session: Session): void {
  const body = JSON.stringify({ token: session.token });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", body);
  } else {
    void fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  }
}
