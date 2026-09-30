# NOTES

## Phase 1 — Make it run

**Approach.** Reproduce first, then fix one root cause per commit. Server bugs were
reproduced with a script hitting the API directly; client/WebRTC bugs with a
Playwright test that drives **two real browsers** (fake geolocation + Chromium's fake
camera) through the whole flow. That test is committed (`npm run test:e2e`) and was
written to fail before each fix.

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | Following the README setup, every API route 500s | Prisma 7 no longer generates the client on `npm install` / `db push`; only `build` ran `prisma generate` | `postinstall: prisma generate` (also covers Vercel's cached installs) |
| 2 | Dots stay on the map long after people leave *(the README example)* | Poll heartbeat was `updateMany({ where: {} })` — every poll refreshed **everyone's** `lastSeen`, so nobody could ever go stale | Heartbeat only the caller |
| 3 | After the first chat, both users stay dimmed as "busy" and every new request is auto-declined | `end` never cleared `busy`; and on leave/reap the server couldn't free the partner because it stored a boolean, not *who* | Replaced `busy` with `peerId`. Pairing uses conditional updates (no double-pairing, no stranding when accepting someone who just left). end/leave/reap free the partner **and** drop an `end` in their mailbox so their UI closes immediately |
| 4 | Stuck on "Connecting…" forever (intermittent) | ICE candidates arriving in the same poll batch as the offer/answer were queued while `setRemoteDescription` was in flight — and the queue was flushed *before* it, so they were never added. Confirmed by instrumenting `RTCPeerConnection` in both browsers | Flush after `setRemoteDescription` |
| 5 | Chat messages never arrive | Sender tagged `{ t: "msg" }`, receiver only accepts `{ t: "chat" }` | Use `"chat"` on both ends |
| 6 | If WebRTC fails (strict NAT — STUN only) users are stranded as busy; if it never comes up, "Connecting…" spins forever | Failure tore down locally without telling the peer/server; no connect timeout | Send `end` on failure; give up after 25 s |
| 7 | A tab left in the background (or a phone that locked) vanishes from the map for good | Throttled/frozen timers → reaped; on waking it kept heartbeating a row that no longer existed | Poll reports `present`; client re-joins **with a new session id** — a fresh random offset that can't be linked to (and averaged with) the old one |
| 8 | Missing Mapbox token → blank map, no explanation | Hardcoded fake fallback token (Mapbox returns 401) made the "set your token" hint unreachable | Removed the fallback |

**Assumptions / notes**
- Kept HTTP polling + Postgres as designed (no WebSockets on Vercel serverless).
- Phase 3 later replaced the client-generated session id with a server-issued
  token, so some Phase 1 code (e.g. the `present` flag) evolved into its final form there.
- Added a migration for the `busy → peerId` change so `prisma/migrations` stays in
  sync, though the README flow uses `db push`.
- `npm run test:e2e` — set `E2E_CHANNEL=chrome` to use an installed Chrome instead of
  downloading Playwright's Chromium.

## Phase 2 — Make it good

**Direction: "Midnight Observatory."** Looking down at Earth at night — calm and
intimate rather than a busy social app. One surface material (frosted glass), one warm
accent (ember orange), a serif for the human moments (Instrument Serif) and Geist for
the interface. Design spec: `docs/superpowers/specs/`.

- **A globe, not a flat map.** 3D globe in space with atmosphere and stars, tinted to
  the palette (navy seas, quiet labels). It spins slowly behind the entry card and
  flies down to you when you drop in.
- **Strangers are embers with a heartbeat;** busy ones dim and stop beating. Hover
  shows one line about them (their local time and sky).
- **Tap → card → Say hi.** The original sent a request the instant you touched a dot —
  easy to do by accident, especially on a phone. Now a card shows their local time,
  sky and distance, and you choose to say hi; waiting shows a 30 s countdown ring.
- **Honest privacy UI.** Your marker sits at your real location (only on your screen)
  inside the faint 1–3 km ring your public dot is placed in, with a hollow marker where
  others actually see you.
- **Chat as a glass sheet** — side sheet on desktop, bottom sheet on phones (safe-area
  aware), timestamps, long words wrap, and video no longer covers the conversation.
- **States and copy for everything:** empty globe ("open a second window to meet
  yourself"), a Reconnecting pill, toasts for every outcome.
- **Restraint:** CSS-only motion, `prefers-reduced-motion` stops the spin and
  animations, and it all runs under the strict CSP with zero violations.

Verified by looking, not just by tests: I screenshot every screen while building. That
caught two real bugs the tests couldn't — the dev server serving stale CSS, and
Lightning CSS emitting only `-webkit-backdrop-filter` (so the glass never frosted in
Chrome).

## Phase 4 — Make it better

Two features: one that makes Pulse **safe**, one that makes it feel **alive**.

**Soft Reveal (safety).** The worst thing about video with strangers is unwanted
exposure. So video starts **frosted at the source**: the camera is drawn to a canvas,
shrunk to 32 px and scaled back up, and the *canvas* stream is what's sent. The other
person never receives a clear frame until you tap **Reveal me** — even a modified client
can't un-frost what never left your device. Consent runs both ways: when they reveal,
you're told, but they stay blurred on your side until you tap **Show them**. Every call
starts frosted again. Plus **Skip & block**: ends the chat, hides them and silently
declines their requests for the rest of the visit.

The e2e test proves the enforcement rather than the UI: it measures edge detail
(variance of the Laplacian) in the frames the **receiver decodes** — ~2–5 while frosted,
~16–26 once revealed, back to frosted after a restart.

**Living Globe (alive).** The globe shows the real **day/night terminator** with
civil, nautical and astronomical twilight bands (solar geometry computed every minute,
unit-tested against solstice/equinox cases), each stranger's **local time and sky**
("4:12 AM · before dawn"), how many strangers are **under the night sky**, and a
**flare** whenever a dot starts a conversation. It's computed in the browser from data
that was already public — nothing new is sent or stored.

**Why these two:** they show up in exactly the test reviewers run (two windows →
connect → video), and they answer the product's two real questions — *why would I open
this?* (it feels like a living planet: someone is awake somewhere) and *why would I
trust it?* (you control what you show and what you see).

**Next, with more time:** a TURN relay (plus relay-only mode to hide IPs from peers),
server-side reports with rate-limited consequences, "golden hour" matching (meet someone
where the sun is rising), and a lighter globe mode for low-end phones.

## Phase 3 — Make it secure

**Threat model.** Anonymous users, no accounts. The attacker knows everything the API
hands out publicly (every dot's id + position) and can script requests. Before
fixing anything I confirmed each issue with a working exploit against the original
API, then wrote `e2e/api-security.spec.ts` (red first) as the regression suite.

| Rank | Finding | Impact | Status |
|------|---------|--------|--------|
| 1 — Critical | **Session id was both public and the only credential.** Every poll returned every user's id; `fromId` was client-supplied | Read anyone's mailbox (steal their requests/SDP), send signals *as* anyone, `/api/leave` anyone off the map | **Fixed** — `/api/join` issues a random 256-bit bearer token (only its SHA-256 stored); the public id is server-assigned; the sender is always the token holder |
| 2 — Critical | **No server-side connection state machine** | A forged `accept` paired any two strangers (one script can lock the whole map as busy); `end` kicked anyone out of a chat; `offer`/`ice` could be pushed into anyone's session | **Fixed** — server tracks pending requests: accept/decline only by the user asked, SDP/ICE only between paired users, end only your own connection/request (403 otherwise) |
| 3 — High | **No rate limiting** | Flood the globe with fake dots, spam requests at a person (harassment), hammer the DB-backed poll (DoS / cost) | **Fixed** — Postgres fixed-window for join (30/5 min/IP) and requests (6/min/session, 30/min/IP); in-memory per instance for poll/ICE. Keys are HMACs — raw IPs never stored |
| 4 — High | **Anyone could scrape all positions** without joining (`/api/poll?id=<random>`) | Anonymous mass surveillance of the map | **Fixed** by #1 — poll requires a valid session |
| 5 — High | `next@16.2.7` critical advisory (Proxy bypass, Server Actions DoS) + 16 other audit findings | Known CVEs | **Fixed** — Next 16.3.7 + `npm audit fix` (17 → 4; remaining 4 are in the Prisma CLI's dev-only tooling, fix would be a major downgrade) |
| 6 — Medium | **Weak input validation** (ids of any length, 64 KB free-form payloads) | Mailbox used as a generic relay; DB bloat | **Fixed** — UUID ids; per-type payload schemas (SDP ≤ 16 KB, ICE ≤ 1 KB), re-serialized with only WebRTC's fields; control messages carry none |
| 7 — Medium | **Raw GPS sent to the server** (offset applied server-side) | Exact location transits network/logs/memory | **Fixed** — offset applied in the browser; raw location never leaves the device |
| 8 — Medium | **No security headers** | Clickjacking around camera/location prompts, Referer leaks, no script restrictions | **Fixed** — nonce-based strict CSP via `proxy.ts` (`frame-ancestors 'none'`, `strict-dynamic`), `Referrer-Policy: no-referrer`, Permissions-Policy, nosniff, HSTS. Verified 0 CSP violations on a production build |
| 9 — Medium | **Peer input trusted** (data channel is P2P, not covered by the server) | A hostile stranger could flood/freeze your tab | **Fixed** — size/type/rate limits on inbound messages (e2e: 500 spam → ≤ 20 shown) |
| 10 — Low | Stale ngrok host in `allowedDevOrigins` | Third-party host allowed to reach dev server | **Fixed** — removed |

**Known / accepted (not fixed)**
- **WebRTC reveals your public IP to the peer** — inherent to peer-to-peer (city-level
  geolocation). The fix is relay-only ICE through TURN, which needs a TURN service
  (the brief says STUN-only by design). I'd add this for production.
- **In-memory limits are per instance.** Good first line on Fluid compute; the backstop
  at scale is a Vercel WAF rate-limit rule (or Redis).
- **A client can place its dot anywhere** (spoofed geolocation) — can't be verified
  without device attestation.
- **Mapbox token is public by design** — restrict it to the production URL in the
  Mapbox dashboard.
- **No report / block mechanism yet** for abusive strangers.

Tests: `npm test` (35 unit tests) and `npm run test:e2e` (the API security suite plus
two-browser flows — 23 tests) all pass against both `next dev` and a production build.
