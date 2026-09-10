import { drawWater } from "./waves.js";
import { bindVideo, playVideo, pauseVideo, watchVideo } from "./sea-media.js";
import { getTHours, setTHours, onTHours } from "./time.js";
import { createSea3d } from "./sea-3d.js";

/**
 * Close-up Sea stage. Same ships as the Map case, not map scale.
 * No drift lines. Click a ship to leak. Time slider moves ships and grows oil.
 * Decorative water is not SAR.
 */

const RANK_COLORS = ["#d7b06a", "#c4a06a", "#9a8d74", "#7d8694", "#6a7380", "#585f6c"];
const WIND_FACTOR = 0.03;
const PX_PER_HOUR = 11;
const SPREAD_PER_HOUR = 5.5;
const HULL = {
  oil_tanker: { len: 210, beam: 52, kind: "tanker" },
  product_tanker: { len: 184, beam: 48, kind: "tanker" },
  chemical_tanker: { len: 176, beam: 46, kind: "tanker" },
  cargo: { len: 164, beam: 46, kind: "cargo" },
  passenger: { len: 156, beam: 44, kind: "passenger" },
  fishing: { len: 100, beam: 32, kind: "fishing" },
  other: { len: 118, beam: 36, kind: "work" },
};

function rankColor(rank) {
  const i = Math.max(1, Number(rank) || 1) - 1;
  return RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)];
}

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function towardXY(speedMs, towardDeg) {
  const rad = (Number(towardDeg) || 0) * (Math.PI / 180);
  const speed = Number(speedMs) || 0;
  return { x: speed * Math.cos(rad), y: speed * Math.sin(rad) };
}

function leewayXY(env) {
  const wind = env?.wind ?? {};
  const current = env?.current ?? {};
  const w = towardXY(Number(wind.speed_ms) * WIND_FACTOR, wind.toward_deg);
  const c = towardXY(current.speed_ms, current.toward_deg);
  return { x: c.x + w.x, y: c.y + w.y };
}

function headingRad(deg) {
  return ((Number.isFinite(deg) ? deg : 90) - 90) * (Math.PI / 180);
}

