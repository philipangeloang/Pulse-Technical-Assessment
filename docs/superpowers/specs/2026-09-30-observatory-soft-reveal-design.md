# Pulse — "Midnight Observatory" redesign, Living Globe & Soft Reveal

Date: 2026-09-30 · Covers assessment Phase 2 (make it good) and Phase 4 (make it better).

## Goal

Reviewers test Pulse by opening two windows, dropping onto the map, connecting,
chatting and starting video. Every screen on that path must feel deliberate and
beautiful (Phase 2), and two new capabilities must be visible in that same test
(Phase 4):

- **Living Globe** (alive): the real day/night terminator, each stranger's local
  time and sky, and flares when strangers connect.
- **Soft Reveal** (safe): video starts frosted *at the source*; each person reveals
  themselves when ready, and chooses when to see the other.

Constraints carried over: no accounts, nothing stored, media stays P2P, runs on
Vercel with only Postgres + Mapbox, and every Phase 3 guarantee (token auth,
server-enforced handshake, rate limits, strict CSP, hostile-peer limits) holds.

## Visual system — Midnight Observatory

- **Mood:** looking down at Earth at night — calm, intimate, a little cosmic.
- **Palette** (CSS custom properties in `globals.css`):
  space `#05070d`, deep `#0a0f1f`, glass `rgba(255,255,255,0.06)` with
  `backdrop-filter: blur(20px) saturate(140%)` and a 1px `rgba(255,255,255,0.08)`
  border, ember `#ff8a5c` (primary accent), glow `#ffd9a8`, text `#eef1f8`,
  muted `#8a93a8`, danger `#ff5d6c`.
- **Type:** Instrument Serif (display: brand, headlines, stranger's local time)
  + Geist (UI). Both via `next/font/google` (self-hosted, CSP-safe).
- **Icons:** `lucide-react`.
- **Motion:** CSS keyframes only — dot "heartbeat" breathing, flare ring, glass
  panels rising in, countdown rings. All disabled under
  `prefers-reduced-motion: reduce`.
- **Responsive:** desktop side panels; below `md` they become bottom sheets.

## Structure

The map is mounted for the whole visit: it is the entry backdrop, then the live
view. `PulseApp` stays the single state container (connection/video state
machines, polling, WebRTC). Presentation moves into focused components:

| Component | Responsibility |
|-----------|----------------|
| `WorldMap` | Globe projection, atmosphere/stars, night layers, dot + "you" markers, flares, entry spin → fly-to-user |
| `EntryOverlay` | Brand, tagline, privacy chips, "Drop in", locating/error states |
| `Hud` | Brand mark, "N strangers awake · M under the night sky", empty state hint |
| `DotCard` | Selected stranger: local time, sky, distance, "Say hi"; morphs into "Waiting…" with 30 s countdown + Cancel |
| `IncomingCall` | Glass prompt with the requester's local time/sky; Accept / Not now |
| `ChatSheet` | Messages, composer, header (their local time, Video, Skip & block, End) |
| `VideoStage` | Soft Reveal: remote + self view, frost states, controls |
| `Toasts` | Notices (glass pills, auto-dismiss) |

New pure modules (unit-testable, no DOM):

- `lib/sun.ts` — subsolar point, solar altitude, terminator/twilight polygons.
- `lib/sky.ts` — sky label + icon from solar altitude and morning/evening.
- `lib/localtime.ts` — lazy `@photostructure/tz-lookup` → IANA zone → formatted
  local time; falls back to solar time if the lookup fails.
- `lib/frost.ts` — the frost pipeline (see Soft Reveal).

Client API change: `join()` also returns the public (offset) position it
generated, so the UI can show where others see you.

Server changes: none beyond adding the `reveal` / `frost` data-channel control
messages to the client allowlist (the data channel is P2P; the server never sees
them).

## Phase 2 flow

1. **Entry.** Globe slowly spins behind the overlay: "Pulse" (serif), tagline,
   chips *No account · 1–3 km fuzz · Nothing stored*, **Drop in**. Locating shows
   a pulsing ring; denied/failed shows an inline explanation + retry.
2. **Arrive.** Overlay fades; the globe flies to the user. The "you" marker sits at
   the real location with a faint 1–3 km ring — *"others see you somewhere in
   here"* — and a small marker where others actually see you (the offset point
   returned by `join`).
3. **Browse.** Strangers are ember dots that breathe; busy ones dim and stop.
   Hover/focus shows a tooltip; click selects and opens `DotCard` (no request is
   sent until **Say hi**). Empty state: *"It's quiet right now — open Pulse in a
   second window to meet yourself."*
4. **Request.** `DotCard` becomes *Waiting for them…* with a 30 s countdown ring
   and Cancel. Declines/timeouts/refusals appear as toasts.
