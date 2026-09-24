/**
 * OCEANTRACE — Right analysis panel. Numbers come from the FastAPI case,
 * not scoring.ts: ranked vessels, slick.area_km2, caseOrigin(), drift.method.
 */
import { on } from '../state';
import { CaseEnv, CaseJson, CaseVessel } from '../api';
import { caseData, caseOrigin, rankedVessels } from '../caseView';
import { openCaseModal } from './modal';

const SCORE_WEIGHTS = '30% type + 30% proximity + 20% time + 10% heading + 10% AIS gap';

const CONF_FMT = (c: number): { cls: string; label: string } =>
  c >= 0.85 ? { cls: 'high', label: 'HIGH CONFIDENCE' } :
  c >= 0.6 ? { cls: 'moderate', label: 'Moderate Confidence' } :
  { cls: 'low', label: 'Low Confidence' };

const D = (ms: number): string => {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '—';
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${M[d.getUTCMonth()]} ${p(d.getUTCDate())}, ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
};

export function readEnvForm(): CaseEnv | null {
  const form = document.getElementById('caseEnvForm') as HTMLFormElement | null;
  if (!form) return null;
  const fd = new FormData(form);
  const speed_ms = Number(fd.get('wind_speed'));
  const toward_deg = Number(fd.get('wind_toward'));
  const cur_ms = Number(fd.get('current_speed'));
  const cur_deg = Number(fd.get('current_toward'));
  if (![speed_ms, toward_deg, cur_ms, cur_deg].every(Number.isFinite)) return null;
  return {
    wind: { speed_ms, toward_deg },
    current: { speed_ms: cur_ms, toward_deg: cur_deg }
  };
}

export function buildRightPanel(root: HTMLElement): void {
  root.innerHTML = `
    <div class="card" id="cardSummary">
      <div class="card-h"><span>Incident Summary</span><span class="sub" id="confBadge"></span></div>
      <div class="kv"><span class="k">Detected Spill Area</span><span class="v hl" id="sumArea">—</span></div>
      <div class="kv"><span class="k">Detect</span><span class="v" id="sumDetect">—</span></div>
      <div class="kv"><span class="k">Detection Confidence</span><span class="v" id="sumConf">—</span></div>
      <div class="kv"><span class="k">Detection Time</span><span class="v" id="sumTdet">—</span></div>
    </div>

    <div class="card" id="cardEnv">
      <div class="card-h"><span>Environment</span><span class="sub">leeway Form fields</span></div>
      <form id="caseEnvForm" class="env-form" autocomplete="off">
        <label>Wind m/s<input type="number" name="wind_speed" min="0" step="0.1" value="6.4" /></label>
        <label>Wind toward°<input type="number" name="wind_toward" step="1" value="65" /></label>
        <label>Current m/s<input type="number" name="current_speed" min="0" step="0.01" value="0.38" /></label>
        <label>Current toward°<input type="number" name="current_toward" step="1" value="72" /></label>
      </form>
    </div>

    <div class="card" id="cardSource">
      <div class="card-h"><span>Source Reconstruction</span><span class="sub">leeway origin</span></div>
      <div class="kv"><span class="k">Estimated Origin</span><span class="v hl" id="srcLL">—</span></div>
      <div class="kv"><span class="k">Drift method</span><span class="v" id="srcMethod">—</span></div>
    </div>

    <div class="card" id="cardTop">
      <div class="card-h"><span>Top Candidate</span><span class="sub" id="topSub">ranked #1</span></div>
      <div class="vessel-photo">
        <svg width="120" height="40" viewBox="0 0 120 40" id="topSil"><path d="M8 30 L20 12 L96 12 L112 22 L112 30 Z" fill="#16406b" stroke="#2f6ea3"/><rect x="40" y="4" width="18" height="8" fill="#0f2c4c" stroke="#2f6ea3"/><rect x="66" y="6" width="10" height="6" fill="#0f2c4c" stroke="#2f6ea3"/></svg>
        <span class="ph-tag">SILHOUETTE · NO AIS IMAGE (OFFLINE BUILD)</span>
      </div>
      <div class="kv"><span class="k">Vessel</span><span class="v" id="topName">—</span></div>
      <div class="kv"><span class="k">Type</span><span class="v" id="topType">—</span></div>
      <div class="kv"><span class="k">MMSI</span><span class="v" id="topMmsi">—</span></div>
      <div class="score-big"><span class="lbl">ATTRIBUTION PROBABILITY</span><span class="num" id="topScore">—</span></div>
    </div>

    <div class="card" id="cardTop3">
      <div class="card-h"><span>Top 3 Candidates</span><span class="sub">score 0–1</span></div>
      <div id="top3List"></div>
    </div>

    <div class="card" id="cardWhy">
      <div class="card-h"><span>Why #1?</span><span class="sub">API reasons</span></div>
      <div id="whyTable"><div class="pending-note">Run Investigation to re-score via the API. Weights: ${SCORE_WEIGHTS}.</div></div>
    </div>

    <button class="cta" id="ctaBtn" type="button" disabled>View Detailed Analysis</button>
  `;

  const envForm = root.querySelector('#caseEnvForm') as HTMLFormElement;
  envForm.addEventListener('submit', (e) => e.preventDefault());

  root.querySelector('#ctaBtn')!.addEventListener('click', () => {
    if (caseData) openCaseModal(caseData);
  });

  on('investigation', () => {
    const c = caseData;
    if (c) populateFromApi(root, c);
  });
}

