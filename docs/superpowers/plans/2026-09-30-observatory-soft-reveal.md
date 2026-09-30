# Observatory Redesign, Living Globe & Soft Reveal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Pulse in the "Midnight Observatory" style (Phase 2) and add Living Globe + Soft Reveal (Phase 4), keeping every Phase 1/3 guarantee and test green.

**Architecture:** `PulseApp` stays the single state container (connection/video state machines, polling, WebRTC). Presentation moves into focused components; new pure modules (`lib/sun.ts`, `lib/sky.ts`, `lib/localtime.ts`, `lib/geo.ts` additions, `lib/frost.ts`) hold the maths and the frost pipeline and are unit-tested with Vitest. Soft Reveal sends a canvas stream (frosted until reveal) instead of the camera, so enforcement happens before frames leave the device.

**Tech Stack:** Next.js 16.3.7 (App Router, `proxy.ts` nonce CSP), React 19.2, Tailwind v4, Mapbox GL 3.24 (globe projection), WebRTC, Prisma/Postgres (unchanged), Vitest 5 (new, unit), Playwright (e2e), `lucide-react` (new), `@photostructure/tz-lookup` (new).

**Spec:** `docs/superpowers/specs/2026-09-30-observatory-soft-reveal-design.md`

## Global Constraints

