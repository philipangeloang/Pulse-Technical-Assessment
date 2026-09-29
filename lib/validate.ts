// Request validation helpers for the API routes.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public session ids are server-assigned UUIDs.
export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
