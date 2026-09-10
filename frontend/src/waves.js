/**
 * Canvas Gerstner-style 2D water for the Sea tab.
 * Visualization only — not Tessendorf FFT, not SAR, not NTRO operational.
 * The 3D FFT ocean at repo-root src/ stays frozen.
 *
 * Current sets swell direction (water). Wind adds short chop.
 * These waves do not advect oil; leeway stays current + 0.03*wind in drift.py.
 *
 * toward_deg: 0 = east, 90 = south (canvas +x / +y).
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function dirUnit(towardDeg) {
  const rad = (num(towardDeg) * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

function envParts(env) {
  const wind = env?.wind ?? {};
  const current = env?.current ?? {};
  const windSpeed = Math.max(0, num(wind.speed_ms, 6));
  const curSpeed = Math.max(0, num(current.speed_ms, 0.35));
  const swellToward = num(current.toward_deg, 72);
  const chopToward = num(wind.toward_deg, swellToward);
  return { windSpeed, curSpeed, swellToward, chopToward };
}

function components(env) {
  const { windSpeed, curSpeed, swellToward, chopToward } = envParts(env);
  const swell = dirUnit(swellToward);
  const chop = dirUnit(chopToward);
  const swellAmp = 3.2 + Math.min(4.5, curSpeed * 6);
  const chopAmp = 1.1 + Math.min(3.2, windSpeed * 0.28);
  return [
    { amp: swellAmp, k: 0.012, omega: 0.55, dir: swell, foam: true },
    { amp: swellAmp * 0.55, k: 0.019, omega: 0.82, dir: swell, foam: true },
    { amp: swellAmp * 0.32, k: 0.027, omega: 1.15, dir: dirUnit(swellToward + 18), foam: false },
    { amp: chopAmp, k: 0.048, omega: 1.85, dir: chop, foam: false },
    { amp: chopAmp * 0.55, k: 0.07, omega: 2.4, dir: dirUnit(chopToward - 22), foam: false },
  ];
}

function phase(c, x, y, t) {
  return c.k * (x * c.dir.x + y * c.dir.y) - c.omega * t;
}

function sampleEta(waves, x, y, t, freeze) {
  const tt = freeze ? 0 : t;
  let eta = 0;
  for (const c of waves) eta += c.amp * Math.cos(phase(c, x, y, tt));
  return eta;
}

function sampleSlope(waves, x, y, t, freeze) {
  const tt = freeze ? 0 : t;
  let dx = 0;
  let dy = 0;
  for (const c of waves) {
    const s = Math.sin(phase(c, x, y, tt));
    dx += -c.amp * c.k * c.dir.x * s;
    dy += -c.amp * c.k * c.dir.y * s;
  }
  return { dx, dy };
}

export function waveOffsetPx(x, y, tSeconds, freeze, env) {
  if (freeze) return { x: 0, y: 0 };
  const waves = components(env);
  const eta = sampleEta(waves, x, y, tSeconds, freeze);
  const { dx, dy } = sampleSlope(waves, x, y, tSeconds, freeze);
  return {
    x: Math.max(-4, Math.min(4, dx * 6)),
    y: Math.max(-4, Math.min(4, eta * 0.35 + dy * 4)),
  };
}

export function drawWater(ctx, w, h, tSeconds, freeze, env) {
  if (!ctx || !(w > 0) || !(h > 0)) return;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#12344c");
  g.addColorStop(0.42, "#0e2a3e");
  g.addColorStop(1, "#08141e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const waves = components(env);
  const t = freeze ? 0 : tSeconds;
  const rows = 18;
  ctx.save();
  ctx.lineWidth = 1.5;
  for (let i = 0; i < rows; i += 1) {
    const y0 = ((i + 0.5) / rows) * h;
    ctx.beginPath();
    ctx.globalAlpha = 0.18 + (i % 3) * 0.04;
    ctx.strokeStyle = i % 2 ? "#1d5570" : "#184860";
    const step = 16;
    for (let x = 0; x <= w; x += step) {
      const y = y0 + sampleEta(waves, x, y0, t, freeze);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = freeze ? 0.05 : 0.08;
  ctx.fillStyle = "#9ec8dc";
  const seed = freeze ? 4 : Math.floor(tSeconds * 1.6);
  for (let i = 0; i < 36; i += 1) {
    const n = ((i * 97 + seed * 13) % 1000) / 1000;
    const n2 = ((i * 53 + seed * 7) % 1000) / 1000;
    ctx.fillRect(n * w, n2 * h, 1.2, 1.2);
  }
  ctx.restore();
}

export function drawVideoChop(ctx, w, h, tSeconds, freeze, env) {
  if (freeze || !ctx || !(w > 0) || !(h > 0)) return;
  const waves = components(env);
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.11;
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = "#c8dde8";
  const rows = 10;
  const step = 28;
  for (let i = 0; i < rows; i += 1) {
    const y0 = ((i + 0.4) / rows) * h;
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) {
      const y = y0 + sampleEta(waves, x, y0, tSeconds, false) * 0.45;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
