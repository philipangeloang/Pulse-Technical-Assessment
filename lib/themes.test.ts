import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES, parseThemeId, themeById } from "@/lib/themes";

describe("themes", () => {
  it("has unique ids, a default, and every field a theme needs", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_THEME);
    for (const t of THEMES) {
      expect(t.mapStyle).toMatch(/^mapbox:\/\/styles\//);
      expect(t.colors.ember).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.colors.glow).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.fog["space-color"]).toBeTruthy();
      expect(t.night.opacity).toBeGreaterThan(0);
      expect(t.night.opacity).toBeLessThanOrEqual(0.25); // 4 stacked bands
    }
  });

  it("falls back to the default for unknown or missing stored values", () => {
    expect(parseThemeId("aurora")).toBe("aurora");
    expect(parseThemeId("nope")).toBe(DEFAULT_THEME);
    expect(parseThemeId(null)).toBe(DEFAULT_THEME);
    expect(themeById("nope").id).toBe(DEFAULT_THEME);
  });
});
