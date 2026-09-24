/**
 * OCEANTRACE — Timeline + transport + pipeline strip (PLAN §6 bottom bar).
 * Scrubber −12 h…+24 h rel. T_det with discharge (blue) & detection (red) markers,
 * play/pause + 1×/2×/4×, computed sim-time readout, particle/concentration toggles,
 * 8-step pipeline with checkmarks, Run Investigation button.
 */
import { on, emit, state } from '../state';
import { T_DET_S, T_SRC_EPOCH_MS } from '../engine/engine';
import { caseData, dischargeHours, hoursRange, obsMs } from '../caseView';

const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number): string => String(n).padStart(2, '0');

export function fmtSimTime(tSec: number): { utc: string; rel: string } {
  const d = new Date(T_SRC_EPOCH_MS + tSec * 1000);
  const relH = (tSec - T_DET_S) / 3600;
  return {
    utc: `${M[d.getUTCMonth()]} ${p2(d.getUTCDate())}, ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} UTC`,
    rel: `(${relH >= 0 ? '+' : '−'}${Math.abs(relH).toFixed(1)}h)`
  };
}

const SCRUB_MIN = T_DET_S - 12 * 3600;
const SCRUB_MAX = T_DET_S + 24 * 3600;
const SPAN = SCRUB_MAX - SCRUB_MIN;

export function buildTimeline(root: HTMLElement): void {
  // discharge marker position: −36 h rel T_det is OUTSIDE the scrubber window →
  // clamped to the left edge (documented window clip, PLAN §5/§10)
  root.innerHTML = `
    <div class="tl-top">
      <button class="tp-btn" id="playBtn" title="Play / Pause (Space)" aria-label="Play or pause">▶</button>
      <div class="spd" id="spdGroup">
        <button data-s="1" class="active">1×</button>
        <button data-s="2">2×</button>
        <button data-s="4">4×</button>
      </div>
      <div class="scrub-wrap">
        <div class="scrub" id="scrub">
          <div class="track"></div>
          <div class="fill" id="scrubFill"></div>
          <div class="marker discharge" id="markDischarge" style="left:0%"><span class="mlbl">DISCHARGE</span></div>
          <div class="marker detect" id="markDetect" style="left:50%"><span class="mlbl">DETECTION</span></div>
          <div class="handle" id="scrubHandle"></div>
        </div>
      </div>
      <div class="tl-readout" id="simReadout">—</div>
      <div class="tl-toggles">
        <span class="tgl-mini" id="tglParticles"><span class="switch" id="swParticles"></span>Show Particles</span>
        <span class="tgl-mini" id="tglConc"><span class="switch" id="swConc"></span>Oil Concentration</span>
        <span>
          <div class="legend"></div>
          <div class="legend-lbls"><span>low</span><span>high</span></div>
        </span>
      </div>
    </div>
    <div class="tl-bottom">
      <div class="pipeline" id="pipelineStrip"></div>
      <button class="run-btn" id="runBtn">▶ Run Investigation</button>
    </div>
  `;

  // playback
  const playBtn = root.querySelector('#playBtn') as HTMLButtonElement;
  playBtn.addEventListener('click', () => {
    state.playing = !state.playing;
    playBtn.textContent = state.playing ? '⏸' : '▶';
    playBtn.classList.toggle('playing', state.playing);
    emit('playback');
  });

  const spd = root.querySelector('#spdGroup')!;
  spd.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    spd.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.speed = Number(b.dataset.s) as 1 | 2 | 4;
  });

  // scrubber drag
  const scrub = root.querySelector('#scrub') as HTMLElement;
  const setFromEvent = (e: PointerEvent): void => {
    const r = scrub.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (caseData) {
      const { min, max } = hoursRange();
      state.tHours = min + f * (max - min);
    } else {
      state.simTime = SCRUB_MIN + f * SPAN;
    }
    emit('seek');
  };
  let dragging = false;
  scrub.addEventListener('pointerdown', (e) => { dragging = true; scrub.setPointerCapture(e.pointerId); setFromEvent(e); });
  scrub.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
  scrub.addEventListener('pointerup', () => { dragging = false; });

  // particle / concentration toggles (particles is the same flag as the left layer)
  const swP = root.querySelector('#swParticles') as HTMLElement;
  const swC = root.querySelector('#swConc') as HTMLElement;
  const syncSw = (): void => {
    swP.classList.toggle('on', state.layers.particles);
    swC.classList.toggle('on', state.showConcentration);
  };
  root.querySelector('#tglParticles')!.addEventListener('click', () => {
    state.layers.particles = !state.layers.particles;
    syncSw(); emit('layers');
  });
  root.querySelector('#tglConc')!.addEventListener('click', () => {
    state.showConcentration = !state.showConcentration;
    syncSw(); emit('layers');
  });
  on('layers', syncSw);
  syncSw();

  // time readout + scrub position (driven by 'time' events from main loop)
  const readout = root.querySelector('#simReadout')!;
  const fill = root.querySelector('#scrubFill') as HTMLElement;
  const handle = root.querySelector('#scrubHandle') as HTMLElement;
  const markDis = root.querySelector('#markDischarge') as HTMLElement;
  const markDet = root.querySelector('#markDetect') as HTMLElement;
  const utcOf = (tHours: number): string => {
    const obs = obsMs();
    if (!Number.isFinite(obs)) return '';
    const d = new Date(obs + tHours * 3600000);
    return `${M[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}Z`;
  };
  const renderTime = (): void => {
    if (caseData) {
      const { min, max } = hoursRange();
      const span = Math.max(1e-6, max - min);
      const pct = ((state.tHours - min) / span) * 100;
      const dis = dischargeHours();
      const disPct = ((dis - min) / span) * 100;
      const detPct = ((0 - min) / span) * 100;
      markDis.style.left = `${disPct}%`;
      markDet.style.left = `${detPct}%`;
      markDis.title = `Reconstructed discharge ${utcOf(dis)} (${dis.toFixed(1)} h vs SAR)`;
      markDet.title = `SAR detection ${utcOf(0)} (t = 0)`;
      const play = state.playing ? 'playing' : 'paused';
      const phase = state.tHours < dis - 0.05 ? 'before discharge' : state.tHours < -0.05 ? 'hindcast drift' : state.tHours < 0.05 ? 'SAR detection' : 'forecast';
      readout.innerHTML = `${utcOf(state.tHours)} · ${state.tHours >= 0 ? '+' : '−'}${Math.abs(state.tHours).toFixed(1)} h <span class="rel">(${phase} · ${play})</span>`;
      fill.style.width = `${pct}%`;
      handle.style.left = `${pct}%`;
      return;
    }
    const f = state.simTime;
    const { utc, rel } = fmtSimTime(f);
    readout.innerHTML = `${utc} <span class="rel">${rel}</span>`;
    const pct = ((f - SCRUB_MIN) / SPAN) * 100;
    fill.style.width = `${pct}%`;
    handle.style.left = `${pct}%`;
  };
  on('time', renderTime);
  on('seek', renderTime);
  renderTime();

  // Run Investigation
  const runBtn = root.querySelector('#runBtn') as HTMLButtonElement;
  runBtn.addEventListener('click', () => {
    if (state.investigating || state.booting) return;
    runBtn.disabled = true;
    runBtn.textContent = '⟳ Investigating…';
    emit('investigate');
  });
  on('investigationDone', () => {
    runBtn.disabled = false;
    runBtn.textContent = '▶ Re-run Investigation';
  });
}
