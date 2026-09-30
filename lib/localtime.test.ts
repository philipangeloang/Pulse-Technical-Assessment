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
