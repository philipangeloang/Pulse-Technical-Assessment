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
