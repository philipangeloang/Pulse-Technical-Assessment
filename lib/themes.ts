// Visual themes. Each one restyles the globe (Mapbox style, atmosphere, a
// light tint of land and water) and the app's accent colours. A theme is a
// personal preference: it changes only your view, never what others see.

export type ThemeId = "midnight" | "aurora" | "blue-marble" | "daybreak";

export interface Theme {
  id: ThemeId;
  label: string;
  description: string;
  mapStyle: string;
  fog: {
    color: string;
    "high-color": string;
    "horizon-blend": number;
    "space-color": string;
    "star-intensity": number;
  };
  // Paint overrides for the style's land/water layers (skipped if absent).
  tint: { land?: string; landuse?: string; water?: string };
  colors: { ember: string; glow: string };
  // Night shading: one translucent layer per twilight band, so this is the
  // per-band opacity (light maps need far less than dark ones).
  night: { color: string; opacity: number };
}

export const DEFAULT_THEME: ThemeId = "midnight";

export const THEMES: Theme[] = [
  {
    id: "midnight",
    label: "Midnight",
    description: "Navy globe, ember lights",
    mapStyle: "mapbox://styles/mapbox/dark-v11",
    fog: {
      color: "rgb(10, 14, 28)",
      "high-color": "rgb(32, 46, 104)",
      "horizon-blend": 0.04,
      "space-color": "rgb(3, 5, 10)",
      "star-intensity": 0.55,
    },
    tint: { land: "#0d1326", landuse: "#101730", water: "#05080f" },
    colors: { ember: "#ff8a5c", glow: "#ffd9a8" },
    night: { color: "#010209", opacity: 0.2 },
  },
  {
    id: "aurora",
    label: "Aurora",
    description: "Teal-violet sky, mint lights",
    mapStyle: "mapbox://styles/mapbox/dark-v11",
    fog: {
      color: "rgb(8, 22, 30)",
      "high-color": "rgb(96, 44, 176)",
      "horizon-blend": 0.08,
      "space-color": "rgb(7, 4, 20)",
      "star-intensity": 0.75,
    },
    tint: { land: "#0a1d24", landuse: "#0c222b", water: "#030c13" },
    colors: { ember: "#4ff3c4", glow: "#c4b5fd" },
    night: { color: "#02030c", opacity: 0.2 },
  },
  {
    id: "blue-marble",
    label: "Blue Marble",
    description: "The real Earth, from space",
    mapStyle: "mapbox://styles/mapbox/satellite-v9",
    fog: {
      color: "rgb(12, 20, 40)",
      "high-color": "rgb(36, 92, 223)",
      "horizon-blend": 0.03,
      "space-color": "rgb(4, 5, 14)",
      "star-intensity": 0.6,
    },
    tint: {},
    colors: { ember: "#ffc24d", glow: "#ffe6a8" },
    night: { color: "#000207", opacity: 0.22 },
  },
  {
    id: "daybreak",
    label: "Daybreak",
    description: "Soft daylight, coral lights",
    mapStyle: "mapbox://styles/mapbox/light-v11",
    fog: {
      color: "rgb(255, 255, 255)",
      "high-color": "rgb(190, 206, 240)",
      "horizon-blend": 0.06,
      "space-color": "rgb(214, 226, 246)",
      "star-intensity": 0,
    },
    tint: { water: "#c9dcf0" },
    colors: { ember: "#ff6b5a", glow: "#ffcfc4" },
    night: { color: "#2a3a6e", opacity: 0.07 },
  },
];

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? themeById(DEFAULT_THEME);
}

export function parseThemeId(value: string | null | undefined): ThemeId {
  return THEMES.some((t) => t.id === value) ? (value as ThemeId) : DEFAULT_THEME;
}
