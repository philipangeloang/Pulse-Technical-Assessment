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
