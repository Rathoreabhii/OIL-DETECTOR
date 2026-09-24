/**
 * OCEANTRACE — 8-step pipeline strip.
 * Load case → Demo slick → Geometry → Leeway (API) → Origin → AIS tracks →
 * Score (API) → Report. Boot checks 1–4; Run Investigation POSTs analyze.
 */
import { on } from '../state';

const STEPS = ['Load case', 'Demo slick', 'Geometry', 'Leeway (API)', 'Origin', 'AIS tracks', 'Score (API)', 'Report'];

export function buildPipeline(root: HTMLElement): void {
  root.innerHTML = STEPS.map((s, i) => `
    <div class="pstep" data-step="${i}">
      <span class="num">${i + 1}</span>
      <span class="lbl">${s}</span>
    </div>`).join('');

  const el = (i: number): HTMLElement | null => root.querySelector(`.pstep[data-step="${i}"]`);

  function setState(i: number, st: 'pending' | 'active' | 'done'): void {
    const e = el(i);
    if (!e) return;
    e.classList.remove('active', 'done');
    if (st !== 'pending') e.classList.add(st);
  }

  on('pipeline', () => { /* progress payloads come through state.pipeline via helpers below */ });

  // helpers registered on a global channel the main loop calls
  (window as unknown as { __pipeline: { set: (i: number, s: 'pending' | 'active' | 'done') => void } }).__pipeline = { set: setState };
}
