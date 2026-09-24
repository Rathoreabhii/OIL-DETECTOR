/** FastAPI case_001. Numbers for the panel come from here, not scoring.ts. */

export const API_CASE_ID = 'case_001';

export type LL = [number, number];

export interface CaseEnv {
  wind: { speed_ms: number; toward_deg: number };
  current: { speed_ms: number; toward_deg: number };
}

export interface CaseVessel {
  rank?: number;
  score?: number;
  mmsi?: string;
  name?: string;
  type?: string;
  heading_deg?: number;
  cpa_to_origin_km?: number;
  ais_gap?: { start?: string; end?: string; duration_min?: number };
  reasons?: string[];
  track?: { t?: string; t_hours?: number; lat: number; lon: number }[];
}

export interface CaseJson {
  id?: string;
  title?: string;
  observed_at?: string;
  sar?: { bounds?: [[number, number], [number, number]]; image_url?: string; note?: string };
  environment?: CaseEnv;
  slick?: {
    polygon?: LL[];
    centroid?: { lat: number; lon: number } | LL;
    area_km2?: number;
    source?: string;
    confidence?: number;
    age_hours_est?: number;
    note?: string;
  };
  drift?: {
    hindcast?: { t_hours: number; lat: number; lon: number }[];
    forecast?: { t_hours: number; lat: number; lon: number }[];
    method?: string;
  };
  vessels?: CaseVessel[];
  scoring?: { note?: string; source?: string };
  pipeline?: { detect?: boolean };
}

function unwrap(payload: unknown): CaseJson {
  if (!payload || typeof payload !== 'object') throw new Error('empty case');
  const p = payload as Record<string, unknown>;
  if (p.slick || p.vessels) return p as CaseJson;
  if (p.case && typeof p.case === 'object') return p.case as CaseJson;
  throw new Error('empty case');
}

export const API_DOWN =
  'Backend is not running. Open another Command Prompt and run:\npython -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000';

export async function fetchCase(id = API_CASE_ID): Promise<CaseJson> {
  const urls = [
    `/api/cases/${encodeURIComponent(id)}`,
    `/local-demo/${id}.json`,
    `/${id}.json`
  ];
  let lastErr = API_DOWN;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) { lastErr = `API ${res.status} from ${url}`; continue; }
      const data = unwrap(await res.json());
      if (data.sar && !url.startsWith('/api')) {
        data.sar.image_url = '/sar_preview.png';
      }
      return data;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : API_DOWN;
    }
  }
  throw new Error(lastErr);
}

export async function analyzeCase(id: string, env: CaseEnv): Promise<CaseJson> {
  const body = new FormData();
  body.set('wind_speed', String(env.wind.speed_ms));
  body.set('wind_toward', String(env.wind.toward_deg));
  body.set('current_speed', String(env.current.speed_ms));
  body.set('current_toward', String(env.current.toward_deg));
  const res = await fetch(`/api/cases/${encodeURIComponent(id)}/analyze`, { method: 'POST', body });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t.slice(0, 200) || `analyze HTTP ${res.status}`);
  }
  return unwrap(await res.json());
}

export async function investigateUpload(fd: FormData): Promise<CaseJson> {
  const res = await fetch('/api/investigate', { method: 'POST', body: fd });
  if (!res.ok) {
    const t = await res.text();
    let detail = t.slice(0, 280);
    try {
      const j = JSON.parse(t) as { detail?: unknown };
      if (typeof j.detail === 'string') detail = j.detail;
    } catch { /* keep raw */ }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return unwrap(await res.json());
}

export function centroidOf(slick: CaseJson['slick']): { lat: number; lon: number } | null {
  if (!slick) return null;
  const c = slick.centroid;
  if (Array.isArray(c) && c.length >= 2) return { lat: c[0], lon: c[1] };
  if (c && typeof c === 'object' && 'lat' in c) return { lat: Number(c.lat), lon: Number(c.lon) };
  const poly = slick.polygon;
  if (!poly?.length) return null;
  const lat = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const lon = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return { lat, lon };
}

export function originOf(drift: CaseJson['drift'], fallback: { lat: number; lon: number }): { lat: number; lon: number } {
  const hind = drift?.hindcast;
  if (!hind?.length) return fallback;
  let best = hind[0];
  for (const p of hind) {
    if (typeof p.t_hours === 'number' && p.t_hours < (best.t_hours ?? 0)) best = p;
  }
  return { lat: best.lat, lon: best.lon };
}