- Commit messages: plain conventional messages, **no** `Co-Authored-By` / "Generated with" attribution lines.
- Strict production CSP (`proxy.ts`): no inline `<script>`/`<style>` tags and no third-party script/style hosts. Style via Tailwind classes, `app/globals.css`, or React `style` props / `element.style` (CSSOM is allowed). Fonts only via `next/font`.
- Nothing new is sent to or stored by the server. Living Globe data derives client-side from the public dot positions and busy flags.
- The data channel is P2P and untrusted: any new control message must be added to the `CONTROLS` allowlist in `lib/webrtc.ts`.
- Palette: space `#05070d`, deep `#0a0f1f`, ember `#ff8a5c`, glow `#ffd9a8`, ink `#eef1f8`, muted `#8a93a8`, danger `#ff5d6c`. Display font Instrument Serif; UI font Geist.
- `prefers-reduced-motion: reduce` disables CSS animation and the entry globe spin.
- Accessible names the e2e suite relies on (keep exact): buttons **Drop in**, **Say hi**, **Cancel**, **Close**, **Accept**, **Not now**, **Send**, **Start video**, **End video**, **End chat**, **Skip and block**, **Reveal me**, **Frost me**, **Show them**, **Mute**/**Unmute**; status texts **Connected** / **Connecting…**; composer placeholder **Type a message…**; incoming title contains **wants to talk**; video prompt title **Start a video call?**; DotCard region name **Selected stranger**; dot class `.pulse-dot`.
- Local dev: the dev server runs on port **3001** (3000 is another project). Run e2e with `E2E_PORT=3001 E2E_CHANNEL=chrome npm run test:e2e`. Final verification also runs against a production build: `npm run build && npx next start -p 3002`, then `E2E_BASE_URL=http://localhost:3002 E2E_CHANNEL=chrome npm run test:e2e`.
- Between e2e runs, wait ~16 s or close pages with `page.close({ runBeforeUnload: true })` so stale dots from a previous run don't linger (they're reaped after 15 s).
- Lint (`eslint-config-next` 16.3.7) enforces the React Compiler rules as **errors**: `react-hooks/purity` (no `new Date()`/`Date.now()`/`Math.random()` during render — use `useNow()` from `lib/use-now.ts`), `react-hooks/set-state-in-effect` (no synchronous `setState` in an effect body — derive values or set state from callbacks), `react-hooks/refs`, `react-hooks/immutability`.

## Review Focus

1. **Camera/mic denied when starting or accepting video** → a toast says "Camera unavailable.", both sides return to chat, nothing hangs. Pinned in Task 7.
2. **Restarting video after revealing** → the new call must start frosted again (reveal state resets on end/restart), for both the sender's canvas and the viewer's UI. Pinned in Task 7.
3. **The stranger leaves while their DotCard is open** → the card closes (no stale time/distance, no crash). Pinned in Task 5.
4. **Phone-sized viewport and long unbroken messages** → no horizontal scrolling; chat bubbles wrap inside the sheet. Pinned in Task 6.
5. **Reduced-motion users** → the entry globe does not spin (`data-spinning="false"`). Pinned in Task 5.

---

### Task 1: Vitest + solar geometry (`lib/sun.ts`)

**Files:**
- Create: `vitest.config.ts`, `lib/sun.ts`, `lib/sun.test.ts`
- Modify: `package.json` (devDependency `vitest`, script `test`)

**Interfaces:**
- Produces: `interface LatLng { lat: number; lng: number }`; `subsolarPoint(date: Date): LatLng`; `solarAltitude(lat: number, lng: number, date: Date): number` (degrees); `isMorning(lng: number, date: Date): boolean`; `type Ring = [number, number][]`; `interface MultiPolygon { type: "MultiPolygon"; coordinates: Ring[][] }`; `darkness(date: Date, altitudeDeg: number, stepDeg?: number): MultiPolygon`.

- [ ] **Step 1: Install Vitest and add config + script**

Run: `npx -y npm@latest install -D vitest@^5`

Add to `package.json` `scripts`: `"test": "vitest run"`.

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the pure lib/ modules (the e2e suite lives in e2e/).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["lib/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 2: Write the failing tests** — `lib/sun.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { darkness, isMorning, solarAltitude, subsolarPoint, type MultiPolygon } from "@/lib/sun";

function pointInRing(ring: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const isDarkIn = (g: MultiPolygon, lng: number, lat: number) =>
  g.coordinates.some((poly) => pointInRing(poly[0], lng, lat));

const JUNE_SOLSTICE = new Date("2024-06-20T20:51:00Z");
const MARCH_EQUINOX = new Date("2024-03-20T03:06:00Z");
const APRIL_NOON = new Date("2024-04-15T12:00:00Z"); // equation of time ≈ 0

describe("subsolarPoint", () => {
  it("sits on the Tropic of Cancer at the June solstice", () => {
    expect(subsolarPoint(JUNE_SOLSTICE).lat).toBeCloseTo(23.44, 0);
  });
  it("sits on the equator at the March equinox", () => {
    expect(Math.abs(subsolarPoint(MARCH_EQUINOX).lat)).toBeLessThan(0.5);
  });
  it("is over Greenwich at 12:00 UTC when the equation of time is ~0", () => {
    expect(Math.abs(subsolarPoint(APRIL_NOON).lng)).toBeLessThan(0.6);
  });
});

describe("solarAltitude", () => {
  it("is 90° under the sun and -90° opposite it", () => {
    const s = subsolarPoint(APRIL_NOON);
    expect(solarAltitude(s.lat, s.lng, APRIL_NOON)).toBeCloseTo(90, 1);
    expect(solarAltitude(-s.lat, s.lng + 180, APRIL_NOON)).toBeCloseTo(-90, 1);
  });
  it("matches the noon altitude at Greenwich in June", () => {
    // 90 − 51.48 + 23.44 ≈ 61.96
    const alt = solarAltitude(51.48, 0, new Date("2024-06-20T12:00:00Z"));
    expect(alt).toBeGreaterThan(61);
    expect(alt).toBeLessThan(63);
  });
});

describe("isMorning", () => {
  it("is morning west of the sun and afternoon east of it", () => {
    expect(isMorning(-45, APRIL_NOON)).toBe(true);
    expect(isMorning(45, APRIL_NOON)).toBe(false);
  });
});

describe("darkness", () => {
  const dates = [new Date("2024-06-20T12:00:00Z"), new Date("2024-03-20T12:00:00Z"), new Date("2026-09-30T08:00:00Z")];
  const thresholds = [0, -6, -12, -18];

  it("covers midnight and not noon", () => {
    const night = darkness(new Date("2024-06-20T12:00:00Z"), 0);
    expect(isDarkIn(night, 180, 0)).toBe(true);
    expect(isDarkIn(night, 0, 0)).toBe(false);
  });

  it("has polar day in the Arctic and polar night in the Antarctic in June", () => {
    const night = darkness(new Date("2024-06-20T12:00:00Z"), 0);
    expect(isDarkIn(night, 0, 85)).toBe(false);
    expect(isDarkIn(night, 0, -85)).toBe(true);
  });

  it("splits a twilight cap that crosses the antimeridian", () => {
    const astro = darkness(new Date("2024-03-20T12:00:00Z"), -18);
    expect(astro.coordinates.length).toBe(2);
    expect(isDarkIn(astro, 180, 0)).toBe(true);
    expect(isDarkIn(astro, 90, 0)).toBe(false);
    expect(isDarkIn(astro, 0, 89)).toBe(false);
  });

  it("returns closed rings inside [-180, 180]", () => {
    for (const date of dates) {
      for (const h of thresholds) {
        for (const poly of darkness(date, h).coordinates) {
          const ring = poly[0];
          expect(ring[0]).toEqual(ring[ring.length - 1]);
          for (const [lng, lat] of ring) {
            expect(lng).toBeGreaterThanOrEqual(-180);
            expect(lng).toBeLessThanOrEqual(180);
            expect(Math.abs(lat)).toBeLessThanOrEqual(90);
          }
        }
      }
    }
  });

  it("agrees with solarAltitude away from the boundary", () => {
    for (const date of dates) {
      for (const h of thresholds) {
        const g = darkness(date, h);
        for (let lat = -80; lat <= 80; lat += 10) {
          for (let lng = -170; lng <= 170; lng += 20) {
            const alt = solarAltitude(lat, lng, date);
            if (Math.abs(alt - h) < 1.5) continue;
            expect(isDarkIn(g, lng, lat), `${date.toISOString()} h=${h} (${lat},${lng}) alt=${alt}`).toBe(alt < h);
          }
        }
      }
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/sun`.

- [ ] **Step 4: Implement `lib/sun.ts`**

```ts
// Solar geometry for the Living Globe: where the sun is overhead right now,
// how high it stands anywhere on Earth, and the regions of night and
// twilight as GeoJSON. NOAA's low-precision formulas (~0.5°) — plenty for a
// map overlay.

export interface LatLng {
  lat: number;
  lng: number;
}

export type Ring = [number, number][];

export interface MultiPolygon {
  type: "MultiPolygon";
  coordinates: Ring[][];
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// Sun declination (radians) and the equation of time (minutes).
function solarParams(date: Date): { declination: number; eqTime: number } {
  const year = date.getUTCFullYear();
  const dayOfYear =
    Math.floor((date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  const hours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g =
    ((2 * Math.PI) / (isLeapYear(year) ? 366 : 365)) *
    (dayOfYear - 1 + (hours - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  return { declination, eqTime };
}

// Where on Earth the sun is directly overhead.
export function subsolarPoint(date: Date): LatLng {
  const { declination, eqTime } = solarParams(date);
  const utcMinutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  // Local true solar time is utcMinutes + eqTime + 4·lng; the sun is overhead
  // where that equals noon (720).
  return {
    lat: declination * DEG,
    lng: wrapLng((720 - utcMinutes - eqTime) / 4),
  };
}

// Angle of the sun above the horizon in degrees (negative = below it).
export function solarAltitude(lat: number, lng: number, date: Date): number {
  const sun = subsolarPoint(date);
  const phi = lat * RAD;
  const dec = sun.lat * RAD;
  const hourAngle = (lng - sun.lng) * RAD;
  const s =
    Math.sin(phi) * Math.sin(dec) +
    Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(clamp(s, -1, 1)) * DEG;
}

// True before local solar noon (the sun is still rising).
export function isMorning(lng: number, date: Date): boolean {
  return wrapLng(lng - subsolarPoint(date).lng) < 0;
}

// Everywhere the sun is below `altitudeDeg` (0 = night; −6/−12/−18 = civil,
// nautical and astronomical darkness), as a MultiPolygon within [-180, 180].
//
// Altitude = 90° − (arc distance from the subsolar point), so "below h" is
// the spherical cap within 90° + h of the antisolar point. A cap that covers
// a pole is traced meridian by meridian and closed through that pole; any
// other cap is a small circle, split where it crosses the antimeridian.
export function darkness(
  date: Date,
  altitudeDeg: number,
  stepDeg = 2,
): MultiPolygon {
  const sun = subsolarPoint(date);
  const center: LatLng = { lat: -sun.lat, lng: wrapLng(sun.lng + 180) };
  const radius = 90 + altitudeDeg;
  if (radius <= 0) return { type: "MultiPolygon", coordinates: [] };

  if (center.lat + radius > 90 || center.lat - radius < -90) {
    const pole = center.lat > 0 ? 90 : -90;
    return {
      type: "MultiPolygon",
      coordinates: [[poleCapRing(date, altitudeDeg, pole, stepDeg)]],
    };
  }
  return {
    type: "MultiPolygon",
    coordinates: splitAtAntimeridian(circleRing(center, radius, stepDeg)),
  };
}

// Boundary latitude on each meridian, found by bisection between the dark
// pole and the lit one (a pole-covering cap crosses each meridian once).
function poleCapRing(
  date: Date,
  altitudeDeg: number,
  pole: 90 | -90,
  stepDeg: number,
): Ring {
  const boundary: Ring = [];
  for (let lng = -180; lng <= 180; lng += stepDeg) {
    let dark: number = pole;
    let lit: number = -pole;
    for (let i = 0; i < 30; i++) {
      const mid = (dark + lit) / 2;
      if (solarAltitude(mid, lng, date) < altitudeDeg) dark = mid;
      else lit = mid;
    }
    boundary.push([lng, (dark + lit) / 2]);
  }
  return [...boundary, [180, pole], [-180, pole], boundary[0]];
}

// Point `distanceDeg` of arc from `from` along `bearingDeg` (lng unwrapped).
function destination(from: LatLng, distanceDeg: number, bearingDeg: number): LatLng {
  const d = distanceDeg * RAD;
  const b = bearingDeg * RAD;
  const lat1 = from.lat * RAD;
  const lng1 = from.lng * RAD;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: lat2 * DEG, lng: lng2 * DEG };
}

// A small circle as a closed ring with continuous (unwrapped) longitudes.
function circleRing(center: LatLng, radiusDeg: number, stepDeg: number): Ring {
  const ring: Ring = [];
  let prev: number | null = null;
  for (let bearing = 0; bearing <= 360; bearing += stepDeg) {
    const p = destination(center, radiusDeg, bearing);
    let lng = p.lng;
    if (prev !== null) {
      while (lng - prev > 180) lng -= 360;
      while (lng - prev < -180) lng += 360;
    }
    prev = lng;
    ring.push([lng, p.lat]);
  }
  ring[ring.length - 1] = ring[0];
  return ring;
}

// A ring with longitudes outside [-180, 180] becomes up to two polygons:
// clip it, and its copies shifted by ±360°, to the valid band.
function splitAtAntimeridian(ring: Ring): Ring[][] {
  const polygons: Ring[][] = [];
  for (const shift of [-360, 0, 360]) {
    const shifted = ring.map(([x, y]): [number, number] => [x + shift, y]);
    const clipped = clipToBand(shifted, -180, 180);
    if (clipped.length >= 4) polygons.push([clipped]);
  }
  return polygons;
}

// Sutherland–Hodgman against the (convex) band minX <= x <= maxX.
function clipToBand(ring: Ring, minX: number, maxX: number): Ring {
  let pts = ring.slice(0, -1);
  pts = clipEdge(pts, (p) => p[0] >= minX, minX);
  pts = clipEdge(pts, (p) => p[0] <= maxX, maxX);
  if (pts.length < 3) return [];
  return [...pts, pts[0]];
}

function clipEdge(
  pts: Ring,
  inside: (p: [number, number]) => boolean,
  x: number,
): Ring {
  const out: Ring = [];
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const prev = pts[(i + pts.length - 1) % pts.length];
    if (inside(cur)) {
      if (!inside(prev)) out.push(intersectX(prev, cur, x));
      out.push(cur);
    } else if (inside(prev)) {
      out.push(intersectX(prev, cur, x));
    }
  }
  return out;
}

function intersectX(
  a: [number, number],
  b: [number, number],
  x: number,
): [number, number] {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all `lib/sun.test.ts` tests).

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit -p . && npx eslint`

```bash
git add package.json package-lock.json vitest.config.ts lib/sun.ts lib/sun.test.ts
git commit -m "feat(globe): solar geometry for the day/night terminator (+ Vitest)"
```

---

### Task 2: Sky labels and local time (`lib/sky.ts`, `lib/localtime.ts`)

**Files:**
- Create: `lib/sky.ts`, `lib/sky.test.ts`, `lib/localtime.ts`, `lib/localtime.test.ts`
- Modify: `package.json` (dependency `@photostructure/tz-lookup`)

**Interfaces:**
- Consumes: `solarAltitude`, `isMorning` from `lib/sun.ts`.
- Produces: `type Sky = "night" | "before dawn" | "dawn" | "golden hour" | "daytime" | "dusk" | "late dusk"`; `skyFromAltitude(altitude: number, morning: boolean): Sky`; `skyAt(lat: number, lng: number, date: Date): Sky`; `isDark(lat: number, lng: number, date: Date): boolean`; `interface LocalTime { text: string; approximate: boolean }`; `loadTimeZones(): Promise<void>`; `localTime(lat: number, lng: number, date?: Date): LocalTime`; `solarTime(lng: number, date: Date): string`.

- [ ] **Step 1: Install the time-zone lookup and check its export shape**

Run: `npx -y npm@latest install @photostructure/tz-lookup`
Run: `node -e "const m=require('@photostructure/tz-lookup'); console.log(typeof m, typeof m.default, m.default ? m.default(14.6,121) : m(14.6,121))"`
Expected: prints a function type and `Asia/Manila`. (`localtime.ts` below handles both a default export and a bare CommonJS function.)

- [ ] **Step 2: Write the failing tests**

`lib/sky.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isDark, skyAt, skyFromAltitude } from "@/lib/sky";
import { subsolarPoint } from "@/lib/sun";

describe("skyFromAltitude", () => {
  it.each([
    [30, true, "daytime"],
    [3, true, "golden hour"],
    [3, false, "golden hour"],
    [-3, true, "dawn"],
    [-3, false, "dusk"],
    [-10, true, "before dawn"],
    [-10, false, "late dusk"],
    [-30, true, "night"],
  ] as const)("altitude %s, morning %s → %s", (alt, morning, sky) => {
    expect(skyFromAltitude(alt, morning)).toBe(sky);
  });
});

describe("skyAt / isDark", () => {
  const date = new Date("2024-04-15T12:00:00Z");
  const sun = subsolarPoint(date);
  it("is daytime under the sun and night opposite it", () => {
    expect(skyAt(sun.lat, sun.lng, date)).toBe("daytime");
    expect(skyAt(-sun.lat, sun.lng + 180, date)).toBe("night");
  });
  it("counts only a properly dark sky as dark", () => {
    expect(isDark(-sun.lat, sun.lng + 180, date)).toBe(true);
    expect(isDark(sun.lat, sun.lng, date)).toBe(false);
  });
});
```

`lib/localtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadTimeZones, localTime, solarTime } from "@/lib/localtime";

describe("solarTime", () => {
  const noonUtc = new Date("2026-01-01T12:00:00Z");
  it("shifts UTC by 4 minutes per degree of longitude", () => {
    expect(solarTime(0, noonUtc)).toBe("12:00 PM");
    expect(solarTime(90, noonUtc)).toBe("6:00 PM");
    expect(solarTime(-75, noonUtc)).toBe("7:00 AM");
  });
});

describe("localTime", () => {
  it("uses the real time zone once loaded", async () => {
    await loadTimeZones();
    const manila = localTime(14.6, 121, new Date("2026-01-01T00:00:00Z"));
    expect(manila).toEqual({ text: "8:00 AM", approximate: false });
    // New York observes daylight saving in July (UTC−4).
    const ny = localTime(40.71, -74.0, new Date("2026-07-01T12:00:00Z"));
    expect(ny).toEqual({ text: "8:00 AM", approximate: false });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/sky` / `@/lib/localtime`.

- [ ] **Step 4: Implement `lib/sky.ts`**

```ts
// What the sky looks like for a stranger right now, from the sun's altitude.
import { isMorning, solarAltitude } from "@/lib/sun";

export type Sky =
  | "night"
  | "before dawn"
  | "dawn"
  | "golden hour"
  | "daytime"
  | "dusk"
  | "late dusk";

// Thresholds follow the twilight bands drawn on the globe: civil (−6°) and
// astronomical (−18°) twilight; "golden hour" is the sun within 6° above.
export function skyFromAltitude(altitude: number, morning: boolean): Sky {
  if (altitude >= 6) return "daytime";
  if (altitude >= 0) return "golden hour";
  if (altitude >= -6) return morning ? "dawn" : "dusk";
  if (altitude >= -18) return morning ? "before dawn" : "late dusk";
  return "night";
}

export function skyAt(lat: number, lng: number, date: Date): Sky {
  return skyFromAltitude(solarAltitude(lat, lng, date), isMorning(lng, date));
}

// Under a dark sky: the sun more than 6° below the horizon.
export function isDark(lat: number, lng: number, date: Date): boolean {
  return solarAltitude(lat, lng, date) < -6;
}
```

- [ ] **Step 5: Implement `lib/localtime.ts`**

```ts
// A place's local wall-clock time, e.g. "4:12 AM". Time zones come from an
// offline lookup loaded on demand; until it's loaded (or if it fails) we
// fall back to solar time from the longitude, flagged as approximate.

export interface LocalTime {
  text: string;
  approximate: boolean;
}

type Lookup = (lat: number, lng: number) => string;

let lookup: Lookup | null = null;
let loading: Promise<void> | null = null;

export function loadTimeZones(): Promise<void> {
  loading ??= import("@photostructure/tz-lookup")
    .then((mod) => {
      const m = mod as unknown as { default?: Lookup } & Lookup;
      lookup = typeof m.default === "function" ? m.default : m;
    })
    .catch(() => {
      loading = null; // allow a retry later
    });
  return loading ?? Promise.resolve();
}

const FORMAT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

function format(date: Date, timeZone: string): string {
  // Newer ICU puts a narrow no-break space before AM/PM; normalize it.
  return date
    .toLocaleTimeString("en-US", { ...FORMAT, timeZone })
    .replace(/\s/g, " ");
}

export function localTime(lat: number, lng: number, date: Date = new Date()): LocalTime {
  if (lookup) {
    try {
      return { text: format(date, lookup(lat, lng)), approximate: false };
    } catch {
      // fall through to solar time
    }
  }
  return { text: solarTime(lng, date), approximate: true };
}

// Mean solar time: UTC shifted 4 minutes per degree of longitude.
export function solarTime(lng: number, date: Date): string {
  return format(new Date(date.getTime() + lng * 4 * 60_000), "UTC");
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (sun, sky, localtime).

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npx tsc --noEmit -p . && npx eslint`

```bash
git add package.json package-lock.json lib/sky.ts lib/sky.test.ts lib/localtime.ts lib/localtime.test.ts
git commit -m "feat(globe): sky condition and local time for any point on the map"
```

---

### Task 3: Visual system foundation (fonts, tokens, glass, toasts)

**Files:**
- Modify: `app/layout.tsx`, `app/globals.css`, `app/components/PulseApp.tsx`, `package.json` (dependency `lucide-react`)
- Create: `app/components/Toasts.tsx`

**Interfaces:**
- Produces: CSS classes `glass`, `btn-ember`, `btn-ghost`, `icon-btn`, `rise-in`, `pulse-marker`, `pulse-dot` (+ `is-busy`, `is-selected`), `flare`, `pulse-me`, `pulse-me-core`, `pulse-me-label`, `live-dot`, `countdown`, `locating-ring`, `incoming-ring`, `remote-frosted`; Tailwind colour utilities `space|deep|ember|glow|ink|muted|danger`; `font-display`; component `Toasts({ toasts }: { toasts: Toast[] })` with `interface Toast { id: number; text: string }`.

- [ ] **Step 1: Install icons**

Run: `npx -y npm@latest install lucide-react`

- [ ] **Step 2: Replace `app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Pulse — a living globe of strangers",
  description:
    "Everyone awake right now is a light on the globe. Tap one and say hello. No accounts, nothing stored.",
};

export const viewport: Viewport = {
  themeColor: "#05070d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Replace `app/globals.css`**

```css
@import "tailwindcss";

/* Midnight Observatory palette */
@theme {
  --color-space: #05070d;
  --color-deep: #0a0f1f;
  --color-ember: #ff8a5c;
  --color-glow: #ffd9a8;
  --color-ink: #eef1f8;
  --color-muted: #8a93a8;
  --color-danger: #ff5d6c;
}

