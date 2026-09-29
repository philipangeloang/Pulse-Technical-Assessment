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
- Added a migration for the `busy → peerId` change so `prisma/migrations` stays in
  sync, though the README flow uses `db push`.
- `npm run test:e2e` — set `E2E_CHANNEL=chrome` to use an installed Chrome instead of
  downloading Playwright's Chromium.
