/**
 * OCEANTRACE — Footer (PLAN §6).
 */
import { openInfoModal } from './modal';

export function buildFooter(root: HTMLElement): void {
  root.innerHTML = `
    <span>OCEANTRACE v2.0.0 · SIH 26143 toy particle scene · not NTRO operational</span>
    <span class="tagline">“Cleaner Oceans. Safer Tomorrows.”</span>
    <span class="flinks">
      <a data-info="about">About</a>
      <a data-info="method">Methodology</a>
      <a data-info="help">Help</a>
    </span>
  `;

  const pages: Record<string, { title: string; html: string }> = {
    about: {
      title: 'ABOUT OCEANTRACE',
      html: `5175 shows <b>case_001</b> from FastAPI (:8000): ARABIAN HORIZON ranks, leeway
      hindcast, slick area from JSON. <b>Particles are a local toy</b>, not the U-Net and not
      OpenDrift. Basemap tiles © Esri. The judge Map remains <b>http://localhost:5174</b>. Not operational NTRO.`
    },
    method: {
      title: 'METHODOLOGY',
      html: `<b>Drift model</b> — Euler–Maruyama particle advection (N=3000, Δt=120 s):
      dx = (u<sub>cur</sub> + 0.03·u<sub>wind</sub> + 0.02·u<sub>wind</sub>)·dt + √(2·K<sub>h</sub>·dt)·g,
      K<sub>h</sub> = 5 + 0.002·t m²/s (Fay-informed).<br>
      <b>Fields</b> — deterministic seeded value-noise: wind 8 m/s from 285°±25°/24 h;
      divergence-free curl-noise currents (ψ = A·vnoise), |u| ∈ 0.1–0.5 m/s.<br>
      <b>Slick</b> — Gaussian KDE σ=2 km on 1 km grid; polygon at the 15th-percentile isopleth
      (marching squares); area = Σ wet cells × 1 km².<br>
      <b>Hindcast</b> — time-reversed advection T_det → T_src (36 h, hourly blocks; diffusion
      √(2·K<sub>h</sub>·|dt|), time-symmetric in expectation). Source = centroid; uncertainty =
      2σ covariance ellipse.<br><b>Validation</b> — re-release at the estimate, IoU vs observed slick →
      confidence = 0.5 + 0.35·match + 0.15·(1 − unc/30 km).<br>
      <b>Scoring (API)</b> — 30% type + 30% proximity + 20% time + 10% heading + 10% AIS gap.
      Particle 40/30/20/10/8/5 rubric is unused on this panel.`
    },
    help: {
      title: 'HELP',
      html: `<b>Scrub</b> only moves the <b>particle toy</b> (engine clock, not 18 Nov 2025).
      Press ▶ to play at 1×/2×/4×.<br><b>Run Investigation</b> POSTs /api/cases/case_001/analyze
      (leeway + ranks). Detect is not re-run.<br>
      <b>Layers</b> — truth overlays are the SAR case; particles are simulation.
      Wheel zoom, drag pan. Judge Map is <b>http://localhost:5174</b>.`
    }
  };

  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[data-info]') as HTMLElement | null;
    if (!a) return;
    const pg = pages[a.dataset.info!];
    if (pg) openInfoModal(pg.title, pg.html);
  });
}
