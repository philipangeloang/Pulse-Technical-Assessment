// Request validation helpers for the API routes.
import type { SignalType } from "@/lib/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public session ids are server-assigned UUIDs.
export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export const SIGNAL_TYPES: readonly SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

export function isSignalType(value: unknown): value is SignalType {
  return (
    typeof value === "string" &&
    (SIGNAL_TYPES as readonly string[]).includes(value)
  );
}

// Real SDP (audio + video + data channel) is a few KB; ICE candidates are a
// couple hundred bytes. Generous caps, but far below abuse territory.
const MAX_SDP = 16 * 1024;
const MAX_CANDIDATE = 1024;

// Returns the payload to store (null for control messages), or undefined if
// it's invalid for this signal type. Only the fields WebRTC needs are kept,
// so the mailbox can't be used to relay arbitrary data.
export function normalizePayload(
  type: SignalType,
  payload: unknown,
): string | null | undefined {
  if (type !== "offer" && type !== "answer" && type !== "ice") {
    return payload === undefined || payload === null ? null : undefined;
  }
  if (typeof payload !== "string" || payload.length > MAX_SDP + 256) {
    return undefined;
  }
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;

  if (type === "ice") {
    const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = d;
    if (typeof candidate !== "string" || candidate.length > MAX_CANDIDATE) {
      return undefined;
    }
    if (sdpMid != null && (typeof sdpMid !== "string" || sdpMid.length > 32)) {
      return undefined;
    }
    if (
      sdpMLineIndex != null &&
      (!Number.isInteger(sdpMLineIndex) || (sdpMLineIndex as number) < 0)
    ) {
      return undefined;
    }
    if (
      usernameFragment != null &&
      (typeof usernameFragment !== "string" || usernameFragment.length > 256)
    ) {
      return undefined;
    }
    return JSON.stringify({ candidate, sdpMid, sdpMLineIndex, usernameFragment });
  }

  // offer / answer: an RTCSessionDescriptionInit of the matching type.
  if (d.type !== type || typeof d.sdp !== "string") return undefined;
  if (d.sdp.length === 0 || d.sdp.length > MAX_SDP) return undefined;
  return JSON.stringify({ type: d.type, sdp: d.sdp });
}