export function populateFromApi(root: HTMLElement, data: CaseJson): void {
  const slick = data.slick;
  const env = data.environment;
  const ranked = rankedVessels();
  const vessels = ranked.length ? ranked : rankedFrom(data);

  // --- Incident Summary ---
  const confRaw = slick?.confidence;
  const badge = root.querySelector('#confBadge') as HTMLElement;
  if (typeof confRaw === 'number' && Number.isFinite(confRaw)) {
    const conf = CONF_FMT(confRaw);
    badge.innerHTML = `<span class="badge-conf ${conf.cls}">${conf.label}</span>`;
    setText('sumConf', confRaw <= 1 ? `${(confRaw * 100).toFixed(0)} %` : String(confRaw));
  } else {
    badge.innerHTML = `<span class="badge-conf pending">demo case</span>`;
    setText('sumConf', 'demo case');
  }
  const area = slick?.area_km2;
  setText('sumArea', typeof area === 'number' ? `${area.toFixed(2)} km²` : '—', 'hl');
  if (data?.pipeline?.detect === false) {
    setText('sumDetect', 'Detect not re-run');
  } else if (data?.pipeline?.detect === true) {
    setText('sumDetect', 'Detect ran');
  } else {
    setText('sumDetect', slick?.source ?? '—');
  }
  setText('sumTdet', data?.observed_at ? D(Date.parse(data.observed_at)) : '—');

  seedEnvForm(env);

  // --- Source Reconstruction: origin + drift.method (not ±km 2σ, not fwd IoU) ---
  const origin = caseOrigin();
  setText('srcLL', origin ? `${origin.lat.toFixed(3)}° N, ${origin.lon.toFixed(3)}° E` : '—', 'hl');
  setText('srcMethod', data?.drift?.method ?? '—');

  // --- Top Candidate ---
  const top = vessels[0];
  const topSub = root.querySelector('#topSub') as HTMLElement | null;
  if (topSub) topSub.textContent = `ranked #1 of ${vessels.length || 0}`;
  const cta = root.querySelector('#ctaBtn') as HTMLButtonElement | null;
  if (cta) cta.disabled = vessels.length === 0;

  if (top) {
    const type = prettyType(top.type);
    setSilhouette(silClass(top.type));
    setText('topName', top.name ?? '—');
    setText('topType', type);
    setText('topMmsi', top.mmsi != null ? String(top.mmsi) : '—');
    const sc = score01(top.score);
    const scoreEl = root.querySelector('#topScore') as HTMLElement;
    scoreEl.innerHTML = `${sc.label}<small> ${sc.pct}%</small>`;
  } else {
    setText('topName', '—');
    setText('topType', '—');
    setText('topMmsi', '—');
    const scoreEl = root.querySelector('#topScore') as HTMLElement;
    if (scoreEl) scoreEl.textContent = '—';
  }

  // --- Top-3 animated bars ---
  const list = root.querySelector('#top3List') as HTMLElement;
  const top3 = vessels.slice(0, 3);
  list.innerHTML = top3.map((v, i) => {
    const sc = score01(v.score);
    return `
    <div class="cand-row">
      <div class="l1">
        <span class="rk">#${v.rank ?? i + 1}</span>
        <span class="nm">${esc(v.name ?? '—')}</span>
        <span class="sc">${sc.label}</span>
      </div>
      <div class="bar"><i class="${i === 0 ? 'top1' : ''}" style="width:0%"></i></div>
      <div class="meta">${esc(prettyType(v.type))} · ${esc(v.mmsi != null ? String(v.mmsi) : '—')}</div>
    </div>`;
  }).join('') || '<div class="pending-note">No ranked vessels in the case payload.</div>';
  requestAnimationFrame(() => {
    list.querySelectorAll<HTMLDivElement>('.bar > i').forEach((el, i) => {
      el.style.width = `${score01(top3[i].score).pct}%`;
    });
  });

  renderWhyApi(root.querySelector('#whyTable') as HTMLElement, top);
}

function rankedFrom(data: CaseJson): CaseVessel[] {
  return (data.vessels ?? []).slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}

