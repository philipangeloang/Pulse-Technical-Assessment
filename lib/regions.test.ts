import { describe, expect, it } from "vitest";
import { REGIONS, countByRegion, regionOf } from "@/lib/regions";

describe("regionOf", () => {
  it.each([
    ["Manila", 14.6, 121.0, "asia"],
    ["Tokyo", 35.7, 139.7, "asia"],
    ["Dubai", 25.2, 55.3, "asia"],
    ["Jakarta", -6.2, 106.8, "asia"],
    ["Sydney", -33.9, 151.2, "oceania"],
    ["Auckland", -36.8, 174.8, "oceania"],
    ["Port Moresby", -9.4, 147.2, "oceania"],
    ["Papeete", -17.55, -149.56, "oceania"],
    ["Honolulu", 21.3, -157.9, "oceania"],
    ["London", 51.5, -0.1, "europe"],
    ["Moscow", 55.8, 37.6, "europe"],
    ["Reykjavik", 64.1, -21.9, "europe"],
    ["Cairo", 30.0, 31.2, "africa"],
    ["Lagos", 6.5, 3.4, "africa"],
    ["Nairobi", -1.3, 36.8, "africa"],
    ["New York", 40.7, -74.0, "north-america"],
    ["Mexico City", 19.4, -99.1, "north-america"],
    ["Anchorage", 61.2, -149.9, "north-america"],
    ["São Paulo", -23.5, -46.6, "south-america"],
    ["Lima", -12.0, -77.0, "south-america"],
  ])("%s → %s", (_city, lat, lng, region) => {
    expect(regionOf(lat, lng)).toBe(region);
  });

  it("puts open-ocean points in the nearest region", () => {
    expect(regionOf(-40, -20)).toBeDefined(); // South Atlantic
    expect(regionOf(-60, 90)).toBeDefined(); // Southern Ocean
  });
});

describe("countByRegion", () => {
  it("counts people per region, including empty regions", () => {
    const counts = countByRegion([
      { lat: 14.6, lng: 121 },
      { lat: 35.7, lng: 139.7 },
      { lat: 51.5, lng: -0.1 },
    ]);
    expect(counts.asia).toBe(2);
    expect(counts.europe).toBe(1);
    expect(counts.africa).toBe(0);
    expect(Object.keys(counts).sort()).toEqual(REGIONS.map((r) => r.id).sort());
  });
});
