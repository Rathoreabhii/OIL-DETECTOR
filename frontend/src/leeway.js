/** Same leeway as backend/drift.py. Visualization / slider only. */

export const WIND_FACTOR = 0.03;
export const KM_PER_DEG_LAT = 111.32;

export function leewayEN(env) {
  const wind = env?.wind ?? {};
  const current = env?.current ?? {};
  const wSpeed = Number(wind.speed_ms) || 0;
  const cSpeed = Number(current.speed_ms) || 0;
  const wRad = ((Number(wind.toward_deg) || 0) * Math.PI) / 180;
  const cRad = ((Number(current.toward_deg) || 0) * Math.PI) / 180;
  const east = cSpeed * Math.cos(cRad) + wSpeed * WIND_FACTOR * Math.cos(wRad);
  const north = -cSpeed * Math.sin(cRad) - wSpeed * WIND_FACTOR * Math.sin(wRad);
  return { east, north };
}

export function stepLatLon(lat, lon, veMs, vnMs, hours) {
  const eastKm = veMs * hours * 3.6;
  const northKm = vnMs * hours * 3.6;
  const dlat = northKm / KM_PER_DEG_LAT;
  const kmLon = KM_PER_DEG_LAT * Math.cos((Number(lat) * Math.PI) / 180);
  const dlon = Math.abs(kmLon) < 1e-9 ? 0 : eastKm / kmLon;
  return { lat: Number(lat) + dlat, lon: Number(lon) + dlon };
}

function asLatLon(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw) && raw.length >= 2) {
    const lat = Number(raw[0]);
    const lon = Number(raw[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export function shiftLatLon(ll, env, hours) {
  const p = asLatLon(ll);
  if (!p) return null;
  const { east, north } = leewayEN(env);
  return stepLatLon(p.lat, p.lon, east, north, hours);
}

export function shiftPolygon(poly, env, hours) {
  if (!Array.isArray(poly)) return [];
  return poly.map((pt) => {
    const next = shiftLatLon(pt, env, hours);
    return next ? [next.lat, next.lon] : null;
  }).filter(Boolean);
}

function trackPoints(vessel) {
  const track = Array.isArray(vessel?.track) ? vessel.track : [];
  return track
    .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
    .slice()
    .sort((a, b) => String(a.t ?? "").localeCompare(String(b.t ?? "")));
}

function deadReckon(lat, lon, sogKn, cogDeg, hours) {
  const ms = (Number(sogKn) || 0) * 0.514444;
  const rad = ((Number(cogDeg) || 0) * Math.PI) / 180;
  const east = ms * Math.sin(rad);
  const north = ms * Math.cos(rad);
  return stepLatLon(lat, lon, east, north, hours);
}

export function vesselAtTime(vessel, tHours, observedAt) {
  const pts = trackPoints(vessel);
  const t = Number(tHours) || 0;
  if (pts.length && observedAt) {
    const originMs = Date.parse(observedAt);
    if (Number.isFinite(originMs)) {
      const target = originMs + t * 3600 * 1000;
      const times = pts.map((p) => Date.parse(p.t));
      const first = times.findIndex(Number.isFinite);
      if (first >= 0) {
        if (target <= times[0]) {
          return { lat: Number(pts[0].lat), lon: Number(pts[0].lon), cog: pts[0].cog };
        }
        const lastI = times.length - 1;
        if (target >= times[lastI]) {
          const extraH = (target - times[lastI]) / 3600000;
          const last = pts[lastI];
          const ll = deadReckon(last.lat, last.lon, last.sog, last.cog ?? vessel.heading_deg, extraH);
          return { ...ll, cog: last.cog ?? vessel.heading_deg };
        }
        for (let i = 1; i < pts.length; i += 1) {
          if (target <= times[i]) {
            const a = pts[i - 1];
            const b = pts[i];
            const span = times[i] - times[i - 1] || 1;
            const f = (target - times[i - 1]) / span;
            return {
              lat: Number(a.lat) + (Number(b.lat) - Number(a.lat)) * f,
              lon: Number(a.lon) + (Number(b.lon) - Number(a.lon)) * f,
              cog: b.cog ?? a.cog ?? vessel.heading_deg,
            };
          }
        }
      }
    }
  }
  const last = pts[pts.length - 1];
  if (!last) return null;
  const ll = deadReckon(last.lat, last.lon, last.sog, last.cog ?? vessel.heading_deg, t);
  return { ...ll, cog: last.cog ?? vessel.heading_deg };
}