function renderWhyApi(el: HTMLElement, top: CaseVessel | undefined): void {
  if (!top) {
    el.innerHTML = `<div class="pending-note">No ranked vessel. Weights: ${SCORE_WEIGHTS}.</div>`;
    return;
  }
  const sc = score01(top.score);
  const gap = top.ais_gap;
  const gapMin = gap && typeof gap.duration_min === 'number' ? `${gap.duration_min} min` : '—';
  const cpa = typeof top.cpa_to_origin_km === 'number' ? `${top.cpa_to_origin_km.toFixed(2)} km` : '—';
  const hdg = typeof top.heading_deg === 'number' ? `${top.heading_deg.toFixed(0)}°` : '—';
  const reasons = (top.reasons ?? []).filter(Boolean);
  const reasonRows = reasons.length
    ? reasons.map((r, i) => `<tr><td>${i + 1}</td><td class="reason" colspan="2">${esc(r)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="reason">No text reasons on this vessel.</td></tr>';
  el.innerHTML = `
    <div class="why-lead">#1 because score <b>${sc.label}</b> (${sc.pct}%). Weighted formula — not a court finding.</div>
    <table class="why">
      <tr><th>#</th><th>Factor (weight)</th><th>Measured</th></tr>
      <tr><td>1</td><td>Type (30%)</td><td>${esc(prettyType(top.type))}</td></tr>
      <tr><td>2</td><td>Proximity (30%)</td><td>CPA ${esc(cpa)}</td></tr>
      <tr><td>3</td><td>Time (20%)</td><td>origin-window overlap (see reasons)</td></tr>
      <tr><td>4</td><td>Heading (10%)</td><td>${esc(hdg)}</td></tr>
      <tr><td>5</td><td>AIS gap (10%)</td><td>${esc(gapMin)}</td></tr>
    </table>
    <table class="why" style="margin-top:8px">
      <tr><th>#</th><th colspan="2">API reasons</th></tr>
      ${reasonRows}
    </table>
    <div class="pending-note">${SCORE_WEIGHTS}</div>`;
}

function seedEnvForm(env: CaseJson['environment']): void {
  const form = document.getElementById('caseEnvForm') as HTMLFormElement | null;
  if (!form || !env) return;
  const set = (name: string, v: number | undefined): void => {
    const el = form.elements.namedItem(name) as HTMLInputElement | null;
    if (el && typeof v === 'number' && Number.isFinite(v)) el.value = String(v);
  };
  set('wind_speed', env.wind?.speed_ms);
  set('wind_toward', env.wind?.toward_deg);
  set('current_speed', env.current?.speed_ms);
  set('current_toward', env.current?.toward_deg);
}

function prettyType(t?: string): string {
  if (!t) return '—';
  return t.replace(/_/g, ' ');
}

function silClass(t?: string): string {
  const s = (t ?? '').toLowerCase();
  if (s.includes('chemical')) return 'Chemical Tanker';
  if (s.includes('tanker')) return 'Oil Tanker';
  if (s.includes('bulk')) return 'Bulk Carrier';
  return 'Cargo';
}

function score01(n: number | undefined): { label: string; pct: number } {
  const s = Number(n);
  if (!Number.isFinite(s)) return { label: '—', pct: 0 };
  const unit = s > 1 ? s / 100 : s;
  return { label: unit.toFixed(2), pct: Math.round(unit * 100) };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setSilhouette(cls: string): void {
  const el = document.getElementById('topSil');
  if (!el) return;
  const hull = '<path d="M6 30 L16 16 L102 16 L114 25 L114 30 Z" fill="#16406b" stroke="#2f6ea3"/>';
  const art: Record<string, string> = {
    'Oil Tanker': `${hull}<line x1="20" y1="23" x2="100" y2="23" stroke="#ff8c5a" stroke-width="1.4" stroke-dasharray="4 3"/><rect x="18" y="8" width="88" height="8" fill="#0f2c4c" stroke="#2f6ea3"/><rect x="6" y="18" width="9" height="9" fill="#22364f" stroke="#2f6ea3"/>`,
    'Chemical Tanker': `${hull}<circle cx="34" cy="12" r="5" fill="#123a5e" stroke="#7fd4ff"/><circle cx="52" cy="12" r="5" fill="#123a5e" stroke="#7fd4ff"/><circle cx="70" cy="12" r="5" fill="#123a5e" stroke="#7fd4ff"/><rect x="6" y="18" width="9" height="9" fill="#22364f" stroke="#2f6ea3"/>`,
    'Cargo': `${hull}<rect x="22" y="10" width="12" height="6" fill="#2f6ea3"/><rect x="35" y="10" width="12" height="6" fill="#3a7fb5"/><rect x="48" y="10" width="12" height="6" fill="#2f6ea3"/><rect x="28" y="4" width="12" height="6" fill="#3a7fb5"/><rect x="41" y="4" width="12" height="6" fill="#2f6ea3"/><rect x="6" y="18" width="9" height="9" fill="#22364f" stroke="#2f6ea3"/>`,
    'Bulk Carrier': `${hull}<rect x="26" y="10" width="16" height="6" fill="#0f2c4c" stroke="#2f6ea3"/><rect x="46" y="10" width="16" height="6" fill="#0f2c4c" stroke="#2f6ea3"/><rect x="66" y="10" width="16" height="6" fill="#0f2c4c" stroke="#2f6ea3"/><rect x="6" y="18" width="9" height="9" fill="#22364f" stroke="#2f6ea3"/>`
  };
  el.innerHTML = art[cls] ?? art['Cargo'];
}

function setText(id: string, v: string, cls?: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = v;
  el.className = `v ${cls ?? ''}`.trim();
}
