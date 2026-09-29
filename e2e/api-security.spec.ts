import {
  test as base,
  expect,
  type APIRequestContext,
} from "@playwright/test";
import { randomClientIp } from "./helpers";

// Security regression tests for the coordination API. Each test plays an
// attacker who knows everything the API hands out publicly (every user's id
// and position) and checks that it can't be used to act as someone else.

type Session = { id: string; token: string };

// Each test gets its own fake client IP so per-IP rate limits don't bleed
// between tests.
const test = base.extend({
  request: async ({ playwright, baseURL }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { "x-forwarded-for": randomClientIp() },
    });
    await use(ctx);
    await ctx.dispose();
  },
});

const auth = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

async function join(request: APIRequestContext, lat = 14.6, lng = 121): Promise<Session> {
  const res = await request.post("/api/join", { data: { lat, lng } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.id).toBe("string");
  expect(typeof body.token).toBe("string");
  return body;
}

async function poll(request: APIRequestContext, s: Session) {
  const res = await request.get("/api/poll", { headers: auth(s) });
  expect(res.status()).toBe(200);
  return res.json();
}

async function signal(
  request: APIRequestContext,
  from: Session,
  toId: string,
  type: string,
  payload?: string,
) {
  return request.post("/api/signal", {
    headers: auth(from),
    data: { toId, type, payload },
  });
}

async function leave(request: APIRequestContext, s: Session) {
  await request.post("/api/leave", { data: { token: s.token } });
}

// Legitimately connect a and b (request + accept).
async function connect(request: APIRequestContext, a: Session, b: Session) {
  expect((await signal(request, a, b.id, "request")).status()).toBe(200);
  expect((await signal(request, b, a.id, "accept")).status()).toBe(200);
  await poll(request, a); // drain
  await poll(request, b);
}

test("the mailbox and peer list require a valid session token", async ({ request }) => {
  const victim = await join(request);

  expect((await request.get("/api/poll")).status()).toBe(401);
  expect((await request.get(`/api/poll?id=${victim.id}`)).status()).toBe(401);
  const forged = await request.get("/api/poll", {
    headers: { Authorization: `Bearer ${"x".repeat(43)}` },
  });
  expect(forged.status()).toBe(401);

  await leave(request, victim);
});

test("public ids are not credentials: the sender is always the token holder", async ({ request }) => {
  const alice = await join(request);
  const bob = await join(request);
  const mallory = await join(request);

  // Mallory claims to be Bob.
  const res = await request.post("/api/signal", {
    headers: auth(mallory),
    data: { fromId: bob.id, toId: alice.id, type: "request" },
  });
  expect(res.status()).toBe(200);
  const inbox = await poll(request, alice);
  expect(inbox.signals).toHaveLength(1);
  expect(inbox.signals[0].fromId).toBe(mallory.id);

  for (const s of [alice, bob, mallory]) await leave(request, s);
});

test("poll exposes only public fields of other users", async ({ request }) => {
  const alice = await join(request);
  const bob = await join(request);
  const { peers } = await poll(request, alice);
  const bobDot = peers.find((p: { id: string }) => p.id === bob.id);
  expect(Object.keys(bobDot).sort()).toEqual(["busy", "id", "lat", "lng"]);
  for (const s of [alice, bob]) await leave(request, s);
});

test("leave only ever removes the caller", async ({ request }) => {
  const alice = await join(request);
  const victim = await join(request);

  // Old API shape: an id in the body, no token.
  expect((await request.post("/api/leave", { data: { id: victim.id } })).status()).toBe(401);
  // Alice's own token plus the victim's id: only Alice leaves.
  await request.post("/api/leave", { data: { token: alice.token, id: victim.id } });

  const observer = await join(request);
  const { peers } = await poll(request, observer);
  expect(peers.some((p: { id: string }) => p.id === victim.id)).toBe(true);
  expect(peers.some((p: { id: string }) => p.id === alice.id)).toBe(false);

  for (const s of [victim, observer]) await leave(request, s);
});

test("nobody can accept or decline a request that was never made", async ({ request }) => {
  const alice = await join(request);
  const mallory = await join(request);

  expect((await signal(request, mallory, alice.id, "accept")).status()).toBe(403);
  expect((await signal(request, mallory, alice.id, "decline")).status()).toBe(403);

  const observer = await join(request);
  const { peers } = await poll(request, observer);
  expect(peers.find((p: { id: string }) => p.id === alice.id)?.busy).toBe(false);
  expect((await poll(request, alice)).signals).toHaveLength(0);

  for (const s of [alice, mallory, observer]) await leave(request, s);
});

test("WebRTC signaling only flows between connected users", async ({ request }) => {
  const alice = await join(request);
  const bob = await join(request);
  const mallory = await join(request);
  await connect(request, alice, bob);

  const offer = JSON.stringify({ type: "offer", sdp: "v=0\r\n" });
  const ice = JSON.stringify({ candidate: "candidate:1 1 udp 1 1.2.3.4 9 typ host", sdpMid: "0" });
  expect((await signal(request, mallory, alice.id, "offer", offer)).status()).toBe(403);
  expect((await signal(request, mallory, alice.id, "ice", ice)).status()).toBe(403);
  expect((await signal(request, alice, bob.id, "offer", offer)).status()).toBe(200);
  expect((await poll(request, alice)).signals).toHaveLength(0);

  for (const s of [alice, bob, mallory]) await leave(request, s);
});

test("nobody can end someone else's connection", async ({ request }) => {
  const alice = await join(request);
  const bob = await join(request);
  const mallory = await join(request);
  await connect(request, alice, bob);

  expect((await signal(request, mallory, alice.id, "end")).status()).toBe(403);
  expect((await poll(request, alice)).signals).toHaveLength(0);
  const { peers } = await poll(request, mallory);
  expect(peers.find((p: { id: string }) => p.id === alice.id)?.busy).toBe(true);

  for (const s of [alice, bob, mallory]) await leave(request, s);
});

test("input is validated", async ({ request }) => {
  expect((await request.post("/api/join", { data: { lat: 200, lng: 0 } })).status()).toBe(400);
  expect((await request.post("/api/join", { data: { lat: "1", lng: 0 } })).status()).toBe(400);

  const alice = await join(request);
  const bob = await join(request);
  await connect(request, alice, bob);

  expect((await signal(request, alice, "not-a-uuid", "request")).status()).toBe(400);
  expect((await signal(request, alice, bob.id, "teleport")).status()).toBe(400);
  expect((await signal(request, alice, bob.id, "offer", "{not json")).status()).toBe(400);
  expect((await signal(request, alice, bob.id, "offer", JSON.stringify({ type: "offer" }))).status()).toBe(400);
  const huge = JSON.stringify({ type: "offer", sdp: "a".repeat(40_000) });
  expect((await signal(request, alice, bob.id, "offer", huge)).status()).toBe(400);
  expect((await signal(request, alice, bob.id, "end", "payload-not-allowed")).status()).toBe(400);

  for (const s of [alice, bob]) await leave(request, s);
});

test("connection requests are rate limited", async ({ request }) => {
  const mallory = await join(request);
  const targets = await Promise.all([0, 1, 2].map(() => join(request)));

  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) {
    const target = targets[i % targets.length];
    statuses.push((await signal(request, mallory, target.id, "request")).status());
    await signal(request, mallory, target.id, "end"); // cancel, try again
  }
  expect(statuses).toContain(429);

  for (const s of [mallory, ...targets]) await leave(request, s);
});

test("joining is rate limited per client", async ({ request }) => {
  const statuses: number[] = [];
  const sessions: Session[] = [];
  for (let i = 0; i < 40; i++) {
    const res = await request.post("/api/join", { data: { lat: 1, lng: 1 } });
    statuses.push(res.status());
    if (res.ok()) sessions.push(await res.json());
  }
  expect(statuses).toContain(429);
  for (const s of sessions) await leave(request, s);
});

test("pages are served with security headers", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toMatch(/script-src[^;]*'nonce-/);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["permissions-policy"]).toContain("camera=(self)");
});
