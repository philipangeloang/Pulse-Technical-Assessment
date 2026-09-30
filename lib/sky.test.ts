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
