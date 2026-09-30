// Solar geometry for the Living Globe: where the sun is overhead right now,
// how high it stands anywhere on Earth, and the regions of night and
// twilight as GeoJSON. NOAA's low-precision formulas (~0.5°) — plenty for a
// map overlay.

export interface LatLng {
  lat: number;
  lng: number;
}

export type Ring = [number, number][];

export interface MultiPolygon {
  type: "MultiPolygon";
  coordinates: Ring[][];
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// Sun declination (radians) and the equation of time (minutes).
function solarParams(date: Date): { declination: number; eqTime: number } {
  const year = date.getUTCFullYear();
  const dayOfYear =
    Math.floor((date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  const hours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g =
    ((2 * Math.PI) / (isLeapYear(year) ? 366 : 365)) *
    (dayOfYear - 1 + (hours - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  return { declination, eqTime };
}

// Where on Earth the sun is directly overhead.
export function subsolarPoint(date: Date): LatLng {
  const { declination, eqTime } = solarParams(date);
  const utcMinutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  // Local true solar time is utcMinutes + eqTime + 4·lng; the sun is overhead
  // where that equals noon (720).
  return {
    lat: declination * DEG,
    lng: wrapLng((720 - utcMinutes - eqTime) / 4),
  };
}

// Angle of the sun above the horizon in degrees (negative = below it).
export function solarAltitude(lat: number, lng: number, date: Date): number {
  const sun = subsolarPoint(date);
  const phi = lat * RAD;
  const dec = sun.lat * RAD;
  const hourAngle = (lng - sun.lng) * RAD;
  const s =
    Math.sin(phi) * Math.sin(dec) +
    Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(clamp(s, -1, 1)) * DEG;
}

// True before local solar noon (the sun is still rising).
export function isMorning(lng: number, date: Date): boolean {
  return wrapLng(lng - subsolarPoint(date).lng) < 0;
}

// Everywhere the sun is below `altitudeDeg` (0 = night; −6/−12/−18 = civil,
// nautical and astronomical darkness), as a MultiPolygon within [-180, 180].
//
// Altitude = 90° − (arc distance from the subsolar point), so "below h" is
// the spherical cap within 90° + h of the antisolar point. A cap that covers
// a pole is traced meridian by meridian and closed through that pole; any
// other cap is a small circle, split where it crosses the antimeridian.
export function darkness(
  date: Date,
  altitudeDeg: number,
  stepDeg = 2,
): MultiPolygon {
  const sun = subsolarPoint(date);
  const center: LatLng = { lat: -sun.lat, lng: wrapLng(sun.lng + 180) };
  const radius = 90 + altitudeDeg;
  if (radius <= 0) return { type: "MultiPolygon", coordinates: [] };

  if (center.lat + radius > 90 || center.lat - radius < -90) {
    const pole = center.lat > 0 ? 90 : -90;
    return {
      type: "MultiPolygon",
      coordinates: [[poleCapRing(date, altitudeDeg, pole, stepDeg)]],
    };
  }
  return {
    type: "MultiPolygon",
    coordinates: splitAtAntimeridian(circleRing(center, radius, stepDeg)),
  };
}

// Boundary latitude on each meridian, found by bisection between the dark
// pole and the lit one (a pole-covering cap crosses each meridian once).
function poleCapRing(
  date: Date,
  altitudeDeg: number,
  pole: 90 | -90,
  stepDeg: number,
): Ring {
  const boundary: Ring = [];
  for (let lng = -180; lng <= 180; lng += stepDeg) {
    let dark: number = pole;
    let lit: number = -pole;
    for (let i = 0; i < 30; i++) {
      const mid = (dark + lit) / 2;
      if (solarAltitude(mid, lng, date) < altitudeDeg) dark = mid;
      else lit = mid;
    }
    boundary.push([lng, (dark + lit) / 2]);
  }
  return [...boundary, [180, pole], [-180, pole], boundary[0]];
}

// Point `distanceDeg` of arc from `from` along `bearingDeg` (lng unwrapped).
function destination(from: LatLng, distanceDeg: number, bearingDeg: number): LatLng {
  const d = distanceDeg * RAD;
  const b = bearingDeg * RAD;
  const lat1 = from.lat * RAD;
  const lng1 = from.lng * RAD;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: lat2 * DEG, lng: lng2 * DEG };
}

// A small circle as a closed ring with continuous (unwrapped) longitudes.
function circleRing(center: LatLng, radiusDeg: number, stepDeg: number): Ring {
  const ring: Ring = [];
  let prev: number | null = null;
  for (let bearing = 0; bearing <= 360; bearing += stepDeg) {
    const p = destination(center, radiusDeg, bearing);
    let lng = p.lng;
    if (prev !== null) {
      while (lng - prev > 180) lng -= 360;
      while (lng - prev < -180) lng += 360;
    }
    prev = lng;
    ring.push([lng, p.lat]);
  }
  ring[ring.length - 1] = ring[0];
  return ring;
}

// A ring with longitudes outside [-180, 180] becomes up to two polygons:
// clip it, and its copies shifted by ±360°, to the valid band.
function splitAtAntimeridian(ring: Ring): Ring[][] {
  const polygons: Ring[][] = [];
  for (const shift of [-360, 0, 360]) {
    const shifted = ring.map(([x, y]): [number, number] => [x + shift, y]);
    const clipped = clipToBand(shifted, -180, 180);
    if (clipped.length >= 4) polygons.push([clipped]);
  }
  return polygons;
}

// Sutherland–Hodgman against the (convex) band minX <= x <= maxX.
function clipToBand(ring: Ring, minX: number, maxX: number): Ring {
  let pts = ring.slice(0, -1);
  pts = clipEdge(pts, (p) => p[0] >= minX, minX);
  pts = clipEdge(pts, (p) => p[0] <= maxX, maxX);
  if (pts.length < 3) return [];
  return [...pts, pts[0]];
}

function clipEdge(
  pts: Ring,
  inside: (p: [number, number]) => boolean,
  x: number,
): Ring {
  const out: Ring = [];
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const prev = pts[(i + pts.length - 1) % pts.length];
    if (inside(cur)) {
      if (!inside(prev)) out.push(intersectX(prev, cur, x));
      out.push(cur);
    } else if (inside(prev)) {
      out.push(intersectX(prev, cur, x));
    }
  }
  return out;
}

function intersectX(
  a: [number, number],
  b: [number, number],
  x: number,
): [number, number] {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}
