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
    // (±180 is a polygon edge; probe just inside it.)
    expect(isDarkIn(night, 179, 0)).toBe(true);
    expect(isDarkIn(night, -179, 0)).toBe(true);
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
    expect(isDarkIn(astro, 179, 0)).toBe(true);
    expect(isDarkIn(astro, -179, 0)).toBe(true);
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
