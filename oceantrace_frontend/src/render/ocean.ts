/**
 * OCEANTRACE — Ocean background (PLAN §5): vertical gradient, horizon ~18% top
 * (2.5D/3D), animated sine wave highlights, foam specks; 3D adds a cloud layer.
 * Everything animates on the real clock so the scene stays alive even when paused.
 */
import { Camera, COMPRESSION } from './camera';

let foamSeeds: Float64Array | null = null;

function hash01(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function drawOcean(ctx: CanvasRenderingContext2D, cam: Camera, now: number): void {
  const { w, h } = cam;
  const isFlat = cam.mode === '2d';
  const horizonY = isFlat ? 0 : Math.round(h * 0.16);

  // sky band (2.5D / 3D)
  if (!isFlat) {
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, '#060a18');
    sky.addColorStop(0.7, '#0a1630');
    sky.addColorStop(1, '#10233f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizonY);
    // horizon glow
    const glow = ctx.createLinearGradient(0, horizonY - 14, 0, horizonY + 10);
    glow.addColorStop(0, 'rgba(0,191,255,0)');
    glow.addColorStop(0.55, 'rgba(0,191,255,0.28)');
    glow.addColorStop(1, 'rgba(0,191,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizonY - 14, w, 24);
  }

  // ocean body
  const sea = ctx.createLinearGradient(0, horizonY, 0, h);
  if (isFlat) {
    sea.addColorStop(0, '#0a2745');
    sea.addColorStop(0.5, '#082038');
    sea.addColorStop(1, '#051527');
  } else {
    sea.addColorStop(0, '#123a5e');
    sea.addColorStop(0.35, '#0c2c4c');
    sea.addColorStop(1, '#051527');
  }
  ctx.fillStyle = sea;
  ctx.fillRect(0, horizonY, w, h - horizonY);

  // animated sine wave highlights (denser/brighter toward the viewer)
  const t = now * 0.001;
  ctx.lineWidth = 1.4;
  const bands = 22;
  for (let b = 0; b < bands; b++) {
    const f = b / (bands - 1);
    const yBase = horizonY + Math.pow(f, 1.35) * (h - horizonY) + 6;
    const amp = 2 + f * 7;
    const speed = 0.35 + f * 0.9;
    const phase = t * speed + b * 1.7;
    const alpha = 0.03 + f * 0.075;
    ctx.strokeStyle = `rgba(120, 210, 255, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    for (let x = -10; x <= w + 10; x += 26) {
      const y = yBase + Math.sin(x * 0.012 + phase) * amp + Math.sin(x * 0.031 - phase * 1.4) * amp * 0.35;
      if (x === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // foam specks (deterministic hash + slow drift)
  if (!foamSeeds) {
    foamSeeds = new Float64Array(240 * 3);
    for (let i = 0; i < 240; i++) {
      foamSeeds[i * 3] = hash01(i * 3 + 1);
      foamSeeds[i * 3 + 1] = hash01(i * 3 + 2);
      foamSeeds[i * 3 + 2] = 0.4 + hash01(i * 3 + 3) * 0.9;
    }
  }
  for (let i = 0; i < 240; i++) {
    const fx = foamSeeds[i * 3], fy = foamSeeds[i * 3 + 1], fs = foamSeeds[i * 3 + 2];
    const depth = Math.pow(fy, 1.4);
    const y = horizonY + 8 + depth * (h - horizonY - 12);
    const x = ((fx * w + t * 4 * fs) % (w + 20)) - 10;
    const a = 0.02 + depth * 0.08 * (0.6 + 0.4 * Math.sin(t * fs * 2 + i));
    ctx.fillStyle = `rgba(220, 245, 255, ${Math.max(0, a).toFixed(3)})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }

  // 3D cloud layer near the horizon
  if (cam.mode === '3d') {
    for (let c = 0; c < 7; c++) {
      const cx = ((hash01(c * 7 + 11) * w * 1.4 - w * 0.2) + t * (2 + c * 0.35)) % (w + 260) - 130;
      const cy = horizonY * (0.35 + hash01(c * 7 + 13) * 0.5);
      const cw = 90 + hash01(c * 7 + 17) * 160;
      const ch = 12 + hash01(c * 7 + 19) * 16;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cw / 2);
      g.addColorStop(0, 'rgba(210, 230, 255, 0.085)');
      g.addColorStop(1, 'rgba(210, 230, 255, 0)');
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ch / (cw / 2));
      ctx.beginPath();
      ctx.arc(0, 0, cw / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 2.5D/3D horizon fade over the top of the ocean (PLAN: horizon fade)
  if (!isFlat) {
    const fade = ctx.createLinearGradient(0, horizonY, 0, horizonY + (h - horizonY) * 0.3);
    fade.addColorStop(0, 'rgba(4, 10, 22, 0.5)');
    fade.addColorStop(1, 'rgba(4, 10, 22, 0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, horizonY, w, (h - horizonY) * 0.3);
  }

  void COMPRESSION;
}