@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --font-display: var(--font-instrument-serif);
}

:root {
  color-scheme: dark;
}

body {
  background: var(--color-space);
  color: var(--color-ink);
  font-family: var(--font-geist-sans), system-ui, sans-serif;
}

:focus-visible {
  outline: 2px solid var(--color-glow);
  outline-offset: 2px;
}

/* Frosted glass — the one surface material of the app. */
.glass {
  background: linear-gradient(160deg, rgb(255 255 255 / 0.09), rgb(255 255 255 / 0.03));
  border: 1px solid rgb(255 255 255 / 0.09);
  box-shadow:
    0 24px 60px -24px rgb(0 0 0 / 0.75),
    inset 0 1px 0 rgb(255 255 255 / 0.06);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
}

.btn-ember,
.btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 9999px;
  padding: 0.75rem 1.25rem;
  font-weight: 600;
  font-size: 0.9375rem;
  transition:
    transform 0.15s ease,
    box-shadow 0.2s ease,
    background 0.2s ease,
    opacity 0.2s ease;
}
.btn-ember {
  color: var(--color-space);
  background: linear-gradient(180deg, #ffa67f, var(--color-ember));
  box-shadow: 0 10px 30px -10px rgb(255 138 92 / 0.8);
}
.btn-ember:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 14px 36px -10px rgb(255 138 92 / 0.95);
}
.btn-ghost {
  color: var(--color-ink);
  background: rgb(255 255 255 / 0.06);
  border: 1px solid rgb(255 255 255 / 0.1);
}
.btn-ghost:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.11);
}
.btn-ember:disabled,
.btn-ghost:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.icon-btn {
  display: inline-grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 9999px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 0.06);
  border: 1px solid rgb(255 255 255 / 0.08);
  transition: background 0.2s ease, color 0.2s ease;
}
.icon-btn:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.12);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.icon-btn.is-danger {
  color: #fff;
  background: rgb(255 93 108 / 0.85);
  border-color: transparent;
}

.rise-in {
  animation: rise-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

/* Strangers: embers with a heartbeat. The marker wrapper is Mapbox's (it
   controls its opacity for globe occlusion); the dot inside is ours. */
.pulse-marker {
  position: relative;
}
.pulse-dot {
  position: relative;
  display: block;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  cursor: pointer;
  background: radial-gradient(
    circle,
    #fff3e3 0 18%,
    #ffb385 34%,
    var(--color-ember) 52%,
    rgb(255 138 92 / 0) 72%
  );
  animation: heartbeat 2.8s ease-in-out infinite;
  transition:
    opacity 0.4s ease,
    filter 0.4s ease,
    transform 0.15s ease;
}
.pulse-dot:hover,
.pulse-dot:focus-visible {
  transform: scale(1.25);
}
.pulse-dot.is-busy {
  opacity: 0.35;
  filter: saturate(0.3);
  animation: none;
}
.pulse-dot.is-selected {
  box-shadow:
    0 0 0 3px rgb(255 217 168 / 0.9),
    0 0 24px 6px rgb(255 138 92 / 0.6);
  animation: none;
}
/* Tooltip: who they are, in one line. */
.pulse-dot::after {
  content: attr(data-label);
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  translate: -50% 4px;
  white-space: nowrap;
  padding: 0.35rem 0.6rem;
  border-radius: 0.6rem;
  font-size: 11px;
  color: var(--color-ink);
  background: rgb(10 15 31 / 0.88);
  border: 1px solid rgb(255 255 255 / 0.1);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.15s ease,
    translate 0.15s ease;
}
.pulse-dot:hover::after,
.pulse-dot:focus-visible::after {
  opacity: 1;
  translate: -50% 0;
}
.pulse-marker.flare::before {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: 9999px;
  border: 2px solid var(--color-glow);
  pointer-events: none;
  animation: flare 1.6s ease-out forwards;
}

/* You */
.pulse-me {
  position: relative;
  width: 14px;
  height: 14px;
}
.pulse-me-core {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  background: #fff;
  box-shadow:
    0 0 0 4px rgb(255 255 255 / 0.15),
    0 0 18px 4px rgb(255 217 168 / 0.5);
}
.pulse-me-core::after {
  content: "";
  position: absolute;
  inset: -10px;
  border-radius: 9999px;
  border: 1px solid rgb(255 217 168 / 0.6);
  animation: sonar 3s ease-out infinite;
}
.pulse-me-label {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  translate: -50% 0;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--color-glow);
  white-space: nowrap;
}

.live-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: var(--color-ember);
  box-shadow: 0 0 10px var(--color-ember);
  animation: heartbeat 2.8s ease-in-out infinite;
}

.countdown circle.progress {
  stroke-dasharray: 113.1;
  animation: countdown linear forwards;
}

.locating-ring {
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  border: 2px solid rgb(5 7 13 / 0.3);
  border-top-color: var(--color-space);
  animation: spin 0.8s linear infinite;
}

.incoming-ring {
  position: relative;
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 9999px;
  color: var(--color-glow);
  background: radial-gradient(circle, rgb(255 138 92 / 0.35), rgb(255 138 92 / 0.05) 70%);
}
.incoming-ring::before,
.incoming-ring::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  border: 1px solid rgb(255 217 168 / 0.6);
  animation: sonar 2.4s ease-out infinite;
}
.incoming-ring::after {
  animation-delay: 1.2s;
}

/* Soft Reveal: the viewer's own blur, on top of the sender's frost. */
.remote-frosted {
  filter: blur(28px) saturate(1.3) brightness(0.9);
  scale: 1.08;
}

.mapboxgl-ctrl-attrib.mapboxgl-compact {
  background: rgb(10 15 31 / 0.6) !important;
}

@keyframes heartbeat {
  0%,
  100% {
    box-shadow: 0 0 10px 2px rgb(255 138 92 / 0.35);
  }
  12% {
    box-shadow: 0 0 22px 7px rgb(255 138 92 / 0.75);
  }
  24% {
    box-shadow: 0 0 12px 3px rgb(255 138 92 / 0.4);
  }
  36% {
    box-shadow: 0 0 18px 5px rgb(255 138 92 / 0.6);
  }
}
@keyframes flare {
  from {
    transform: scale(0.6);
    opacity: 1;
  }
  to {
    transform: scale(4);
    opacity: 0;
  }
}
@keyframes sonar {
  from {
    transform: scale(0.6);
    opacity: 0.9;
  }
  to {
    transform: scale(2.2);
    opacity: 0;
  }
}
@keyframes rise-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes countdown {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: 113.1;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: Create `app/components/Toasts.tsx`**

```tsx
"use client";

import { Info } from "lucide-react";

export interface Toast {
  id: number;
  text: string;
}

// Transient notices ("Request declined.", "Stranger disconnected."), stacked
// at the top of the screen and announced to screen readers.
export default function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="glass rise-in flex items-center gap-2 rounded-full px-4 py-2 text-sm text-ink"
        >
          <Info className="h-4 w-4 shrink-0 text-glow" aria-hidden />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Wire toasts into `PulseApp`**

In `app/components/PulseApp.tsx`:

Add the import after the `VideoPanel` import:

```tsx
import Toasts, { type Toast } from "./Toasts";
```

Replace `const [notice, setNotice] = useState<string | null>(null);` with:

```tsx
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
```

Replace the `showNotice` function with:

```tsx
  function showNotice(text: string) {
    const id = toastId.current++;
    setToasts((prev) => [...prev.slice(-2), { id, text }]);
    window.setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      4000,
    );
  }
```

Replace the `{notice && (...)}` JSX block with `<Toasts toasts={toasts} />`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p . && npx eslint && npm test`
Then (dev server on 3001 running): `E2E_PORT=3001 E2E_CHANNEL=chrome npm run test:e2e`
Expected: all 16 e2e tests pass (toasts carry the same notice texts; the CSP-violation check stays at zero).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json app/layout.tsx app/globals.css app/components/Toasts.tsx app/components/PulseApp.tsx
git commit -m "feat(ui): Midnight Observatory design tokens, fonts and glass toasts"
```

---

### Task 4: The globe — atmosphere, day/night, embers, you

**Files:**
- Modify: `lib/geo.ts`, `lib/api.ts`, `app/components/WorldMap.tsx` (rewrite), `app/components/PulseApp.tsx`
- Create: `lib/geo.test.ts`

**Interfaces:**
- Consumes: `darkness` (Task 1); `localTime`, `loadTimeZones` (Task 2); `skyAt` (Task 2).
- Produces:
  - `lib/geo.ts`: `destinationKm(lat: number, lng: number, km: number, bearingDeg: number): { lat: number; lng: number }`; `distanceKm(a: {lat:number;lng:number}, b: {lat:number;lng:number}): number`; `describeDistance(km: number): string`; `circleRingKm(lat: number, lng: number, km: number, steps?: number): [number, number][]`.
  - `lib/api.ts`: `interface Session { id: string; token: string; lat: number; lng: number }` — `lat/lng` is the public (offset) position generated by `join`.
  - `WorldMap` props: `{ peers: PeerDot[]; me: MePosition | null; live: boolean; selectedId: string | null; onSelect: (id: string | null) => void }`, `export interface MePosition { real: LatLng; public: LatLng }`. Wrapper div exposes `data-night-bands` (number of darkness layers drawn) and `data-spinning` (`"true"` while the entry globe spins).

- [ ] **Step 1: Write failing tests for the geo helpers** — `lib/geo.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { circleRingKm, describeDistance, destinationKm, distanceKm } from "@/lib/geo";

const MANILA = { lat: 14.5995, lng: 120.9842 };
const HONG_KONG = { lat: 22.3193, lng: 114.1694 };

describe("distanceKm", () => {
  it("measures Manila → Hong Kong (~1,115 km)", () => {
    expect(distanceKm(MANILA, HONG_KONG)).toBeGreaterThan(1100);
    expect(distanceKm(MANILA, HONG_KONG)).toBeLessThan(1130);
  });
});

describe("destinationKm", () => {
  it("lands the requested distance away", () => {
    const p = destinationKm(MANILA.lat, MANILA.lng, 3, 45);
    expect(distanceKm(MANILA, p)).toBeCloseTo(3, 2);
  });
});

describe("circleRingKm", () => {
  it("is a closed ring whose points are all ~km from the centre", () => {
    const ring = circleRingKm(MANILA.lat, MANILA.lng, 3, 32);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lng, lat] of ring) {
      expect(distanceKm(MANILA, { lat, lng })).toBeCloseTo(3, 2);
    }
  });
});

