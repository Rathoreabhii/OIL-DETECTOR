/**
 * OCEANTRACE — Modal (detailed analysis + info modals).
 * Candidate table comes from FastAPI case_001 ranks, not scoring.ts / Ocean Pride.
 */
import { CaseJson, CaseVessel } from '../api';
import { caseData, caseOrigin, rankedVessels } from '../caseView';
import { Investigation } from '../engine/engine';

function scoreLabel(n: number | undefined): string {
  const s = Number(n);
  if (!Number.isFinite(s)) return '—';
  return (s > 1 ? s / 100 : s).toFixed(2);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function openCaseModal(data: CaseJson | null = caseData): void {
  if (!data) return;
  const vessels = rankedVessels().length ? rankedVessels() : (data.vessels ?? []);
  const origin = caseOrigin();
  const area = data.slick?.area_km2;
  const detect = data.pipeline?.detect === false
    ? 'Detect not re-run (canned slick)'
    : data.pipeline?.detect === true
      ? 'Detect ran'
      : (data.slick?.source ?? 'demo');
  const root = document.getElementById('modal-root')!;
  root.innerHTML = `
    <div class="backdrop"></div>
    <div class="panel">
      <button class="close" title="Close">✕</button>
      <h2>DETAILED CANDIDATE ANALYSIS</h2>
      <div class="msub">${esc(data.title ?? data.id ?? 'case_001')} ·
        ${origin ? `${origin.lat.toFixed(3)}° N, ${origin.lon.toFixed(3)}° E` : 'origin —'} ·
        ${typeof area === 'number' ? area.toFixed(2) + ' km²' : 'area —'} ·
        ${esc(data.drift?.method ?? 'leeway')} · ${esc(detect)}</div>
      <div class="tbl-wrap"><table class="full">
        <tr><th>#</th><th>Vessel</th><th>Type</th><th>MMSI</th><th>CPA km</th><th>Heading</th><th>Score</th><th>Reasons</th></tr>
        ${vessels.map((v: CaseVessel, i: number) => `
          <tr class="${i === 0 ? 'top1' : ''}">
            <td>${v.rank ?? i + 1}</td>
            <td class="nm">${esc(v.name ?? '—')}</td>
            <td>${esc((v.type ?? '—').replace(/_/g, ' '))}</td>
            <td>${esc(v.mmsi != null ? String(v.mmsi) : '—')}</td>
            <td>${typeof v.cpa_to_origin_km === 'number' ? v.cpa_to_origin_km.toFixed(1) : '—'}</td>
            <td>${typeof v.heading_deg === 'number' ? v.heading_deg.toFixed(0) + '°' : '—'}</td>
            <td class="tot">${scoreLabel(v.score)}</td>
            <td class="reasons">${esc((v.reasons ?? []).join(' · ') || '—')}</td>
          </tr>`).join('')}
      </table></div>
      <div class="modal-note">
        Rank-1 is from FastAPI <b>case_001</b> (weights 30% type + 30% proximity + 20% time + 10% heading + 10% AIS gap).
        Particles on the canvas are a local toy overlay — not OpenDrift, not the U-Net.
        Judge Map is <b>http://localhost:5174</b>. Not operational NTRO.
      </div>
    </div>`;
  root.classList.add('open');
  root.querySelector('.backdrop')!.addEventListener('click', closeModal);
  root.querySelector('.close')!.addEventListener('click', closeModal);
  document.addEventListener('keydown', escClose);
}

export function openModal(inv: Investigation): void {
  const root = document.getElementById('modal-root')!;
  const top = inv.candidates[0];
  const fmtMin = (m: number): string => (m <= 30 ? 'at discharge' : m <= 999 ? `${Math.round(m)} min` : '—');
  root.innerHTML = `
    <div class="backdrop"></div>
    <div class="panel">
      <button class="close" title="Close">✕</button>
      <h2>DETAILED CANDIDATE ANALYSIS</h2>
      <div class="msub">Estimated source ${inv.estLat.toFixed(3)}° N, ${inv.estLon.toFixed(3)}° E ± ${inv.uncKm.toFixed(1)} km (2σ) ·
        discharge ${new Date(inv.dischEpochMs).toISOString().replace('T', ' ').slice(0, 16)} UTC ·
        extent ${inv.areaKm2.toFixed(0)} km² · core ${inv.areaCoreKm2.toFixed(0)} km² ·
        fwd validation ${(inv.fwdMatch * 100).toFixed(0)}% IoU · confidence ${(inv.conf * 100).toFixed(1)}%</div>
      <div class="tbl-wrap"><table class="full">
        <tr><th>#</th><th>Vessel</th><th>Type</th><th>MMSI</th><th>Distance</th><th>Speed @ discharge</th><th>Time proximity</th><th>Trajectory</th><th>Loitering</th><th>Score</th></tr>
        ${inv.candidates.map((c, i) => `
          <tr class="${i === 0 ? 'top1' : ''}">
            <td>${i + 1}</td>
            <td class="nm">${c.vessel.def.name}</td>
            <td>${c.vessel.def.cls}</td>
            <td>${c.vessel.def.mmsi}</td>
            <td>${c.raw.distKm > 900 ? '—' : c.raw.distKm.toFixed(1) + ' km'}</td>
            <td>${c.raw.speedKn > 90 ? '—' : c.raw.speedKn.toFixed(2) + ' kn'}</td>
            <td>${fmtMin(c.raw.timeGapMin)}</td>
            <td>${c.raw.trajHit === 'hit' ? 'through cloud' : c.raw.trajHit === 'near' ? 'near cloud' : 'clear'}</td>
            <td>${c.raw.loiterH > 0 ? c.raw.loiterH.toFixed(1) + ' h' : 'none'}</td>
            <td class="tot">${c.total}/100</td>
          </tr>`).join('')}
      </table></div>
      <div class="modal-note">
        <b>#1 — ${top.vessel.def.name}:</b> ${top.components.map((c) => `${c.label} ${c.value} (+${c.points})`).join(' · ')}.
        Rubric weights (Σ=100): distance 40 · type 30 · speed anomaly 20 · time proximity 10 ·
        trajectory intersection 8 · loitering 5. All values computed by the OCEANTRACE drift engine —
        seeded (20260820), deterministic, offline.
      </div>
      <div class="modal-note" style="margin-top:6px">Area metrics: extent = all KDE-wet cells; core = cells ≥ 50% of peak density. Confidence = 0.35 + 0.45·IoU + 0.2·(1 − unc/30 km), clamped [0.05, 0.99].</div>
    </div>`;
  root.classList.add('open');
  root.querySelector('.backdrop')!.addEventListener('click', closeModal);
  root.querySelector('.close')!.addEventListener('click', closeModal);
  document.addEventListener('keydown', escClose);
}

export function openInfoModal(title: string, html: string): void {
  const root = document.getElementById('modal-root')!;
  root.innerHTML = `
    <div class="backdrop"></div>
    <div class="panel" style="width:min(560px,92vw)">
      <button class="close" title="Close">✕</button>
      <h2>${title}</h2>
      <div class="modal-note" style="margin-top:10px;font-size:11.5px;color:#bfe9ff;line-height:1.75">${html}</div>
    </div>`;
  root.classList.add('open');
  root.querySelector('.backdrop')!.addEventListener('click', closeModal);
  root.querySelector('.close')!.addEventListener('click', closeModal);
  document.addEventListener('keydown', escClose);
}

function closeModal(): void {
  const root = document.getElementById('modal-root')!;
  root.classList.remove('open');
  root.innerHTML = '';
  document.removeEventListener('keydown', escClose);
}

function escClose(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeModal();
}
