// Client-side helpers for talking to the coordination API.
import type { PollResponse, SignalType } from "@/lib/types";

// A live session: `id` is public (others see it on your dot), `token` is the
// secret credential for every other call. Kept in memory only.
export interface Session {
  id: string;
  token: string;
}

// The server no longer knows this session (reaped or left) — re-join.
export class SessionExpiredError extends Error {}

const authHeaders = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

export async function join(lat: number, lng: number): Promise<Session> {
  const res = await fetch("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng }),
  });
  if (!res.ok) throw new Error(`join failed: ${res.status}`);
  return res.json();
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

export async function sendSignal(
  session: Session,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<void> {
  await fetch("/api/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(session) },
    body: JSON.stringify({ toId, type, payload }),
  });
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