5. **Incoming.** `IncomingCall`: *"A stranger where it's 4:12 AM wants to talk"*.
6. **Chat.** `ChatSheet` slides in (right on desktop, bottom sheet on mobile);
   long words wrap; "Messages are peer-to-peer and never stored" empty state.
7. **Video.** `VideoStage` takes the map area; the chat sheet stays alongside on
   desktop (toggle on mobile).

## Living Globe

- **Terminator + twilight:** `lib/sun.ts` computes, for the current UTC time, the
  region where solar altitude is below 0°, −6°, −12° and −18°. Each is a GeoJSON
  polygon drawn as a low-opacity fill layer, so darkness deepens smoothly into
  full night. Recomputed every 60 s. Polygons are built by solving, per longitude
  step (2°), the latitude where altitude equals the threshold, then closing via
  the pole in darkness.
- **Local time & sky:** for each dot, `lib/localtime.ts` resolves its time zone
  (lazy-loaded lookup) and `lib/sky.ts` labels the sky — *night, before dawn,
  dawn, golden hour, daytime, dusk, late dusk*. Shown in the tooltip, `DotCard`,
  `IncomingCall` and chat header.
- **Distance:** great-circle distance from your real location to their dot,
  computed locally, rounded (*"~1,100 km away"*, *"a few km away"*).
- **Flares:** when a dot flips idle → busy between polls, it plays a flare ring.
- **HUD:** *"12 strangers awake · 5 under the night sky"* (altitude < −6°).
- **Privacy:** everything derives client-side from data already public (offset
  positions, busy flags). Nothing new is sent or stored.

## Soft Reveal

**Enforcement at the source.** When video starts, the camera stream is not sent
directly. `lib/frost.ts`:

1. Plays the camera track in a hidden `<video>`.
2. Each animation frame (`requestAnimationFrame`, which also pauses in hidden tabs)
   is drawn to an output canvas (max 640 px wide, camera aspect).
   - **Frosted:** draw to a 32 px-wide canvas, then 128 px, then upscale to the
     output with high-quality smoothing — a soft frosted-glass image that works
     in every browser (no `ctx.filter` dependency).
   - **Revealed:** draw the frame as-is. The switch cross-fades over ~600 ms.
3. `canvas.captureStream(30)` provides the outgoing video track; the original
   audio track is sent unchanged.

Revealing only changes what is drawn — no renegotiation. The stranger therefore
never receives a clear frame until you reveal. The self-view shows the canvas
output: *exactly what they see*.

**Consent in both directions.**

- *What you show:* **Reveal me** / **Frost me** toggle. Sends `reveal` / `frost`
  over the data channel so the other side's UI reflects it.
- *What you see:* the remote video is also CSS-blurred on your side until you tap
  **Show them**, which is offered only after they sent `reveal`. A modified
  client that sends clear frames without revealing stays blurred for you.
- States shown to the viewer: *They're frosted* → *They revealed · Show them* →
  clear.

**Skip & block.** In the chat header and video controls. Ends the connection and
adds the stranger's session id to an in-memory block list for this visit: their
dot is hidden and their requests are auto-declined. (Session ids are ephemeral,
so a block lasts until either side leaves — stated honestly in NOTES.)

**Other controls:** mute mic, end video (back to chat), end connection.

**Limits:** a hidden tab throttles frame callbacks, so your outgoing video pauses
while the tab is in the background (fails private, not open).

## Error handling

- Camera/mic denied → toast, video request declined cleanly (existing flow).
- `tz-lookup` fails to load → solar-time fallback, labelled "~".
- Map token missing → existing setup hint, styled.
- Poll failures → HUD shows a subtle "Reconnecting…" state after 3 consecutive
  failures; clears on success.

## Testing

- **Unit (Vitest):** `lib/sun.ts` (subsolar point at known solstice/equinox
  instants; altitude at known places/times; polygon validity), `lib/sky.ts`
  labels, `lib/localtime.ts` formatting/fallback.
- **E2E (Playwright, existing suite updated):** new flow selectors (dot → card →
  Say hi); CSP-violation check stays; plus:
  - *Frost is enforced at the source:* in the receiver, sample the remote video
    into a canvas and measure Laplacian variance — low before the sender
    reveals, high after they reveal **and** the viewer taps Show them.
  - *Viewer consent:* after the sender reveals but before Show them, the remote
    video element is still blurred.
  - *Skip & block:* after skipping, the stranger's dot is gone and their new
    request is auto-declined.
  - *Living Globe:* night layers present; DotCard shows a local time and sky.
- All tests run against `next dev` and a production build.

## Out of scope

Server-side reports/moderation, TURN relay, typing indicators, sounds,
persistent blocks.
