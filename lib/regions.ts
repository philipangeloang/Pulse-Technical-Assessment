// Coarse world regions for the Explore menu: which region a dot is in, and
// where to point the camera for each. Approximate continent boxes are plenty
// here (dots are already fuzzed by 1–3 km); points in open ocean fall back
// to the nearest region.
import { distanceKm } from "@/lib/geo";

export type RegionId =
  | "africa"
  | "asia"
  | "europe"
  | "north-america"
  | "oceania"
  | "south-america";

// [south, west, north, east] in degrees.
type Box = [number, number, number, number];

export interface Region {
  id: RegionId;
  label: string;
  view: { center: [number, number]; zoom: number }; // [lng, lat]
  boxes: Box[];
}

// Order matters: the first region whose box contains a point wins.
export const REGIONS: Region[] = [
  {
    id: "oceania",
    label: "Oceania",
    view: { center: [160, -20], zoom: 2.3 },
    boxes: [
      [-50, 110, -10, 180], // Australia, New Zealand
      [-10, 140, 0, 180], // New Guinea, Solomons
      [0, 160, 25, 180], // Micronesia
      [-50, -180, 25, -120], // Polynesia, Hawai'i
    ],
  },
  {
    id: "south-america",
    label: "South America",
    view: { center: [-60, -18], zoom: 2.5 },
    boxes: [[-57, -93, 13, -32]],
  },
  {
    id: "north-america",
    label: "North America",
    view: { center: [-100, 42], zoom: 2.4 },
    boxes: [
      [13, -170, 84, -50], // incl. Alaska, Canada
      [7, -93, 13, -60], // Central America, Caribbean
      [59, -73, 84, -24], // Greenland (stops short of Iceland)
    ],
  },
  {
    id: "europe",
    label: "Europe",
    view: { center: [15, 52], zoom: 3.0 },
    boxes: [[36, -25, 72, 45]],
  },
  {
    id: "africa",
    label: "Africa",
    view: { center: [20, 3], zoom: 2.5 },
    boxes: [
      [-36, -19, 36, 33], // up to the Suez
      [-36, 33, 13, 53], // Horn of Africa, East Africa
    ],
  },
  {
    id: "asia",
    label: "Asia",
    view: { center: [95, 32], zoom: 2.3 },
    boxes: [
      [-11, 33, 78, 180], // Middle East → Siberia, SE Asia
      [45, 45, 78, 180],
    ],
  },
];

const inBox = (lat: number, lng: number, [s, w, n, e]: Box) =>
  lat >= s && lat <= n && lng >= w && lng <= e;

export function regionOf(lat: number, lng: number): RegionId {
  for (const region of REGIONS) {
    if (region.boxes.some((box) => inBox(lat, lng, box))) return region.id;
  }
  // Open ocean (or a gap between boxes): the region whose view is closest.
  let best = REGIONS[0];
  let bestKm = Infinity;
  for (const region of REGIONS) {
    const [cLng, cLat] = region.view.center;
    const km = distanceKm({ lat, lng }, { lat: cLat, lng: cLng });
    if (km < bestKm) {
      best = region;
      bestKm = km;
    }
  }
  return best.id;
}

export function countByRegion(
  points: { lat: number; lng: number }[],
): Record<RegionId, number> {
  const counts = Object.fromEntries(REGIONS.map((r) => [r.id, 0])) as Record<
    RegionId,
    number
  >;
  for (const p of points) counts[regionOf(p.lat, p.lng)]++;
  return counts;
}
