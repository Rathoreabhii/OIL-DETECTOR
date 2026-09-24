/** Esri World Imagery (OSM fallback). Public basemap — not Sentinel-1, not live SAR. */
import type { Camera } from './render/camera';
import { scale } from './render/camera';
import { emit } from './state';

const cache = new Map<string, HTMLImageElement>();

function lon2x(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}
function lat2y(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
function tileNWlon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}
function tileNWlat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function key(z: number, x: number, y: number): string {
  return `${z}/${y}/${x}`;
}

function loadTile(z: number, x: number, y: number): HTMLImageElement | null {
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) return null;
  const k = key(z, x, y);
  const hit = cache.get(k);
  if (hit) return hit.complete && hit.naturalWidth ? hit : null;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => emit('time');
  img.onerror = () => {
    img.onerror = null;
    img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  };
  img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  cache.set(k, img);
  return null;
}

function pickZ(lat0: number, metresPerPx: number, lonMin: number, latMin: number, lonMax: number, latMax: number): number {
  const cos = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
  let z = Math.round(Math.log2(156543.03392 * cos / Math.max(2, metresPerPx)));
  z = Math.min(15, Math.max(8, z));
  for (; z > 8; z--) {
    const x0 = Math.floor(lon2x(lonMin, z));
    const x1 = Math.floor(lon2x(lonMax, z));
    const y0 = Math.floor(lat2y(latMax, z));
    const y1 = Math.floor(lat2y(latMin, z));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 72) break;
  }
  return z;
}

export function drawSatelliteTiles(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  project: (cam: Camera, x: number, y: number) => { sx: number; sy: number },
  lonToX: (lon: number) => number,
  latToY: (lat: number) => number,
  lonMin: number,
  latMin: number,
  lonMax: number,
  latMax: number,
  lat0?: number
): void {
  const mpp = 1 / Math.max(1e-6, scale(cam));
  const z = pickZ(lat0 ?? (latMin + latMax) / 2, mpp, lonMin, latMin, lonMax, latMax);
  const x0 = Math.floor(lon2x(lonMin, z));
  const x1 = Math.floor(lon2x(lonMax, z));
  const y0 = Math.floor(lat2y(latMax, z));
  const y1 = Math.floor(lat2y(latMin, z));
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const im = loadTile(z, tx, ty);
      const west = tileNWlon(tx, z);
      const east = tileNWlon(tx + 1, z);
      const north = tileNWlat(ty, z);
      const south = tileNWlat(ty + 1, z);
      const a = project(cam, lonToX(west), latToY(north));
      const b = project(cam, lonToX(east), latToY(south));
      const w = b.sx - a.sx;
      const h = b.sy - a.sy;
      if (im) ctx.drawImage(im, a.sx, a.sy, w, h);
      else {
        ctx.fillStyle = '#0a2238';
        ctx.fillRect(a.sx, a.sy, w, h);
      }
    }
  }
  ctx.restore();
}
