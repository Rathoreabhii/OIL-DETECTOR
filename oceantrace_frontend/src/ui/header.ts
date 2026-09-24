/**
 * Header: scene presets, UTC clock. No LIVE / NTRO-secure theater.
 */
import { on, emit, state, CameraMode } from '../state';

const PRESETS: Record<string, Partial<Record<string, unknown>>> = {
  'Geo Map': { cameraMode: '2d', layers: { baseMap: true, sarOverlay: false, oilSpill: true, spillBoundary: true, estSource: true, uncRegion: false, backTraj: true, fwdTraj: true, vessels: true, vesselTracks: true, currents: true, wind: true, particles: false, weather: false } },
  'SAR Analysis': { cameraMode: '2d', layers: { baseMap: false, sarOverlay: true, oilSpill: true, spillBoundary: true, vessels: true, vesselTracks: false, particles: false, currents: true, wind: true, weather: false } },
  'Vessel Tracking': { cameraMode: '2d', layers: { baseMap: true, sarOverlay: false, oilSpill: false, spillBoundary: false, vessels: true, vesselTracks: true, currents: true, wind: false, particles: false, weather: false } },
  'Simulation': { cameraMode: '2.5d', layers: { baseMap: true, sarOverlay: false, oilSpill: true, spillBoundary: true, vessels: false, vesselTracks: false, particles: true, currents: true, wind: true, weather: false } },
  'Analytics': { cameraMode: '2d', layers: { baseMap: true, sarOverlay: false, oilSpill: true, spillBoundary: true, vessels: false, vesselTracks: false, particles: false, currents: false, wind: false, weather: false } },
  'Reports': { cameraMode: '3d', layers: { baseMap: false, sarOverlay: false, oilSpill: true, spillBoundary: true, vessels: true, vesselTracks: false, particles: false, currents: false, wind: false, weather: true } }
};

const PILLS = ['Scene', 'Geo Map', 'SAR Analysis', 'Vessel Tracking', 'Simulation', 'Analytics', 'Reports'];

export function buildHeader(root: HTMLElement): void {
  root.innerHTML = `
    <div class="logo">
      <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="13" stroke="#00bfff" stroke-width="2" opacity=".85"/>
        <circle cx="16" cy="16" r="8" stroke="#00bfff" stroke-width="1" opacity=".5" stroke-dasharray="3 3"/>
        <circle cx="16" cy="16" r="3.2" fill="#ff3366"/>
        <path d="M4 22 q4 -3 8 0 t8 0" stroke="#00e676" stroke-width="1.6" fill="none" opacity=".8"/>
      </svg>
      <div class="logo-text">
        <div class="name">OCEAN<span class="accent">TRACE</span></div>
        <div class="tag">case_001 demo · particles are local · judge Map is :5174</div>
      </div>
    </div>
    <nav class="pills" id="navPills">
      ${PILLS.map((p, i) => `<button class="pill ${i === 0 ? 'active' : ''}" data-pill="${p}">${p}</button>`).join('')}
    </nav>
    <div class="hdr-right">
      <span class="badge-demo" title="Not live satellite. Not operational NTRO.">Demo · case_001</span>
      <span id="utcClock"><span class="lbl">UTC</span>--:--:--</span>
      <span class="badge-secure">SIH 26143</span>
      <button class="icon-btn" id="gearBtn" title="System settings" aria-label="System settings">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="2"/>
          <path d="M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4M6 6l1.7 1.7M16.3 16.3l1.7 1.7M18 6l-1.7 1.7M7.7 16.3L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
      <div id="gearPop">
        <div class="row"><span>Deterministic seed</span><b>20260820</b></div>
        <div class="row"><span>Particles</span><b>3000</b></div>
        <div class="row"><span>Physics Δt</span><b>120 s</b></div>
        <div class="row"><span>Renderer</span><b>Canvas 2D</b></div>
        <div class="row"><span>Runtime deps</span><b>0</b></div>
        <button id="resetViewBtn">Reset View (2D · fit domain)</button>
      </div>
    </div>
  `;

  // nav pills → presets
  const pillsEl = root.querySelector('#navPills')!;
  pillsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.pill') as HTMLButtonElement | null;
    if (!btn) return;
    pillsEl.querySelectorAll('.pill').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const name = btn.dataset.pill!;
    state.navPreset = name;
    console.log(`[OCEANTRACE] nav preset → ${name}`);
    if (name === 'Scene') {
      state.cameraMode = '2d';
      emit('camera');
      emit('fitScene');
    } else {
      const preset = PRESETS[name];
      if (preset) {
        if (preset.cameraMode) { state.cameraMode = preset.cameraMode as CameraMode; emit('camera'); }
        if (preset.layers) {
          for (const [k, v] of Object.entries(preset.layers as Record<string, boolean>)) {
            (state.layers as unknown as Record<string, boolean>)[k] = v;
          }
          emit('layers');
        }
      }
      if (name === 'Geo Map') emit('fitGeo');
    }
    emit('preset');
  });

  // live UTC clock
  const clockEl = root.querySelector('#utcClock')!;
  const tick = (): void => {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    clockEl.innerHTML = `<span class="lbl">UTC</span>${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);

  // gear popover
  const pop = root.querySelector('#gearPop') as HTMLElement;
  root.querySelector('#gearBtn')!.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!pop.contains(e.target as Node)) pop.classList.remove('open');
  });
  pop.querySelector('#resetViewBtn')!.addEventListener('click', () => {
    state.cameraMode = '2d';
    emit('camera');
    emit('resetView');
    pop.classList.remove('open');
  });

  on('preset', () => { /* hook for future UI badges */ });
}
