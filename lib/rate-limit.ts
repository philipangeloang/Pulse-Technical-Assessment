// Abuse limits. Two tiers:
// - limitShared: Postgres-backed fixed window, consistent across every
//   serverless instance. For the low-volume, abuse-critical actions: joining
//   (fake-dot floods) and connection requests (harassment).
// - limitLocal: in-memory, per instance. For the high-volume paths (poll,
//   ICE/SDP) where a DB round trip per call would cost more than it saves.
//   Fluid compute reuses instances, so this is a meaningful first line; a
//   platform rule (Vercel WAF rate limiting) is the real backstop at scale.
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Keys are HMACed so raw IPs (personal data) never reach the database. The
// secret only needs to be server-side and stable across instances.
const KEY_SECRET =
  process.env.RATE_LIMIT_SECRET ?? process.env.DATABASE_URL ?? "pulse";

function hashKey(value: string): string {
  return createHmac("sha256", KEY_SECRET)
    .update(value)
    .digest("base64url")
    .slice(0, 24);
}

// The client's IP. On Vercel, x-forwarded-for is set by the platform and
// client-supplied values are overwritten, so the first entry is trustworthy.
// (Behind another proxy, make sure it does the same.)
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function limitShared(
  scope: string,
  subject: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const key = `${scope}:${hashKey(subject)}`;
  const now = new Date();
  const windowOpen = new Date(now.getTime() - windowMs);
  // Atomic increment-or-reset. In ON CONFLICT ... SET every expression sees
  // the pre-update row, so both CASEs agree on whether the window expired.
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, ${now}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" <= ${windowOpen}
                     THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" <= ${windowOpen}
                           THEN ${now} ELSE "RateLimit"."windowStart" END
    RETURNING "count"`;
  return (rows[0]?.count ?? 0) <= max;
}

// Drop counters whose window closed long ago (called from join, which is
// low-traffic, rather than on every poll).
export async function sweepRateLimits(): Promise<void> {
  await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: new Date(Date.now() - 60 * 60_000) } },
  });
}

const buckets = new Map<string, { start: number; count: number }>();

export function limitLocal(
  scope: string,
  subject: string,
  max: number,
  windowMs: number,
): boolean {
  const key = `${scope}:${subject}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count++;
  if (buckets.size > 20_000) {
    for (const [k, b] of buckets) {
      if (now - b.start >= windowMs) buckets.delete(k);
    }
  }
  return bucket.count <= max;
}

export function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "too many requests" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
