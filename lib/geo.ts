// Privacy offset: move a real coordinate 1–3 km in a random direction so the
// dot is placed *near* the user, never at their exact location. Applied in the
// browser before joining, so the raw location never leaves the device. A
// fresh random offset is generated each session (this runs once per join), so
// the same user lands somewhere different every time.

const KM_PER_DEG_LAT = 111.32;

export function applyPrivacyOffset(
  lat: number,
  lng: number,
): { lat: number; lng: number } {
  const distanceKm = 1 + Math.random() * 2; // 1–3 km
  const bearing = Math.random() * 2 * Math.PI; // random direction

  const dLat = (distanceKm * Math.cos(bearing)) / KM_PER_DEG_LAT;
  const latRad = (lat * Math.PI) / 180;
  const dLng =
    (distanceKm * Math.sin(bearing)) /
    (KM_PER_DEG_LAT * Math.cos(latRad) || KM_PER_DEG_LAT);

  return {
    lat: clamp(lat + dLat, -90, 90),
    lng: wrapLng(lng + dLng),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function wrapLng(lng: number): number {
  // Keep longitude in [-180, 180].
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;

// Point `km` away from (lat, lng) on compass bearing `bearingDeg`.
export function destinationKm(
  lat: number,
  lng: number,
  km: number,
  bearingDeg: number,
): { lat: number; lng: number } {
  const d = km / EARTH_RADIUS_KM;
  const b = bearingDeg * RAD;
  const lat1 = lat * RAD;
  const lng1 = lng * RAD;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: lat2 / RAD, lng: wrapLng(lng2 / RAD) };
}

// Great-circle (haversine) distance in km.
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// "a few km away", "~40 km away", "~1,100 km away" — dots are offset by up
// to 3 km, so more precision would be false precision.
export function describeDistance(km: number): string {
  if (km < 10) return "a few km away";
  const step = km < 100 ? 5 : km < 1000 ? 10 : 100;
  const rounded = Math.round(km / step) * step;
  return `~${rounded.toLocaleString("en-US")} km away`;
}

// Closed GeoJSON ring (lng, lat) approximating a circle of `km` radius.
export function circleRingKm(
  lat: number,
  lng: number,
  km: number,
  steps = 64,
): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const p = destinationKm(lat, lng, km, (360 / steps) * i);
    ring.push([p.lng, p.lat]);
  }
  ring.push(ring[0]);
  return ring;
}
