import { describe, expect, it } from "vitest";
import { frostSize, nextRevealAmount } from "@/lib/frost";

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

describe("nextRevealAmount", () => {
  it("fades in when revealing", () => {
    expect(nextRevealAmount(0, 1, 300)).toBeCloseTo(0.5, 5);
    expect(nextRevealAmount(0.9, 1, 300)).toBe(1);
  });
  it("frosts instantly — no more clear frames once you ask to be hidden", () => {
    expect(nextRevealAmount(1, 0, 16)).toBe(0);
    expect(nextRevealAmount(0.4, 0, 1)).toBe(0);
  });
});