describe("describeDistance", () => {
  it.each([
    [2.4, "a few km away"],
    [42, "~40 km away"],
    [347, "~350 km away"],
    [1116, "~1,100 km away"],
  ])("%s km → %s", (km, text) => {
    expect(describeDistance(km)).toBe(text);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `destinationKm` etc. are not exported.

- [ ] **Step 3: Add the helpers to `lib/geo.ts`** (append after `isValidLatLng`)

```ts
const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;

// Point `km` away from (lat, lng) on compass bearing `bearingDeg`.
export function destinationKm(
  lat: number,
  lng: number,
  km: number,
  bearingDeg: number,
): { lat: number; lng: number } {
  const d = km / EARTH_RADIUS_KM;
  const b = bearingDeg * RAD;
  const lat1 = lat * RAD;
  const lng1 = lng * RAD;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: lat2 / RAD, lng: wrapLng(lng2 / RAD) };
}

// Great-circle (haversine) distance in km.
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// "a few km away", "~40 km away", "~1,100 km away" — dots are offset by up
// to 3 km, so more precision would be false precision.
export function describeDistance(km: number): string {
  if (km < 10) return "a few km away";
  const step = km < 100 ? 5 : km < 1000 ? 10 : 100;
  const rounded = Math.round(km / step) * step;
  return `~${rounded.toLocaleString("en-US")} km away`;
}

// Closed GeoJSON ring (lng, lat) approximating a circle of `km` radius.
export function circleRingKm(
  lat: number,
  lng: number,
  km: number,
  steps = 64,
): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const p = destinationKm(lat, lng, km, (360 / steps) * i);
    ring.push([p.lng, p.lat]);
  }
  ring.push(ring[0]);
  return ring;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Return the public position from `join`** — in `lib/api.ts`

Replace the `Session` interface with:

```ts
// A live session: `id` is public (others see it on your dot), `token` is the
// secret credential for every other call. `lat`/`lng` is the public, offset
// position this session was placed at. Kept in memory only.
export interface Session {
  id: string;
  token: string;
  lat: number;
  lng: number;
}
```

In `join`, replace `return res.json();` with:

```ts
  const { id, token } = (await res.json()) as { id: string; token: string };
  return { id, token, lat, lng };
```

- [ ] **Step 6: Rewrite `app/components/WorldMap.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { GeoJSONSource, Map as MapboxMap, Marker } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";
import { darkness } from "@/lib/sun";
import { circleRingKm } from "@/lib/geo";
import { localTime } from "@/lib/localtime";
import { skyAt } from "@/lib/sky";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Night deepens through civil, nautical and astronomical twilight: one
// translucent layer per band, so overlaps darken smoothly.
const DARKNESS_BANDS = [0, -6, -12, -18];
const NIGHT_REFRESH_MS = 60_000;
const FLARE_MS = 1_600;
const SPIN_DEG_PER_SEC = 4;

export interface LatLng {
  lat: number;
  lng: number;
}

// Your real location (only ever on your own screen) and the offset position
// everyone else sees.
export interface MePosition {
  real: LatLng;
  public: LatLng;
}

interface Props {
  peers: PeerDot[];
  me: MePosition | null;
  live: boolean; // false: entry backdrop (spins, not interactive)
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

interface DotEntry {
  marker: Marker;
  wrapper: HTMLDivElement;
  dot: HTMLButtonElement;
  busy: boolean;
}

const EMPTY = { type: "FeatureCollection" as const, features: [] };

function nightData(now: Date) {
  return {
    type: "FeatureCollection" as const,
    features: DARKNESS_BANDS.map((altitude) => ({
      type: "Feature" as const,
      properties: { altitude },
      geometry: darkness(now, altitude),
    })),
  };
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function flare(el: HTMLElement) {
  el.classList.remove("flare");
  void el.offsetWidth; // restart the animation
  el.classList.add("flare");
  window.setTimeout(() => el.classList.remove("flare"), FLARE_MS);
}

export default function WorldMap({ peers, me, live, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef(new Map<string, DotEntry>());
  const meMarkerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [nightBands, setNightBands] = useState(0);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
  // The entry backdrop spins, unless the user prefers reduced motion.
  const spinning = ready && !live && !reducedMotion;

  // Marker click handlers are bound once; read the live callback via a ref.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  // 1) Map, globe atmosphere, night layers, "you" layers.
  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;
    let cancelled = false;
    let nightTimer: ReturnType<typeof setInterval> | undefined;
    const markers = markersRef.current;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        projection: "globe",
        center: [100, 15],
        zoom: 1.6,
        attributionControl: false,
      });
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
      mapRef.current = map;

      map.on("style.load", () => {
        map.setFog({
          color: "rgb(10, 14, 28)",
          "high-color": "rgb(32, 46, 104)",
          "horizon-blend": 0.04,
          "space-color": "rgb(3, 5, 10)",
          "star-intensity": 0.55,
        });
        // Keep place labels readable on top of the night side.
        const firstLabel = map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
        map.addSource("night", { type: "geojson", data: nightData(new Date()) });
        map.addLayer(
          {
            id: "night",
            type: "fill",
            source: "night",
            paint: { "fill-color": "#010209", "fill-opacity": 0.2, "fill-antialias": false },
          },
          firstLabel,
        );
        map.addSource("privacy-ring", { type: "geojson", data: EMPTY });
        map.addLayer(
          {
            id: "privacy-ring",
            type: "fill",
            source: "privacy-ring",
            paint: { "fill-color": "#ffd9a8", "fill-opacity": 0.08 },
          },
          firstLabel,
        );
        map.addSource("public-me", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "public-me",
          type: "circle",
          source: "public-me",
          paint: {
            "circle-radius": 5,
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": "#ffd9a8",
            "circle-stroke-width": 1.5,
            "circle-stroke-opacity": 0.8,
          },
        });
        if (cancelled) return;
        setNightBands(DARKNESS_BANDS.length);
        setReady(true);
      });

      nightTimer = setInterval(() => {
        (map.getSource("night") as GeoJSONSource | undefined)?.setData(nightData(new Date()));
      }, NIGHT_REFRESH_MS);

      // Clicking empty map deselects (dot clicks stop propagation).
      map.on("click", () => onSelectRef.current(null));
    })();

    return () => {
      cancelled = true;
      if (nightTimer) clearInterval(nightTimer);
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // 2) Entry backdrop spins slowly and ignores input; going live flies to you.
  const meKey = me ? `${me.real.lat},${me.real.lng}` : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const handlers = [
      map.dragPan,
      map.scrollZoom,
      map.boxZoom,
      map.dragRotate,
      map.keyboard,
      map.doubleClickZoom,
      map.touchZoomRotate,
    ];
    if (!live) {
      handlers.forEach((h) => h.disable());
      if (!spinning) return;
      let active = true;
      const spin = () => {
        if (!active) return;
        const c = map.getCenter();
        map.easeTo({
          center: [c.lng + SPIN_DEG_PER_SEC, c.lat],
          duration: 1000,
          easing: (t) => t,
        });
      };
      map.on("moveend", spin);
      spin();
      return () => {
        active = false;
        map.off("moveend", spin);
        map.stop();
      };
    }
    handlers.forEach((h) => h.enable());
    if (meKey) {
      const [lat, lng] = meKey.split(",").map(Number);
      map.flyTo({ center: [lng, lat], zoom: 3.2, duration: 2800, essential: true });
    }
  }, [live, ready, spinning, meKey]);

  // 3) You: marker at your real location, the 1–3 km ring your dot is placed
  // in, and a hollow marker where others actually see you.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "pulse-me";
        el.title = "You — others see your dot somewhere 1–3 km from here";
        el.innerHTML =
          '<span class="pulse-me-core"></span><span class="pulse-me-label">You</span>';
        meMarkerRef.current = new mapboxgl.Marker({ element: el, occludedOpacity: 0 })
          .setLngLat([me.real.lng, me.real.lat])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([me.real.lng, me.real.lat]);
      }
      (map.getSource("privacy-ring") as GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            circleRingKm(me.real.lat, me.real.lng, 3),
            circleRingKm(me.real.lat, me.real.lng, 1).reverse(),
          ],
        },
      });
      (map.getSource("public-me") as GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [me.public.lng, me.public.lat] },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  // 4) Strangers: ember dots reconciled on every poll. A dot that just became
  // busy flares — someone somewhere started a conversation.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();
      const now = new Date();

      for (const peer of peers) {
        seen.add(peer.id);
        let entry = markers.get(peer.id);
        if (!entry) {
          const wrapper = document.createElement("div");
          wrapper.className = "pulse-marker";
          const dot = document.createElement("button");
          dot.type = "button";
          dot.className = "pulse-dot";
          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            onSelectRef.current(peer.id);
          });
          wrapper.appendChild(dot);
          const marker = new mapboxgl.Marker({ element: wrapper, occludedOpacity: 0 })
            .setLngLat([peer.lng, peer.lat])
            .addTo(map);
          entry = { marker, wrapper, dot, busy: peer.busy };
          markers.set(peer.id, entry);
        } else if (peer.busy && !entry.busy) {
          flare(entry.wrapper);
        }
        entry.busy = peer.busy;
        entry.dot.classList.toggle("is-busy", peer.busy);
        entry.dot.classList.toggle("is-selected", peer.id === selectedId);
        const time = localTime(peer.lat, peer.lng, now);
        const label = `Stranger · ${time.approximate ? "~" : ""}${time.text} · ${skyAt(
          peer.lat,
          peer.lng,
          now,
        )}${peer.busy ? " · in a conversation" : ""}`;
        entry.dot.dataset.label = label;
        entry.dot.setAttribute("aria-label", label);
      }

      for (const [id, { marker }] of markers) {
        if (!seen.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [peers, ready, selectedId]);

  return (
    <div
      className="absolute inset-0"
      data-night-bands={nightBands}
      data-spinning={spinning ? "true" : "false"}
    >
      <div ref={containerRef} className="h-full w-full bg-space" />
      {!TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="glass max-w-md rounded-2xl p-5 text-center text-sm text-ink">
            Set <code className="text-glow">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
            <code>.env</code> to load the globe.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Mount the map for the whole visit in `PulseApp`**

In `app/components/PulseApp.tsx`:

Change the WorldMap import to `import WorldMap, { type MePosition } from "./WorldMap";` and add `import { loadTimeZones } from "@/lib/localtime";`.

Replace the `myLocation` state with:

```tsx
  const [me, setMe] = useState<MePosition | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
```

Replace `rejoin` with:

```tsx
  async function rejoin() {
    if (!me) return;
    if (connRef.current.kind !== "idle") {
      teardown("You were away too long, so the connection ended.");
    }
    const s = await join(me.real.lat, me.real.lng);
    setSession(s);
    setMe({ real: me.real, public: { lat: s.lat, lng: s.lng } });
  }
```

Replace `handleReady` with:

```tsx
  async function handleReady(lat: number, lng: number) {
    const s = await join(lat, lng);
    setSession(s);
    setMe({ real: { lat, lng }, public: { lat: s.lat, lng: s.lng } });
    setPhase("live");
  }

  // Local times on the globe need the time-zone table; fetch it up front.
  useEffect(() => {
    void loadTimeZones();
  }, []);
```

Delete the early return `if (phase === "gate") { return <EntryGate onReady={handleReady} />; }`.

Replace the opening of the JSX (`<main ...>` through the `<WorldMap ... />` element) with:

```tsx
    <main className="fixed inset-0 overflow-hidden bg-space">
      <WorldMap
        peers={peers}
        me={me}
        live={phase === "live"}
        selectedId={selectedId}
        // Temporary until Task 5 adds the stranger card: select = request.
        onSelect={(id) => {
          if (id) requestConnection(id);
        }}
      />

      {phase === "gate" && (
        <div className="absolute inset-0 z-40 flex">
          <EntryGate onReady={handleReady} />
        </div>
      )}
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit -p . && npx eslint && npm test`
Run: `E2E_PORT=3001 E2E_CHANNEL=chrome npm run test:e2e`
Expected: all 16 e2e tests pass (dots are still `.pulse-dot`, clicking one still requests; CSP violations stay at zero).
Manually (optional): open http://localhost:3001 — a globe with atmosphere and stars; after entering, it flies to you; the night side is shaded.

- [ ] **Step 9: Commit**

```bash
git add lib/geo.ts lib/geo.test.ts lib/api.ts app/components/WorldMap.tsx app/components/PulseApp.tsx
git commit -m "feat(globe): 3D globe with live day/night, ember strangers and a privacy ring around you"
```

---

### Task 5: Entry, HUD, stranger card and incoming call

**Files:**
- Rename: `app/components/EntryGate.tsx` → `app/components/EntryOverlay.tsx` (rewrite)
- Create: `lib/use-now.ts`, `app/components/Hud.tsx`, `app/components/DotCard.tsx`, `app/components/SkyIcon.tsx`, `app/components/IncomingCall.tsx`
- Modify: `app/components/ConnectionPrompt.tsx` (restyle), `app/components/PulseApp.tsx`, `lib/presence.ts`, `e2e/two-strangers.spec.ts`

**Interfaces:**
- Consumes: `WorldMap` props (Task 4), `localTime`, `skyAt`, `isDark`, `Sky` (Task 2), `distanceKm`, `describeDistance` (Task 4).
- Produces: `useNow(): Date` from `lib/use-now.ts` (current time, refreshed every ~15 s, render-safe); `REQUEST_TIMEOUT_MS` exported from `lib/presence.ts`; `SkyIcon({ sky, className })`; `DotCard` props `{ peer: PeerDot; from: LatLng | null; requesting: boolean; canConnect: boolean; onSayHi(): void; onCancel(): void; onClose(): void }` rendered as `role="region" aria-label="Selected stranger"`; `IncomingCall` props `{ peer: PeerDot | undefined; onAccept(): void; onDecline(): void }`; `ConnectionPrompt` props `{ icon?: ReactNode; title: string; subtitle?: string; acceptLabel: string; declineLabel: string; onAccept(): void; onDecline(): void }`; `Hud` props `{ peers: PeerDot[]; reconnecting: boolean; showHint: boolean }`; e2e helper `sayHi(page)`.

- [ ] **Step 1: Update the e2e suite to the new flow (failing first)**

In `e2e/two-strangers.spec.ts`:

1. In `openStranger`, change `getByRole("button", { name: /enter pulse/i })` to `getByRole("button", { name: /drop in/i })` (also in the "raw location" test).
2. Add after `openStranger`:

```ts
// Tap a stranger's dot, then "Say hi" on their card.
async function sayHi(page: Page) {
  await page.locator(".pulse-dot").click();
  await page.getByRole("button", { name: "Say hi" }).click();
}
```

3. Replace every `await X.locator(".pulse-dot").click();` that starts a connection (main flow ×2, hostile, frozen, unreachable) with `await sayHi(X);`.
4. Replace every `/wants to connect/i` with `/wants to talk/i` and `/start video call/i` with `/start a video call\?/i`.
5. Add these tests at the end of the file:

```ts
test("the stranger card closes if they leave while it's open", async ({ browser }) => {
  const alice = await openStranger(browser, MANILA);
  const bob = await openStranger(browser, HONG_KONG);
  await alice.locator(".pulse-dot").click();
  const card = alice.getByRole("region", { name: "Selected stranger" });
  await expect(card).toBeVisible();
  await expect(card).toContainText(/\d{1,2}:\d{2} [AP]M/);
  await bob.close({ runBeforeUnload: true });
  await expect(card).toBeHidden();
  await alice.close({ runBeforeUnload: true });
});

test("the entry globe doesn't spin for reduced-motion users", async ({ browser }) => {
  const still = await browser.newContext({ reducedMotion: "reduce" });
  const moving = await browser.newContext();
  const a = await still.newPage();
  const b = await moving.newPage();
  await a.goto("/");
  await b.goto("/");
  await expect(b.locator("[data-spinning='true']")).toHaveCount(1);
  await expect(a.locator("[data-night-bands='4']")).toHaveCount(1);
  // Give a spin that shouldn't happen time to start before asserting.
  await a.waitForTimeout(1500);
  await expect(a.locator("[data-spinning='false']")).toHaveCount(1);
  await still.close();
  await moving.close();
});
```

Run: `E2E_PORT=3001 E2E_CHANNEL=chrome npm run test:e2e`
Expected: FAIL (no "Drop in" button yet).

- [ ] **Step 2: Share the request timeout** — `lib/presence.ts` (append)

```ts
// How long a connection request waits for an answer before giving up.
export const REQUEST_TIMEOUT_MS = 30_000;
```

In `PulseApp.tsx`, delete the local `const REQUEST_TIMEOUT_MS = 30_000;` and import it: `import { POLL_INTERVAL_MS, REQUEST_TIMEOUT_MS } from "@/lib/presence";`.

Create `lib/use-now.ts` (components must not call `new Date()` while rendering — `react-hooks/purity`):

```ts
import { useSyncExternalStore } from "react";

// The current time for rendering ("4:12 AM where they are"), as a React
// external store: stable within a 30 s bucket, re-read every 15 s.
const BUCKET_MS = 30_000;

const read = () => Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, BUCKET_MS / 2);
  return () => clearInterval(id);
}

export function useNow(): Date {
  return new Date(useSyncExternalStore(subscribe, read, read));
}
```

- [ ] **Step 3: `app/components/SkyIcon.tsx`**

```tsx
import { Moon, MoonStar, Sun, Sunrise, Sunset } from "lucide-react";
import type { Sky } from "@/lib/sky";

const ICONS: Record<Sky, typeof Sun> = {
  night: Moon,
  "before dawn": MoonStar,
  dawn: Sunrise,
  "golden hour": Sunset,
  daytime: Sun,
  dusk: Sunset,
  "late dusk": MoonStar,
};

export default function SkyIcon({ sky, className }: { sky: Sky; className?: string }) {
  const Icon = ICONS[sky];
  return <Icon className={className} aria-hidden />;
}
```

- [ ] **Step 4: `app/components/EntryOverlay.tsx`** (`git mv app/components/EntryGate.tsx app/components/EntryOverlay.tsx`, then replace its contents)

```tsx
"use client";

import { useState } from "react";
import { MapPin, ShieldCheck, UserX } from "lucide-react";

const CHIPS = [
  { icon: UserX, text: "No account" },
  { icon: MapPin, text: "1–3 km fuzz" },
  { icon: ShieldCheck, text: "Nothing stored" },
];

// The first screen: the globe spins behind frosted glass until you drop in.
export default function EntryOverlay({
  onReady,
}: {
  onReady: (lat: number, lng: number) => Promise<void>;
}) {
  const [status, setStatus] = useState<"idle" | "locating" | "error">("idle");
  const [error, setError] = useState("");

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("Your browser doesn't support location access.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        onReady(pos.coords.latitude, pos.coords.longitude).catch(() => {
          setStatus("error");
          setError("Couldn't join right now. Please try again in a moment.");
        }),
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Pulse needs your location to place you on the globe — it's fuzzed by 1–3 km before it leaves your device."
            : "Couldn't find your location. Please try again.",
        );
      },
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-linear-to-b from-space/30 via-space/20 to-space/85 p-5">
      <div className="glass rise-in w-full max-w-md rounded-[2rem] px-7 py-9 text-center">
        <p className="text-[11px] uppercase tracking-[0.35em] text-muted">
          a living globe of strangers
        </p>
        <h1 className="mt-3 font-display text-7xl leading-none text-ink">Pulse</h1>
        <p className="mx-auto mt-4 max-w-xs text-balance text-muted">
          Everyone awake right now is a light on the globe. Tap one and say
          hello.
        </p>
        <ul className="mt-6 flex flex-wrap justify-center gap-2">
          {CHIPS.map(({ icon: Icon, text }) => (
            <li
              key={text}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-ink/85"
            >
              <Icon className="h-3.5 w-3.5 text-glow" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        <button
          onClick={enter}
          disabled={status === "locating"}
          className="btn-ember mt-8 w-full py-3.5 text-base"
        >
          {status === "locating" ? (
            <>
              <span className="locating-ring" aria-hidden /> Finding you…
            </>
          ) : (
            "Drop in"
          )}
        </button>
        {status === "error" && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}
        <p className="mt-6 text-xs text-muted">
          Chat and video go straight between browsers — never through our
          servers.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `app/components/Hud.tsx`**

```tsx
"use client";

import type { PeerDot } from "@/lib/types";
import { isDark } from "@/lib/sky";
import { useNow } from "@/lib/use-now";

// Brand, a live head count (and how many are under the night sky), and a
// hint for what to do next.
export default function Hud({
  peers,
  reconnecting,
  showHint,
}: {
  peers: PeerDot[];
  reconnecting: boolean;
  showHint: boolean;
}) {
  const now = useNow();
  const n = peers.length;
  const underNight = peers.filter((p) => isDark(p.lat, p.lng, now)).length;
  const count =
    n === 0
      ? "No one else is here yet"
      : `${n} ${n === 1 ? "stranger" : "strangers"} awake · ${underNight} under the night sky`;

  return (
    <>
      <header className="pointer-events-none absolute left-4 top-4 z-20 max-w-[calc(100vw-2rem)]">
        <div className="glass rise-in flex items-center gap-3 rounded-2xl px-4 py-3">
          <span className="live-dot" aria-hidden />
          <div>
            <p className="font-display text-2xl leading-none text-ink">Pulse</p>
            <p className="mt-1 text-xs text-muted" aria-live="polite">
              {count}
            </p>
          </div>
        </div>
        {reconnecting && (
          <p className="glass mt-2 inline-block rounded-full px-3 py-1 text-xs text-glow">
            Reconnecting…
          </p>
        )}
      </header>
      {showHint && (
        <p className="glass rise-in pointer-events-none absolute bottom-8 left-1/2 z-10 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full px-4 py-2 text-center text-sm text-ink/85">
          {n === 0
            ? "It's quiet right now — open Pulse in a second window to meet yourself."
            : "Tap a glowing dot to say hello."}
        </p>
      )}
    </>
  );
}
```

- [ ] **Step 6: `app/components/DotCard.tsx`**

```tsx
"use client";

import { MessageCircle, X } from "lucide-react";
import type { PeerDot } from "@/lib/types";
import { localTime } from "@/lib/localtime";
import { skyAt } from "@/lib/sky";
import { describeDistance, distanceKm } from "@/lib/geo";
import { REQUEST_TIMEOUT_MS } from "@/lib/presence";
import { useNow } from "@/lib/use-now";
import SkyIcon from "./SkyIcon";

// The stranger you tapped: their local time and sky, how far away they are,
// and a deliberate "Say hi" (tapping a dot never sends a request by itself).
export default function DotCard({
  peer,
  from,
  requesting,
  canConnect,
  onSayHi,
  onCancel,
  onClose,
}: {
  peer: PeerDot;
  from: { lat: number; lng: number } | null;
  requesting: boolean;
  canConnect: boolean;
  onSayHi: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const now = useNow();
  const time = localTime(peer.lat, peer.lng, now);
  const sky = skyAt(peer.lat, peer.lng, now);

  return (
    <section
      role="region"
      aria-label="Selected stranger"
      className="glass rise-in absolute bottom-6 left-1/2 z-20 w-[min(92vw,22rem)] -translate-x-1/2 rounded-3xl p-5"
    >
      {requesting ? (
        <div className="flex items-center gap-4">
          <svg className="countdown h-12 w-12 shrink-0 -rotate-90" viewBox="0 0 40 40" aria-hidden>
            <circle cx="20" cy="20" r="18" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="3" />
            <circle
              className="progress"
              cx="20"
              cy="20"
              r="18"
              fill="none"
              stroke="#ff8a5c"
              strokeWidth="3"
              strokeLinecap="round"
              style={{ animationDuration: `${REQUEST_TIMEOUT_MS}ms` }}
            />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="font-display text-xl text-ink">Waiting for them…</p>
            <p className="text-sm text-muted">It&rsquo;s {time.text} where they are.</p>
          </div>
          <button onClick={onCancel} className="btn-ghost px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-2 text-sm capitalize text-glow">
              <SkyIcon sky={sky} className="h-4 w-4" />
              {sky}
            </p>
            <button onClick={onClose} className="icon-btn h-8 w-8" aria-label="Close">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="mt-1 font-display text-5xl leading-none text-ink">
            {time.approximate ? "~" : ""}
            {time.text}
          </p>
          <p className="mt-2 text-sm text-muted">
            their local time
            {from ? ` · ${describeDistance(distanceKm(from, peer))}` : ""}
          </p>
          {peer.busy && (
            <p className="mt-3 text-sm text-ink/80">In a conversation right now.</p>
          )}
          <button
            onClick={onSayHi}
            disabled={!canConnect || peer.busy}
            className="btn-ember mt-5 w-full"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            Say hi
          </button>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Restyle `app/components/ConnectionPrompt.tsx` and add `IncomingCall.tsx`**

`app/components/ConnectionPrompt.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";

// A centred glass prompt for "someone wants to talk" / "start video?".
export default function ConnectionPrompt({
  icon,
  title,
  subtitle,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-space/55 p-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-title"
    >
      <div className="glass rise-in w-full max-w-sm rounded-3xl p-7 text-center">
        {icon && <div className="incoming-ring mx-auto">{icon}</div>}
        <h2 id="prompt-title" className="mt-5 font-display text-3xl leading-tight text-ink">
          {title}
        </h2>
        {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        <div className="mt-7 flex gap-3">
          <button onClick={onDecline} className="btn-ghost flex-1">
            {declineLabel}
          </button>
          <button onClick={onAccept} className="btn-ember flex-1">
            {acceptLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

`app/components/IncomingCall.tsx`:

```tsx
"use client";

import type { PeerDot } from "@/lib/types";
import { localTime } from "@/lib/localtime";
import { skyAt } from "@/lib/sky";
import ConnectionPrompt from "./ConnectionPrompt";
import { useNow } from "@/lib/use-now";
import SkyIcon from "./SkyIcon";

// "A stranger wants to talk" — with the one thing you know about them: what
// time it is, and what the sky looks like, where they are.
export default function IncomingCall({
  peer,
  onAccept,
  onDecline,
}: {
  peer: PeerDot | undefined;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const now = useNow();
  const sky = peer ? skyAt(peer.lat, peer.lng, now) : "night";
  const subtitle = peer
    ? `It's ${localTime(peer.lat, peer.lng, now).text} (${sky}) where they are.`
    : "Somewhere on the globe.";
  return (
    <ConnectionPrompt
      icon={<SkyIcon sky={sky} className="h-6 w-6" />}
      title="A stranger wants to talk"
      subtitle={subtitle}
      acceptLabel="Accept"
      declineLabel="Not now"
      onAccept={onAccept}
      onDecline={onDecline}
    />
  );
}
```

- [ ] **Step 8: Wire everything into `PulseApp`**

In `app/components/PulseApp.tsx`:

Imports: replace `import EntryGate from "./EntryGate";` with

```tsx
import EntryOverlay from "./EntryOverlay";
import Hud from "./Hud";
import DotCard from "./DotCard";
import IncomingCall from "./IncomingCall";
```

and add `import { Video } from "lucide-react";`.

Add state below `selectedId`:

```tsx
  const [reconnecting, setReconnecting] = useState(false);
  const pollFailures = useRef(0);
```

In the poll `tick`, after `setPeers(data.peers);` add `pollFailures.current = 0; setReconnecting(false);`, and in the `catch (err)` block, before the `SessionExpiredError` check, add:

```tsx
        if (!(err instanceof SessionExpiredError)) {
          pollFailures.current++;
          if (pollFailures.current >= 3) setReconnecting(true);
        }
```

When a connection starts, drop the card: in `acceptIncoming` after `setConn({ kind: "connecting", peerId });` add `setSelectedId(null);`, and in `processSignal` case `"accept"` after `setConn({ kind: "connecting", peerId: sig.fromId });` add `setSelectedId(null);`.

Replace the whole JSX `return (...)` with:

```tsx
  const inChat = conn.kind === "connecting" || conn.kind === "connected";
  const selectedPeer = peers.find((p) => p.id === selectedId);
  const requestingSelected =
    conn.kind === "requesting" && conn.peerId === selectedId;

  return (
    <main className="fixed inset-0 overflow-hidden bg-space">
      <WorldMap
        peers={peers}
        me={me}
        live={phase === "live"}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {phase === "gate" ? (
        <EntryOverlay onReady={handleReady} />
      ) : (
        <Hud
          peers={peers}
          reconnecting={reconnecting}
          showHint={conn.kind === "idle" && !selectedPeer}
        />
      )}

      <Toasts toasts={toasts} />

      {selectedPeer && !inChat && (
        <DotCard
          peer={selectedPeer}
          from={me?.real ?? null}
          requesting={requestingSelected}
          canConnect={conn.kind === "idle"}
          onSayHi={() => requestConnection(selectedPeer.id)}
          onCancel={cancelRequest}
          onClose={() => {
            if (requestingSelected) cancelRequest();
            setSelectedId(null);
          }}
        />
      )}

      {conn.kind === "incoming" && (
        <IncomingCall
          peer={peers.find((p) => p.id === conn.peerId)}
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      {inChat && (
        <ChatPanel
          messages={messages}
          connected={conn.kind === "connected"}
          videoBusy={video !== "none"}
          onSend={(text) => {
            peerRef.current?.sendChat(text);
            addMessage(true, text);
          }}
          onStartVideo={startVideoRequest}
          onEnd={endConnection}
        />
      )}

      {video === "requesting" && (
        <div className="glass absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-sm text-ink">
          Waiting for them to accept video…
        </div>
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          icon={<Video className="h-6 w-6" aria-hidden />}
          title="Start a video call?"
          subtitle="The stranger would like to turn on video."
          acceptLabel="Accept"
          declineLabel="Not now"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          onEnd={endVideo}
        />
      )}
    </main>
  );
```

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit -p . && npx eslint && npm test`
Run: `E2E_PORT=3001 E2E_CHANNEL=chrome npm run test:e2e`
Expected: all tests pass, including the two new ones (card closes when the stranger leaves; reduced motion doesn't spin).

- [ ] **Step 10: Commit**

```bash
git add -A app/components lib/presence.ts e2e/two-strangers.spec.ts
git commit -m "feat(ui): entry overlay, live HUD, stranger card with local time, incoming call"
```

---

### Task 6: Chat sheet and Skip & block

**Files:**
- Rename: `app/components/ChatPanel.tsx` → `app/components/ChatSheet.tsx` (rewrite)
- Modify: `app/components/PulseApp.tsx`, `e2e/two-strangers.spec.ts`

**Interfaces:**
- Consumes: `SkyIcon`, `localTime`, `skyAt`, `MAX_CHAT_LENGTH` (from `lib/webrtc.ts`).
- Produces: `export interface ChatMessage { id: number; mine: boolean; text: string; at: number }`; `ChatSheet` props `{ messages: ChatMessage[]; connected: boolean; peer: PeerDot | undefined; videoActive: boolean; videoPending: boolean; videoBusy: boolean; onSend(text: string): void; onStartVideo(): void; onEnd(): void; onSkip(): void }`; in `PulseApp`: `blockedRef: Set<string>`, `skipAndBlock()`, `visiblePeers`.

- [ ] **Step 1: Update/add e2e tests (failing first)**

In `e2e/two-strangers.spec.ts` replace `getByRole("button", { name: "Video" })` with `getByRole("button", { name: "Start video" })` and `getByRole("button", { name: "End", exact: true })` with `getByRole("button", { name: "End chat" })`. Add:

```ts
test("skip & block hides the stranger and declines their requests", async ({ browser }) => {
  const alice = await openStranger(browser, MANILA);
  const bob = await openStranger(browser, HONG_KONG);
  await sayHi(alice);
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(bob.getByText("Connected", { exact: true })).toBeVisible();

  await bob.getByRole("button", { name: "Skip and block" }).click();
  await expect(alice.getByText(/stranger disconnected/i)).toBeVisible();
  await expect(bob.locator(".pulse-dot")).toHaveCount(0);
  await expect(alice.locator(".pulse-dot")).toHaveCount(1);

  await sayHi(alice);
  await expect(alice.getByText(/declined/i)).toBeVisible();
  await expect(bob.getByText(/wants to talk/i)).toBeHidden();

  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});

test("on a phone, long messages wrap and nothing scrolls sideways", async ({ browser }) => {
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const alice = await openStranger(browser, MANILA, phone);
  const bob = await openStranger(browser, HONG_KONG, phone);
  await sayHi(alice);
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(alice.getByText("Connected", { exact: true })).toBeVisible();

  const long = "x".repeat(300);
  await alice.getByPlaceholder(/type a message/i).fill(long);
  await alice.getByRole("button", { name: "Send" }).click();
  await expect(bob.getByText(long)).toBeVisible();

  for (const page of [alice, bob]) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const bubble = page.getByText(long);
    const box = await bubble.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});
```

and extend `openStranger`'s options with a context override: change its signature to

```ts
async function openStranger(
  browser: Browser,
  geolocation: { latitude: number; longitude: number },
  {
    unreachable = false,
    controllableClock = false,
    hostile = false,
    ...contextOptions
  }: {
    unreachable?: boolean;
    controllableClock?: boolean;
    hostile?: boolean;
  } & BrowserContextOptions = {},
): Promise<Page> {
```

with `BrowserContextOptions` imported from `@playwright/test`, and spread `...contextOptions` into the `browser.newContext({...})` call.

Run: `E2E_PORT=3001 E2E_CHANNEL=chrome npm run test:e2e`
Expected: FAIL (no "Start video"/"Skip and block" buttons yet).

- [ ] **Step 2: `app/components/ChatSheet.tsx`** (`git mv app/components/ChatPanel.tsx app/components/ChatSheet.tsx`, then replace its contents)

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { PhoneOff, SendHorizontal, ShieldBan, Video } from "lucide-react";
import { MAX_CHAT_LENGTH } from "@/lib/webrtc";
import { useNow } from "@/lib/use-now";
import type { PeerDot } from "@/lib/types";
import { localTime } from "@/lib/localtime";
import { skyAt } from "@/lib/sky";
import SkyIcon from "./SkyIcon";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
  at: number;
}

const clock = (at: number) =>
  new Date(at)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(/\s/g, " ");

// The conversation: a side sheet on desktop, a bottom sheet on phones
// (shorter while video is on, so both fit).
export default function ChatSheet({
  messages,
  connected,
  peer,
  videoActive,
  videoPending,
  videoBusy,
  onSend,
  onStartVideo,
  onEnd,
  onSkip,
}: {
  messages: ChatMessage[];
  connected: boolean;
  peer: PeerDot | undefined;
  videoActive: boolean;
  videoPending: boolean;
  videoBusy: boolean;
  onSend: (text: string) => void;
  onStartVideo: () => void;
  onEnd: () => void;
  onSkip: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  const sky = peer ? skyAt(peer.lat, peer.lng, now) : null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
  }

  return (
    <aside
      className={`glass rise-in absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-3xl md:inset-y-4 md:left-auto md:right-4 md:h-auto md:w-[26rem] md:rounded-3xl ${
        videoActive ? "h-[42vh]" : "h-[62vh]"
      }`}
      aria-label="Chat with stranger"
    >
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl leading-none text-ink">Stranger</p>
          <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted">
            {sky && peer && (
              <>
                <SkyIcon sky={sky} className="h-3.5 w-3.5 text-glow" />
                {localTime(peer.lat, peer.lng, now).text} · {sky} ·{" "}
              </>
            )}
            <span className={connected ? "text-glow" : ""}>
              {connected ? "Connected" : "Connecting…"}
            </span>
          </p>
        </div>
        <button
          onClick={onStartVideo}
          disabled={!connected || videoBusy}
          className="icon-btn"
          aria-label="Start video"
          title="Start video"
        >
          <Video className="h-4 w-4" aria-hidden />
        </button>
        <button
          onClick={onSkip}
          className="icon-btn"
          aria-label="Skip and block"
          title="Skip and block — you won't see them again this visit"
        >
          <ShieldBan className="h-4 w-4" aria-hidden />
        </button>
        <button onClick={onEnd} className="icon-btn is-danger" aria-label="End chat" title="End chat">
          <PhoneOff className="h-4 w-4" aria-hidden />
        </button>
      </header>

      {videoPending && (
        <p className="border-b border-white/10 px-4 py-2 text-xs text-glow">
          Waiting for them to accept video…
        </p>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="mx-auto mt-6 max-w-[16rem] text-center text-sm text-muted">
            Say hello. Messages go straight to them — peer-to-peer, never
            stored.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap ${
                m.mine
                  ? "rounded-br-md bg-ember text-space"
                  : "rounded-bl-md bg-white/10 text-ink"
              }`}
            >
              {m.text}
              <span className={`mt-0.5 block text-[10px] ${m.mine ? "text-space/60" : "text-muted"}`}>
                {clock(m.at)}
              </span>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t border-white/10 p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={connected ? "Type a message…" : "Connecting…"}
          disabled={!connected}
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-glow/60 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          className="btn-ember h-11 w-11 p-0"
          aria-label="Send"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </aside>
  );
}
```

- [ ] **Step 3: Wire the sheet and blocking into `PulseApp`**

In `app/components/PulseApp.tsx`:

- Change `import ChatPanel, { type ChatMessage } from "./ChatPanel";` to `import ChatSheet, { type ChatMessage } from "./ChatSheet";`.
- `addMessage` becomes:

```tsx
  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [
      ...prev,
      { id: msgId.current++, mine, text, at: Date.now() },
    ]);
  }
```

- Add blocking state below `selectedId`:

```tsx
  // Skip & block: hidden and auto-declined for the rest of this visit.
  // (Session ids are ephemeral by design, so nothing outlives the tab.)
  const blockedRef = useRef<Set<string>>(new Set());
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(new Set());
```

- Add below `endConnection`:

```tsx
  function skipAndBlock() {
    const c = connRef.current;
    if (c.kind !== "connecting" && c.kind !== "connected") return;
    blockedRef.current.add(c.peerId);
    setBlocked(new Set(blockedRef.current));
    endConnection();
    showNotice("Skipped — you won't see them again this visit.");
  }
```

- In `processSignal` case `"request"`, make the first statement:

```tsx
        if (blockedRef.current.has(sig.fromId)) {
          void signal(sig.fromId, "decline");
          break;
        }
```

- In the render section add `const visiblePeers = peers.filter((p) => !blocked.has(p.id));` and use `visiblePeers` instead of `peers` for `WorldMap`, `Hud`, `selectedPeer` and `IncomingCall`'s lookup.
- Replace the `{inChat && (<ChatPanel .../>)}` block and the `{video === "requesting" && (...)}` pill with:

```tsx
      {inChat && (
        <ChatSheet
          messages={messages}
          connected={conn.kind === "connected"}
          peer={visiblePeers.find((p) => p.id === conn.peerId)}
          videoActive={video === "active"}
          videoPending={video === "requesting"}
          videoBusy={video !== "none"}
          onSend={(text) => {
            peerRef.current?.sendChat(text);
            addMessage(true, text);
          }}
          onStartVideo={startVideoRequest}
          onEnd={endConnection}
          onSkip={skipAndBlock}
        />
      )}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p . && npx eslint && npm test`
Run: `E2E_PORT=3001 E2E_CHANNEL=chrome npm run test:e2e`
Expected: all pass, including skip & block and the phone-layout test.

- [ ] **Step 5: Commit**

```bash
git add -A app/components e2e/two-strangers.spec.ts
git commit -m "feat(ui): glass chat sheet with local time, and Skip & block"
```

---

### Task 7: Soft Reveal

**Files:**
- Create: `lib/frost.ts`, `lib/frost.test.ts`, `app/components/VideoStage.tsx`
- Delete: `app/components/VideoPanel.tsx`
- Modify: `lib/webrtc.ts`, `app/components/PulseApp.tsx`, `e2e/two-strangers.spec.ts`, `docs/superpowers/specs/2026-09-30-observatory-soft-reveal-design.md`

**Interfaces:**
- Produces:
  - `lib/frost.ts`: `frostSize(width: number, height: number): { width: number; height: number }`; `class FrostedCamera { constructor(camera: MediaStream); readonly stream: MediaStream; get revealed(): boolean; setRevealed(revealed: boolean): void; setMicMuted(muted: boolean): void; stop(): void }`.
  - `lib/webrtc.ts`: `PeerControl` gains `"reveal" | "frost"`; `PeerSession.startVideo(): Promise<MediaStream>` now returns the frosted stream; new `PeerSession.setRevealed(revealed: boolean): void`, `PeerSession.setMicMuted(muted: boolean): void`.
  - `VideoStage` props `{ localStream: MediaStream | null; remoteStream: MediaStream | null; revealedMe: boolean; remoteRevealed: boolean; showRemote: boolean; micMuted: boolean; onToggleReveal(): void; onShowRemote(): void; onToggleMic(): void; onEnd(): void }`; remote `<video>` carries `data-remote` and class `remote-frosted` until **Show them**.

- [ ] **Step 1: Write the failing unit test** — `lib/frost.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { frostSize } from "@/lib/frost";

describe("frostSize", () => {
  it.each([
    [1280, 720, 640, 360],
    [640, 480, 640, 480],
    [320, 240, 320, 240],
    [1080, 1920, 640, 1138],
    [0, 0, 640, 480],
  ])("%sx%s → %sx%s", (w, h, ew, eh) => {
    expect(frostSize(w, h)).toEqual({ width: ew, height: eh });
  });
});
```

Run: `npm test` → FAIL (module missing).

- [ ] **Step 2: Implement `lib/frost.ts`**

```ts
// Soft Reveal. The camera is never sent to the peer directly: each frame is
// drawn onto a canvas — frosted until the user reveals themselves — and the
// canvas stream is what the peer receives. So no clear frame can leave the
// device before "Reveal me", whatever the other side's client does.
//
// Frames are drawn on requestAnimationFrame, which browsers pause in hidden
// tabs: if you switch away, your outgoing video freezes (fails private).

const MAX_WIDTH = 640;
const REVEAL_MS = 600;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// Output size: the camera's aspect ratio, at most 640 px wide.
export function frostSize(width: number, height: number): { width: number; height: number } {
  const w = width > 0 ? width : 640;
  const h = height > 0 ? height : 480;
  const scale = Math.min(1, MAX_WIDTH / w);
  return { width: even(w * scale), height: even(h * scale) };
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return [canvas, ctx];
}

export class FrostedCamera {
  // Canvas video + the original audio: this is what gets sent.
  readonly stream: MediaStream;

  private readonly video: HTMLVideoElement;
  private readonly out: HTMLCanvasElement;
  private readonly outCtx: CanvasRenderingContext2D;
  private readonly small: HTMLCanvasElement;
  private readonly smallCtx: CanvasRenderingContext2D;
  private readonly tiny: HTMLCanvasElement;
  private readonly tinyCtx: CanvasRenderingContext2D;
  private target = 0; // 0 = frosted, 1 = revealed
  private amount = 0; // eased toward target for a soft cross-fade
  private last = 0;
  private raf = 0;
  private stopped = false;

  constructor(private readonly camera: MediaStream) {
    const settings = camera.getVideoTracks()[0]?.getSettings() ?? {};
    const size = frostSize(settings.width ?? 0, settings.height ?? 0);
    [this.out, this.outCtx] = makeCanvas(size.width, size.height);
    [this.small, this.smallCtx] = makeCanvas(128, even((128 * size.height) / size.width));
    [this.tiny, this.tinyCtx] = makeCanvas(32, even((32 * size.height) / size.width));

    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = camera;
    void this.video.play().catch(() => {});

    this.stream = new MediaStream([
      ...this.out.captureStream(30).getVideoTracks(),
      ...camera.getAudioTracks(),
    ]);
    this.raf = requestAnimationFrame(this.frame);
  }

  get revealed(): boolean {
    return this.target === 1;
  }

  setRevealed(revealed: boolean): void {
    this.target = revealed ? 1 : 0;
  }

  setMicMuted(muted: boolean): void {
    for (const track of this.camera.getAudioTracks()) track.enabled = !muted;
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    for (const track of this.stream.getTracks()) track.stop();
    for (const track of this.camera.getTracks()) track.stop();
    this.video.srcObject = null;
  }

  private frame = (now: number) => {
    if (this.stopped) return;
    const step = (this.last ? now - this.last : 16) / REVEAL_MS;
    this.last = now;
    this.amount =
      this.target > this.amount
        ? Math.min(this.target, this.amount + step)
        : Math.max(this.target, this.amount - step);
    if (this.video.readyState >= 2) this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw() {
    const { width, height } = this.out;
    const ctx = this.outCtx;
    if (this.amount < 1) {
      // Frost: shrink the frame to a few dozen pixels (all detail gone), then
      // scale it back up smoothly — a soft, frosted-glass silhouette.
      this.smallCtx.drawImage(this.video, 0, 0, this.small.width, this.small.height);
      this.tinyCtx.drawImage(this.small, 0, 0, this.tiny.width, this.tiny.height);
      this.smallCtx.drawImage(this.tiny, 0, 0, this.small.width, this.small.height);
      ctx.globalAlpha = 1;
      ctx.drawImage(this.small, 0, 0, width, height);
      ctx.fillStyle = "rgba(214, 226, 255, 0.10)";
      ctx.fillRect(0, 0, width, height);
    }
    if (this.amount > 0) {
      ctx.globalAlpha = this.amount;
      ctx.drawImage(this.video, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }
  }
}
```

Run: `npm test` → PASS.

- [ ] **Step 3: Send the frosted stream from `PeerSession`** — `lib/webrtc.ts`

- Add `import { FrostedCamera } from "@/lib/frost";` at the top.
- Extend the control type and allowlist:

```ts
export type PeerControl =
  | "video-request"
  | "video-accept"
  | "video-decline"
  | "video-end"
  | "reveal"
  | "frost";

const CONTROLS: readonly string[] = [
  "video-request",
  "video-accept",
  "video-decline",
  "video-end",
  "reveal",
  "frost",
];
```

- Replace the `localStream` field with `private camera: FrostedCamera | null = null;`.
- Replace `startVideo` and `stopVideo` with:

```ts
  // Soft Reveal: the peer receives the frosted canvas stream, never the
  // camera itself. Returns that stream (it doubles as the honest self-view).
  async startVideo(): Promise<MediaStream> {
    if (!this.camera) {
      const raw = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      this.camera = new FrostedCamera(raw);
      for (const track of this.camera.stream.getTracks()) {
        this.pc.addTrack(track, this.camera.stream);
      }
    }
    return this.camera.stream;
  }

  setRevealed(revealed: boolean) {
    if (!this.camera) return;
    this.camera.setRevealed(revealed);
    this.sendControl(revealed ? "reveal" : "frost");
  }

  setMicMuted(muted: boolean) {
    this.camera?.setMicMuted(muted);
  }

  stopVideo() {
    if (!this.camera) return;
    this.camera.stop();
    for (const sender of this.pc.getSenders()) {
      if (sender.track) {
        try {
          this.pc.removeTrack(sender);
        } catch {}
      }
    }
    this.camera = null;
  }
```

- [ ] **Step 4: `app/components/VideoStage.tsx`** (and `git rm app/components/VideoPanel.tsx`)

```tsx
"use client";

import { useEffect, useRef } from "react";
import { Eye, Mic, MicOff, Snowflake, Sparkles, VideoOff } from "lucide-react";

// Soft Reveal video. Both people start frosted at the source. You decide
// when to reveal yourself, and — separately — when to look at them: their
// video stays blurred on your side until you tap "Show them", which is only
// offered once they've revealed.
export default function VideoStage({
  localStream,
  remoteStream,
  revealedMe,
  remoteRevealed,
  showRemote,
  micMuted,
  onToggleReveal,
  onShowRemote,
  onToggleMic,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  revealedMe: boolean;
  remoteRevealed: boolean;
  showRemote: boolean;
  micMuted: boolean;
  onToggleReveal: () => void;
  onShowRemote: () => void;
  onToggleMic: () => void;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <section
      className="absolute inset-x-0 top-0 bottom-[42vh] z-30 overflow-hidden bg-deep md:inset-y-0 md:left-0 md:right-[28rem] md:bottom-0"
      aria-label="Video call"
    >
      <video
        ref={remoteRef}
        data-remote
        autoPlay
        playsInline
        className={`h-full w-full object-cover transition-[filter,scale] duration-700 ${
          showRemote ? "" : "remote-frosted"
        }`}
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
        {!remoteStream ? (
          <p className="glass rounded-full px-4 py-2 text-sm text-ink">
            Waiting for their camera…
          </p>
        ) : !remoteRevealed ? (
          <p className="glass flex items-center gap-2 rounded-full px-4 py-2 text-sm text-ink">
            <Snowflake className="h-4 w-4 text-glow" aria-hidden />
            They&rsquo;re frosted — they&rsquo;ll reveal when they&rsquo;re ready.
          </p>
        ) : !showRemote ? (
          <div className="glass pointer-events-auto rise-in rounded-3xl p-5 text-center">
            <p className="font-display text-2xl text-ink">They revealed themselves</p>
            <p className="mt-1 text-sm text-muted">Look when you&rsquo;re ready.</p>
            <button onClick={onShowRemote} className="btn-ember mt-4">
              <Eye className="h-4 w-4" aria-hidden />
              Show them
            </button>
          </div>
        ) : null}
      </div>

      <figure className="glass absolute right-4 top-4 w-28 overflow-hidden rounded-2xl md:w-40">
        <video ref={localRef} autoPlay playsInline muted className="aspect-[3/4] w-full object-cover" />
        <figcaption className="px-2 py-1.5 text-center text-[11px] text-ink/85">
          {revealedMe ? "They can see you" : "You're frosted"}
        </figcaption>
      </figure>

      <div className="glass absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full p-2">
        <button
          onClick={onToggleReveal}
          className={revealedMe ? "btn-ghost px-4 py-2 text-sm" : "btn-ember px-4 py-2 text-sm"}
        >
          {revealedMe ? (
            <>
              <Snowflake className="h-4 w-4" aria-hidden /> Frost me
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden /> Reveal me
            </>
          )}
        </button>
        <button
          onClick={onToggleMic}
          className="icon-btn"
          aria-label={micMuted ? "Unmute" : "Mute"}
          title={micMuted ? "Unmute" : "Mute"}
        >
          {micMuted ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
        </button>
        <button onClick={onEnd} className="icon-btn is-danger" aria-label="End video" title="End video">
          <VideoOff className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Reveal state in `PulseApp`**

In `app/components/PulseApp.tsx`:

- Replace `import VideoPanel from "./VideoPanel";` with `import VideoStage from "./VideoStage";`.
- Add state below `remoteStream`:

```tsx
  // Soft Reveal: what I show (revealedMe), what they've shown (remoteRevealed)
  // and whether I've chosen to look (showRemote). Every call starts frosted.
  const [revealedMe, setRevealedMe] = useState(false);
  const [remoteRevealed, setRemoteRevealed] = useState(false);
  const [showRemote, setShowRemote] = useState(false);
  const [micMuted, setMicMuted] = useState(false);

  function resetReveal() {
    setRevealedMe(false);
    setRemoteRevealed(false);
    setShowRemote(false);
    setMicMuted(false);
  }
```

- Call `resetReveal();` in: `teardown` (after `setVideo("none")`), `endVideo` (after `setVideo("none")`), `handleControl` case `"video-end"` (after `setVideo("none")`), and at the start of `acceptVideo` and of `handleControl` case `"video-accept"`.
- Add to `handleControl`'s switch:

```tsx
      case "reveal":
        setRemoteRevealed(true);
        break;
      case "frost":
        setRemoteRevealed(false);
        setShowRemote(false);
        break;
```

- Add handlers below `endVideo`:

```tsx
  function toggleReveal() {
    const next = !revealedMe;
    peerRef.current?.setRevealed(next);
    setRevealedMe(next);
  }

  function toggleMic() {
    const next = !micMuted;
    peerRef.current?.setMicMuted(next);
    setMicMuted(next);
  }
```

- In the video prompt change `subtitle` to `"You'll both start frosted — reveal yourself only when you're ready."`.
- Replace the `{video === "active" && (<VideoPanel .../>)}` block with:

```tsx
      {video === "active" && (
        <VideoStage
          localStream={localStream}
          remoteStream={remoteStream}
          revealedMe={revealedMe}
          remoteRevealed={remoteRevealed}
          showRemote={showRemote}
          micMuted={micMuted}
          onToggleReveal={toggleReveal}
          onShowRemote={() => remoteRevealed && setShowRemote(true)}
          onToggleMic={toggleMic}
          onEnd={endVideo}
        />
      )}
```

- [ ] **Step 6: e2e — frost is enforced at the source, consent, restart, camera denied**

In `e2e/two-strangers.spec.ts`, add `denyCamera = false` to `openStranger`'s destructured options and `denyCamera?: boolean;` to its option type, and, when set, before `goto`:

```ts
  if (denyCamera) {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
  }
```

Add helpers:

```ts
const remoteVideo = (page: Page) => page.locator("video[data-remote]");

// Edge detail (variance of the Laplacian) of the frame the receiver actually
// decoded — CSS blur doesn't affect drawImage, so this measures what was sent.
async function remoteSharpness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const v = document.querySelector("video[data-remote]") as HTMLVideoElement;
    const w = 160;
    const h = 120;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(v, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    };
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const lap = 4 * g(x, y) - g(x - 1, y) - g(x + 1, y) - g(x, y - 1) - g(x, y + 1);
        sum += lap;
        sum2 += lap * lap;
        n++;
      }
    }
    const mean = sum / n;
    return sum2 / n - mean * mean;
  });
}

async function startVideo(caller: Page, callee: Page) {
  await caller.getByRole("button", { name: "Start video" }).click();
  await expect(callee.getByText(/start a video call\?/i)).toBeVisible();
  await callee.getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => remoteVideoIsPlaying(caller)).toBe(true);
  await expect.poll(() => remoteVideoIsPlaying(callee)).toBe(true);
}
```

Add tests:

```ts
test("soft reveal: frames stay frosted at the source until the sender reveals", async ({ browser }) => {
  const alice = await openStranger(browser, MANILA);
  const bob = await openStranger(browser, HONG_KONG);
  await sayHi(alice);
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(alice.getByText("Connected", { exact: true })).toBeVisible();
  await startVideo(alice, bob);

  await bob.waitForTimeout(1500);
  const frosted = await remoteSharpness(bob);
  await expect(bob.getByText(/they're frosted/i)).toBeVisible();
  await expect(bob.getByRole("button", { name: "Show them" })).toHaveCount(0);

  await alice.getByRole("button", { name: "Reveal me" }).click();
  // Bob is told — but still sees her blurred until he chooses to look.
  await expect(bob.getByRole("button", { name: "Show them" })).toBeVisible();
  await expect(remoteVideo(bob)).toHaveCSS("filter", /blur/);
  // The frames themselves are now clear.
  await expect
    .poll(() => remoteSharpness(bob), { timeout: 10_000 })
    .toBeGreaterThan(frosted * 4);

  await bob.getByRole("button", { name: "Show them" }).click();
  await expect(remoteVideo(bob)).toHaveCSS("filter", "none");

  // Ending and restarting video starts frosted again, on both sides.
  await alice.getByRole("button", { name: "End video" }).click();
  await expect(bob.getByPlaceholder(/type a message/i)).toBeVisible();
  await startVideo(bob, alice);
  await expect(bob.getByText(/they're frosted/i)).toBeVisible();
  await expect(remoteVideo(bob)).toHaveCSS("filter", /blur/);
  await bob.waitForTimeout(1500);
  expect(await remoteSharpness(bob)).toBeLessThan(frosted * 2);

  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});

test("a denied camera declines the video cleanly and keeps the chat", async ({ browser }) => {
  const alice = await openStranger(browser, MANILA);
  const bob = await openStranger(browser, HONG_KONG, { denyCamera: true });
  await sayHi(alice);
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(alice.getByText("Connected", { exact: true })).toBeVisible();

  await alice.getByRole("button", { name: "Start video" }).click();
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(bob.getByText(/camera unavailable/i)).toBeVisible();
  await expect(alice.getByText(/video declined/i)).toBeVisible();
  await expect(alice.getByRole("button", { name: "Start video" })).toBeEnabled();
  await expect(bob.getByPlaceholder(/type a message/i)).toBeEnabled();

  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});
```

Also, in the main flow test, add after the first "video call starts" step:

```ts
  await test.step("video starts frosted with the Soft Reveal controls", async () => {
    await expect(alice.getByRole("button", { name: "Reveal me" })).toBeVisible();
    await expect(bob.getByText(/they're frosted/i)).toBeVisible();
  });
```

Run: `E2E_PORT=3001 E2E_CHANNEL=chrome npm run test:e2e`
Expected: all pass. If the sharpness ratio assertion fails, print `frosted` and the revealed value (`console.log`) and adjust only the multiplier (keep "revealed ≫ frosted" and "restart ≈ frosted").

- [ ] **Step 7: Keep the spec in sync**

In the spec's Soft Reveal section, replace "Each frame (`requestVideoFrameCallback`, falling back to `requestAnimationFrame`)" with "Each animation frame (`requestAnimationFrame`, which also pauses in hidden tabs)".

- [ ] **Step 8: Verify and commit**

Run: `npx tsc --noEmit -p . && npx eslint && npm test`

```bash
git add -A lib app/components e2e/two-strangers.spec.ts docs/superpowers/specs
git commit -m "feat(safety): Soft Reveal — video frosted at the source until you reveal, and you choose when to look"
```

---

### Task 8: Living Globe check, notes, full verification, ship

**Files:**
- Modify: `e2e/two-strangers.spec.ts`, `NOTES.md`

- [ ] **Step 1: e2e — Living Globe**

```ts
test("living globe: night is drawn and strangers show their local time and sky", async ({ browser }) => {
  const alice = await openStranger(browser, MANILA);
  const bob = await openStranger(browser, HONG_KONG);
  await expect(alice.locator("[data-night-bands='4']")).toHaveCount(1);
  await expect(alice.getByText(/1 stranger awake · \d under the night sky/)).toBeVisible();
  await alice.locator(".pulse-dot").click();
  const card = alice.getByRole("region", { name: "Selected stranger" });
  await expect(card).toContainText(/\d{1,2}:\d{2} [AP]M/);
  await expect(card).toContainText(/night|before dawn|dawn|golden hour|daytime|dusk|late dusk/i);
  await expect(card).toContainText(/~1,100 km away/);
  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});
```

Run: `E2E_PORT=3001 E2E_CHANNEL=chrome npm run test:e2e` → PASS.

- [ ] **Step 2: Append Phase 2 and Phase 4 to `NOTES.md`**

Insert between the Phase 1 and Phase 3 sections:

```markdown
## Phase 2 — Make it good

**Direction: "Midnight Observatory."** Looking down at Earth at night — calm and
intimate rather than a busy social app. One surface material (frosted glass), one warm
accent (ember), a serif for the human moments (Instrument Serif) and Geist for UI.

- **Globe, not a flat map:** 3D globe floating in space with atmosphere and stars; it
  spins slowly behind the entry screen and flies down to you when you drop in.
- **Strangers are embers with a heartbeat;** busy ones dim and stop beating. Hovering
  shows who they are in one line (their local time and sky).
- **Tap → card → Say hi.** The original sent a request the instant you touched a dot
  (easy to do by accident on a phone). Now you see a card first — their local time,
  sky, distance — and choose to say hi; waiting shows a 30 s countdown ring.
- **Honest privacy UI:** your own marker sits at your real location (only on your
  screen) inside the faint 1–3 km ring your public dot is placed in, with a hollow
  marker where others actually see you.
- **Chat as a glass sheet** (side sheet on desktop, bottom sheet on phones), bubbles
  with timestamps, long words wrap; video no longer covers the chat.
- **Copy and states:** empty globe ("open a second window to meet yourself"),
  reconnecting indicator, toasts for every outcome.
- **Motion with restraint:** CSS-only, and `prefers-reduced-motion` stops the spin and
  animations. Everything works within the strict CSP (no inline styles/scripts).

## Phase 4 — Make it better

Two features, one "alive" and one "safe":

**Soft Reveal (safety).** The worst thing about video with strangers is unwanted
exposure. So video starts **frosted at the source**: the camera is drawn to a canvas
(shrunk to 32 px and scaled back up) and the *canvas* stream is what's sent. The other
person never receives a clear frame until you tap **Reveal me** — even a modified
client can't un-frost what never left your device. Consent runs both ways: when they
reveal, you're told, but they stay blurred on your side until you tap **Show them**.
Plus **Skip & block** (hidden and auto-declined for the rest of the visit). The e2e test
proves the enforcement by measuring edge detail in the frames the *receiver* decodes:
frosted before reveal, sharp after.

**Living Globe (alive).** The globe shows the real **day/night terminator** with
civil/nautical/astronomical twilight bands (computed from the sun's position every
minute), each stranger's **local time and sky** ("4:12 AM · before dawn"), a live
count of how many strangers are under the night sky, and a **flare** whenever a dot
starts a conversation. It's all computed in the browser from data that was already
public — nothing new is sent or stored.

**Why these two:** they're visible in exactly the test reviewers run (two windows →
connect → video), and they answer the product's two real questions — "why would I
open this?" (it feels like a living planet) and "why would I trust it?" (you control
what you show and what you see).

**Next, with more time:** a TURN relay (and relay-only mode to hide IPs), server-side
reports with rate-limited consequences, "golden hour" matching (meet someone where the
sun is rising), and a Reduced-data mode for the globe on slow phones.
```

- [ ] **Step 3: Full verification — dev and production**

Run: `npx tsc --noEmit -p . && npx eslint && npm test`
Run: `E2E_PORT=3001 E2E_CHANNEL=chrome npm run test:e2e` → all pass.
Run: `npm run build`, start `npx next start -p 3002`, then `E2E_BASE_URL=http://localhost:3002 E2E_CHANNEL=chrome npm run test:e2e` → all pass (CSP violations zero in production).

- [ ] **Step 4: Commit and push**

```bash
git add e2e/two-strangers.spec.ts NOTES.md
git commit -m "docs: Phase 2 and Phase 4 notes; Living Globe e2e"
git push origin main
```
