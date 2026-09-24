/** Same leeway as backend/drift.py and frontend/src/leeway.js. */

export const WIND_FACTOR = 0.03;
export const KM_PER_DEG_LAT = 111.32;

/** toward_deg is navigation: 0 = north, 90 = east (same as AIS heading). */
export function towardEN(speedMs: number, towardDeg: number): { east: number; north: number } {
  const r = (towardDeg * Math.PI) / 180;
  return { east: speedMs * Math.sin(r), north: speedMs * Math.cos(r) };
}

export function leewayEN(env: {
  wind?: { speed_ms?: number; toward_deg?: number };
  current?: { speed_ms?: number; toward_deg?: number };
}): { east: number; north: number } {
  const w = towardEN(Number(env?.wind?.speed_ms) || 0, Number(env?.wind?.toward_deg) || 0);
  const c = towardEN(Number(env?.current?.speed_ms) || 0, Number(env?.current?.toward_deg) || 0);
  return {
    east: c.east + WIND_FACTOR * w.east,
    north: c.north + WIND_FACTOR * w.north,
  };
}

export function stepLatLon(
  lat: number, lon: number, veMs: number, vnMs: number, hours: number
): { lat: number; lon: number } {
  const eastKm = veMs * hours * 3.6;
  const northKm = vnMs * hours * 3.6;
  const dlat = northKm / KM_PER_DEG_LAT;
  const kmLon = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dlon = Math.abs(kmLon) < 1e-9 ? 0 : eastKm / kmLon;
  return { lat: lat + dlat, lon: lon + dlon };
}

export function shiftPolygon(
  poly: [number, number][] | undefined,
  env: Parameters<typeof leewayEN>[0] | undefined,
  hours: number
): [number, number][] {
  if (!poly?.length || !hours) return poly ? poly.map((p) => [p[0], p[1]] as [number, number]) : [];
  const { east, north } = leewayEN(env ?? {});
  return poly.map(([lat, lon]) => {
    const n = stepLatLon(lat, lon, east, north, hours);
    return [n.lat, n.lon] as [number, number];
  });
}
