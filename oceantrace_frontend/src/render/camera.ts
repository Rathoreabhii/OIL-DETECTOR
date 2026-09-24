/**
 * OCEANTRACE — Geo↔screen projection for 2D / 2.5D / 3D camera modes (PLAN §5).
 *
 * One project() per mode; overlays call it so every layer works in every mode.
 *   2D   : orthographic top-down (k = 1)
 *   2.5D : y-axis compression 0.62 + horizon fade (fade applied by ocean renderer)
 *   3D   : compression 0.45 + wave parallax offset (approximated per-point) + cloud layer
 * Wheel zoom + drag pan are supported; unproject() feeds the mini-map view bbox.
 */
import { getDomainM, getProjector } from '../geo';

export type CameraMode = '2d' | '2.5d' | '3d';

export const COMPRESSION: Record<CameraMode, number> = { '2d': 1, '2.5d': 0.62, '3d': 0.45 };

export interface Camera {
  mode: CameraMode;
  zoom: number;   // 1 = fit domain
  panX: number;   // px
  panY: number;   // px
  w: number;      // canvas CSS px
  h: number;
  /** animation clock for wave parallax (ms) */
  now: number;
}

export function domainWM(): number {
  const d = getDomainM();
  return Math.max(1000, d.xMax - d.xMin);
}
export function domainHM(): number {
  const d = getDomainM();
  return Math.max(1000, d.yMax - d.yMin);
}

export function makeCamera(w: number, h: number, mode: CameraMode): Camera {
  return { mode, zoom: 1, panX: 0, panY: 0, w, h, now: 0 };
}

/** Base scale (px per metre) fitting the domain with margin. */
export function baseScale(cam: Camera): number {
  return Math.min((cam.w - 56) / domainWM(), (cam.h - 64) / domainHM());
}

export function scale(cam: Camera): number {
  return baseScale(cam) * cam.zoom;
}

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 12;

/** Keep the world point under (sx, sy) fixed while changing zoom. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): void {
  const k = COMPRESSION[cam.mode];
  const s0 = scale(cam);
  const x = (sx - cam.w / 2 - cam.panX) / s0;
  const y = (cam.h / 2 + cam.panY - sy) / (s0 * k);
  cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom * factor));
  const s1 = scale(cam);
  cam.panX = sx - cam.w / 2 - x * s1;
  cam.panY = sy - cam.h / 2 + y * s1 * k;
}

/** Project model metres (x east, y north) → screen CSS px. */
export function project(cam: Camera, x: number, y: number): { sx: number; sy: number } {
  const s = scale(cam);
  const k = COMPRESSION[cam.mode];
  let sy = cam.h / 2 - y * s * k + cam.panY;
  if (cam.mode === '3d') {
    // subtle wave parallax: bands of the scene oscillate slightly, nearer = stronger
    const band = Math.max(0, (sy - cam.h * 0.3) / cam.h); // 0 at horizon → 1 near viewer
    sy += Math.sin(cam.now * 0.0009 + y * 0.00004) * 5 * band;
  }
  const sx = cam.w / 2 + x * s + cam.panX;
  return { sx, sy };
}

/** Screen px → model metres (parallax ignored — approximation for minimap bbox). */
export function unproject(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  const s = scale(cam);
  const k = COMPRESSION[cam.mode];
  return {
    x: (sx - cam.w / 2 - cam.panX) / s,
    y: (cam.h / 2 + cam.panY - sy) / (s * k)
  };
}

/** Visible geo bounds (for the mini-map view rectangle). */
export function viewBoundsLL(cam: Camera): { latMin: number; latMax: number; lonMin: number; lonMax: number } {
  const a = unproject(cam, 0, cam.h);
  const b = unproject(cam, cam.w, 0);
  const p = getProjector();
  if (p) {
    return {
      lonMin: p.xToLon(a.x), lonMax: p.xToLon(b.x),
      latMin: p.yToLat(a.y), latMax: p.yToLat(b.y),
    };
  }
  return { lonMin: 72 + a.x / (111.32 * Math.cos((12 * Math.PI) / 180) * 1000), lonMax: 72 + b.x / (111.32 * Math.cos((12 * Math.PI) / 180) * 1000), latMin: 12.5 + a.y / (111.32 * 1000), latMax: 12.5 + b.y / (111.32 * 1000) };
}

/** Clamp pan so the domain can't fly off-screen entirely. */
export function clampPan(cam: Camera): void {
  const s = scale(cam);
  const mx = (domainWM() * s) / 2 + cam.w * 0.45;
  const my = (domainHM() * s * COMPRESSION[cam.mode]) / 2 + cam.h * 0.45;
  cam.panX = Math.min(mx, Math.max(-mx, cam.panX));
  cam.panY = Math.min(my, Math.max(-my, cam.panY));
}
