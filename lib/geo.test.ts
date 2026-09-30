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
