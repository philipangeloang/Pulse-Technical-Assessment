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

Tests: `npm run test:e2e` runs the security suite and the two-browser flows; all 16 pass
against both `next dev` and a production build.