function vesselName(v, i) {
  return String(v?.name || v?.vessel_name || `Ship ${i + 1}`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function paintShipSide(row, leaking, hours, env) {
  const el = document.getElementById("sea-side");
  if (!el) return;
  if (!row) {
    el.innerHTML = `
      <header class="case-head">
        <h2>Ship</h2>
        <p>Touch a hull. Rank, type, score, and leak state show here.</p>
      </header>
    `;
    return;
  }
  const v = row.vessel;
  const reasons = Array.isArray(v.reasons) ? v.reasons.filter(Boolean) : [];
  const wind = env?.wind ?? {};
  const current = env?.current ?? {};
  const reasonList = reasons.length
    ? `<ul class="reason-list">${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
    : `<p class="empty">No rank reasons on this vessel.</p>`;
  el.innerHTML = `
    <header class="case-head">
      <h2>${escapeHtml(vesselName(v, row.i))}</h2>
      <p>Rank ${escapeHtml(v.rank ?? row.i + 1)} · ${escapeHtml(String(v.type || "other").replace(/_/g, " "))}</p>
    </header>
    <section class="block">
      <h2>Score</h2>
      <p class="meta">${v.score != null ? Number(v.score).toFixed(3) : "—"} · MMSI ${escapeHtml(v.mmsi || "—")}</p>
    </section>
    <section class="block">
      <h2>Leak</h2>
      <p class="meta">${leaking ? `Leaking · oil age ${Math.abs(hours).toFixed(1)} h at current + 0.03×wind` : "Not leaking. Touch the hull to start."}</p>
    </section>
    <section class="block">
      <h2>Environment (same as Map)</h2>
      <p class="meta">Wind ${escapeHtml(wind.speed_ms ?? "—")} m/s toward ${escapeHtml(wind.toward_deg ?? "—")}° · current ${escapeHtml(current.speed_ms ?? "—")} m/s toward ${escapeHtml(current.toward_deg ?? "—")}°</p>
    </section>
    <section class="block reasons">
      <h2>Why this rank</h2>
      ${reasonList}
    </section>
  `;
}

function latestFix(vessel) {
  const track = Array.isArray(vessel?.track) ? vessel.track : [];
  const pts = track.filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)));
  pts.sort((a, b) => String(a.t ?? "").localeCompare(String(b.t ?? "")));
  return pts.length ? pts[pts.length - 1] : null;
}

function hullSpec(type) {
  return HULL[String(type || "other")] || HULL.other;
}

function clusterLayout(n, w, h) {
  const slots = [];
  const cols = Math.min(3, Math.max(1, n));
  const rows = Math.ceil(n / cols);
  const gapX = 240;
  const gapY = 170;
  const ox = w * 0.5 - ((cols - 1) * gapX) / 2;
  const oy = h * 0.52 - ((rows - 1) * gapY) / 2;
  for (let i = 0; i < n; i += 1) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const jitter = ((i * 37) % 9) - 4;
    slots.push({
      x: ox + c * gapX + (r % 2 ? 18 : 0) + jitter,
      y: oy + r * gapY + ((i * 19) % 7) - 3,
    });
  }
  return slots;
}

function shipPose(vessel, i, slot, hours, cx, cy) {
  const fix = latestFix(vessel);
  const heading = Number(fix?.cog ?? vessel.heading_deg);
  const sog = Number(fix?.sog);
  const knots = Number.isFinite(sog) ? Math.max(0.4, Math.min(16, sog)) : 8;
  const rad = headingRad(heading);
  const ahead = hours * PX_PER_HOUR * (0.45 + knots / 28);
  const dx = Math.cos(rad) * ahead;
  const dy = Math.sin(rad) * ahead;
  const fromC = { x: slot.x - cx, y: slot.y - cy };
  const dist = Math.hypot(fromC.x, fromC.y) || 1;
  const spread = hours * SPREAD_PER_HOUR;
  return {
    x: slot.x + dx + (fromC.x / dist) * spread,
    y: slot.y + dy + (fromC.y / dist) * spread,
    heading,
    rad,
    spec: hullSpec(vessel.type),
  };
}

function blobPath(ctx, x, y, major, minor, angle, t, freeze) {
  ctx.beginPath();
  const n = 26;
  for (let i = 0; i <= n; i += 1) {
    const th = (i / n) * Math.PI * 2;
    const wobble = freeze ? 1 : 1 + 0.08 * Math.sin(th * 3 + t * 0.35) + 0.04 * Math.sin(th * 5 - t * 0.22);
    const rx = major * Math.cos(th) * wobble;
    const ry = minor * Math.sin(th) * wobble;
    const px = x + rx * Math.cos(angle) - ry * Math.sin(angle);
    const py = y + rx * Math.sin(angle) + ry * Math.cos(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawOil(ctx, x, y, hours, drift, t, freeze) {
  const age = Math.max(0, hours);
  if (age <= 0.02) return;
  const speed = Math.hypot(drift.x, drift.y);
  const angle = Math.atan2(drift.y, drift.x);
  const shift = age * (16 + speed * 48);
  const ox = speed ? x + (drift.x / speed) * shift : x;
  const oy = speed ? y + (drift.y / speed) * shift : y;
  const major = 28 + age * 22;
  const minor = 14 + age * 9;
  blobPath(ctx, ox, oy, major, minor, angle, t, freeze);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(12, 7, 4, 0.72)";
  ctx.fill();
  ctx.fillStyle = "rgba(6, 3, 2, 0.4)";
  ctx.fill();
  ctx.restore();
}

function roundHull(ctx, len, beam) {
  const half = len / 2;
  const r = beam * 0.45;
  ctx.beginPath();
  ctx.moveTo(-half + r, -beam / 2);
  ctx.lineTo(half - beam * 0.85, -beam / 2);
  ctx.quadraticCurveTo(half + 4, 0, half - beam * 0.85, beam / 2);
  ctx.lineTo(-half + r, beam / 2);
  ctx.quadraticCurveTo(-half - 2, 0, -half + r, -beam / 2);
  ctx.closePath();
}

function drawShipBody(ctx, spec, color, leaking) {
  const { len, beam, kind } = spec;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  roundHull(ctx, len, beam);
  const hull = ctx.createLinearGradient(0, -beam, 0, beam);
  hull.addColorStop(0, "#c9c2b4");
  hull.addColorStop(0.35, color);
  hull.addColorStop(1, "#2a241c");
  ctx.fillStyle = hull;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = leaking ? "rgba(236, 231, 220, 0.85)" : "rgba(16, 18, 22, 0.55)";
  ctx.lineWidth = leaking ? 1.6 : 1;
  ctx.stroke();

  ctx.fillStyle = "rgba(236, 231, 220, 0.35)";
  ctx.fillRect(-len * 0.28, -beam * 0.18, len * 0.5, beam * 0.12);

  if (kind === "tanker") {
    ctx.fillStyle = "#d8d2c6";
    ctx.fillRect(-len * 0.42, -beam * 0.28, len * 0.22, beam * 0.56);
    ctx.fillStyle = "#5a4030";
    ctx.fillRect(-len * 0.36, -beam * 0.42, 7, beam * 0.22);
  } else if (kind === "cargo") {
    ctx.fillStyle = "#8a8174";
    ctx.fillRect(-len * 0.12, -beam * 0.32, len * 0.28, beam * 0.64);
    ctx.fillStyle = "#d8d2c6";
    ctx.fillRect(-len * 0.42, -beam * 0.24, len * 0.16, beam * 0.48);
  } else if (kind === "passenger") {
    ctx.fillStyle = "#ece7dc";
    ctx.fillRect(-len * 0.22, -beam * 0.36, len * 0.4, beam * 0.4);
    ctx.fillStyle = "#2c333d";
    for (let i = 0; i < 5; i += 1) ctx.fillRect(-len * 0.16 + i * 7, -beam * 0.22, 4, 4);
  } else if (kind === "fishing") {
    ctx.fillStyle = "#ece7dc";
    ctx.fillRect(len * 0.02, -beam * 0.36, len * 0.22, beam * 0.5);
    ctx.fillStyle = "#c4a36a";
    ctx.beginPath();
    ctx.moveTo(-4, -beam * 0.2);
    ctx.lineTo(len * 0.12, -beam * 0.7);
    ctx.lineTo(8, -beam * 0.2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#d8d2c6";
    ctx.fillRect(-len * 0.18, -beam * 0.28, len * 0.2, beam * 0.56);
  }
  ctx.restore();
}

function drawShip(ctx, pose, vessel, i, leaking, hover, t, freeze) {
  const seed = i * 1.7;
  const wobble = freeze ? 0 : Math.sin(t * 1.35 + seed) * 0.04;
  const bob = freeze ? 0 : Math.sin(t * 1.05 + seed * 1.3) * 1.8;
  ctx.save();
  ctx.translate(pose.x, pose.y + bob);
  ctx.rotate(pose.rad + wobble);
  if (leaking) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#c4a36a";
    ctx.beginPath();
    ctx.ellipse(0, 0, pose.spec.len * 0.58, pose.spec.beam * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  drawShipBody(ctx, pose.spec, rankColor(vessel.rank ?? i + 1), leaking || hover);
  ctx.restore();

  const label = `${vessel.rank ?? i + 1}`;
  ctx.font = '650 12px "Segoe UI", "Helvetica Neue", ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(8, 12, 16, 0.85)";
  ctx.fillStyle = "#ece7dc";
  ctx.strokeText(label, pose.x + 10, pose.y - pose.spec.beam * 0.7);
  ctx.fillText(label, pose.x + 10, pose.y - pose.spec.beam * 0.7);
}

function hitShip(px, py, pose) {
  const dx = px - pose.x;
  const dy = py - pose.y;
  const c = Math.cos(-pose.rad);
  const s = Math.sin(-pose.rad);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) < pose.spec.len * 0.55 && Math.abs(ly) < pose.spec.beam * 0.85;
}

export function createSea(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  const view = canvas.closest(".sea-view") || canvas.parentElement;
  const videoEl = document.getElementById("sea-video");
  const timeEl = document.getElementById("sea-time");
  const timeVal = document.getElementById("sea-time-val");
  const glCanvas = document.getElementById("sea-gl");
  const ships3d = glCanvas ? createSea3d(glCanvas) : null;
  let caseData = null;
  let cssW = 0;
  let cssH = 0;
  let rafId = 0;
  let running = false;
  let originMs = 0;
  let pauseAccum = 0;
  let pausedAt = 0;
  let caseId = null;
  let videoLive = true;
  let observer = null;
  let unwatch = null;
  let leaking = new Set();
  let hoverKey = null;
  let selectedKey = null;
  let poses = [];

  function hoursNow() {
    return getTHours();
  }

  function syncTimeUi() {
    if (timeEl) timeEl.value = String(hoursNow());
    if (timeVal) timeVal.textContent = `${hoursNow().toFixed(1)} h`;
  }

  function setWavesFallback(on) {
    videoLive = !on;
    view?.classList.toggle("is-waves", on);
  }

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const parent = canvas.parentElement;
    const w = Math.max(1, canvas.clientWidth || parent?.clientWidth || 0);
    const h = Math.max(1, canvas.clientHeight || parent?.clientHeight || 0);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cssW = w;
    cssH = h;
    return w > 1 && h > 1;
  }

  function animTime() {
    const now = performance.now();
    if (pausedAt) return pausedAt - originMs - pauseAccum;
    return now - originMs - pauseAccum;
  }

  function layoutShips(data, w, h, hours) {
    const vessels = Array.isArray(data?.vessels) ? data.vessels : [];
    const slots = clusterLayout(vessels.length, w, h);
    const cx = w * 0.5;
    const cy = h * 0.52;
    return vessels.map((vessel, i) => {
      const pose = shipPose(vessel, i, slots[i] || { x: cx, y: cy }, hours, cx, cy);
      const key = String(vessel.mmsi || vessel.name || i);
      return { vessel, i, pose, key };
    });
  }

  function paint(now) {
    if (!size()) return;
    const freeze = reducedMotion();
    const elapsed = Math.max(0, (now ?? animTime()) / 1000);
    const w = cssW;
    const h = cssH;
    const hours = hoursNow();
    const showVideo = videoLive && videoEl && !videoEl.error;

    ctx.clearRect(0, 0, w, h);
    if (!showVideo) drawWater(ctx, w, h, elapsed, freeze, caseData?.environment);

    if (!caseData) {
      poses = [];
      paintShipSide(null, false, 0, null);
      return;
    }

    const drift = leewayXY(caseData.environment);
    poses = layoutShips(caseData, w, h, hours);
    for (const row of poses) {
      if (!leaking.has(row.key)) continue;
      drawOil(ctx, row.pose.x, row.pose.y, Math.abs(hours), drift, elapsed, freeze);
    }
    const used3d = ships3d?.isReady()
      ? ships3d.sync(poses, leaking, hoverKey, elapsed, freeze)
      : false;
    for (const row of poses) {
      if (used3d) {
        const label = `${row.vessel.rank ?? row.i + 1}`;
        ctx.font = '650 12px "Segoe UI", "Helvetica Neue", ui-sans-serif, system-ui, sans-serif';
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(8, 12, 16, 0.85)";
        ctx.fillStyle = "#ece7dc";
        ctx.strokeText(label, row.pose.x + 10, row.pose.y - 18);
        ctx.fillText(label, row.pose.x + 10, row.pose.y - 18);
      } else {
        drawShip(
          ctx,
          row.pose,
          row.vessel,
          row.i,
          leaking.has(row.key),
          hoverKey === row.key,
          elapsed,
          freeze,
        );
      }
    }
    const selected = poses.find((row) => row.key === selectedKey) || null;
    paintShipSide(selected, selected ? leaking.has(selected.key) : false, hours, caseData.environment);
  }

  function loop() {
    rafId = 0;
    if (!running) return;
    paint();
    if (!reducedMotion() || videoLive) rafId = requestAnimationFrame(loop);
  }

  function playMedia() {
    if (videoEl && running && !document.hidden) playVideo(videoEl);
  }

  function pauseClock() {
    if (!pausedAt) pausedAt = performance.now();
    if (videoEl) pauseVideo(videoEl);
  }

  function resumeClock() {
    if (pausedAt) {
      pauseAccum += performance.now() - pausedAt;
      pausedAt = 0;
    }
    playMedia();
  }

  function start() {
    running = true;
    if (!originMs) originMs = performance.now();
    resumeClock();
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    pauseClock();
  }

  function eventPos(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function shipAt(x, y) {
    for (let i = poses.length - 1; i >= 0; i -= 1) {
      if (hitShip(x, y, poses[i].pose)) return poses[i];
    }
    return null;
  }

  function onPointerMove(ev) {
    const p = eventPos(ev);
    const hit = shipAt(p.x, p.y);
    const next = hit?.key ?? null;
    canvas.style.cursor = next ? "pointer" : "default";
    if (next !== hoverKey) {
      hoverKey = next;
      if (!running) paint();
    }
  }

  function onPointerDown(ev) {
    const p = eventPos(ev);
    const hit = shipAt(p.x, p.y);
    if (!hit) return;
    ev.preventDefault();
    leaking.add(hit.key);
    selectedKey = hit.key;
    paint();
  }

  function onTime() {
    setTHours(timeEl?.value);
  }

  function render(data) {
    const nextId = data?.id ?? null;
    if (nextId !== caseId) {
      caseId = nextId;
      originMs = performance.now();
      pauseAccum = 0;
      pausedAt = 0;
      leaking = new Set();
      selectedKey = null;
    }
    caseData = data && typeof data === "object" ? data : null;
    syncTimeUi();
    start();
    paint();
  }

  function onVis() {
    if (document.hidden) pauseClock();
    else if (running) {
      resumeClock();
      if (!rafId) rafId = requestAnimationFrame(loop);
    }
  }

  bindVideo(videoEl);
  setWavesFallback(false);
  unwatch = watchVideo(videoEl, {
    onReady() {
      setWavesFallback(false);
      playMedia();
      if (running) paint();
    },
    onError() {
      setWavesFallback(true);
      if (running) paint();
    },
  });

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  timeEl?.addEventListener("input", onTime);
  view?.addEventListener("click", playMedia);
  const unsubTime = onTHours(() => {
    syncTimeUi();
    if (running) paint();
  });

  observer = new ResizeObserver(() => {
    if (running) paint();
  });
  observer.observe(canvas);
  document.addEventListener("visibilitychange", onVis);
  ships3d?.loadPromise.then(() => {
    if (running) paint();
  });

  return {
    canvas,
    render,
    stop,
    resize() {
      paint();
    },
    destroy() {
      stop();
      unwatch?.();
      unwatch = null;
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      timeEl?.removeEventListener("input", onTime);
      view?.removeEventListener("click", playMedia);
      unsubTime?.();
      document.removeEventListener("visibilitychange", onVis);
      observer?.disconnect();
      observer = null;
      ships3d?.dispose();
    },
  };
}

let session = null;

function ensure() {
  const canvas = document.getElementById("sea-canvas");
  if (!canvas) return null;
  if (!session || session.canvas !== canvas) {
    session?.destroy?.();
    session = createSea(canvas);
  }
  return session;
}

export function render(caseData) {
  ensure()?.render(caseData);
}

export function stop() {
  session?.stop();
}

export function resize() {
  session?.resize();
}
