/**
 * OCEANTRACE — Left panel: Map Layers card (14 working toggles + Reset),
 * View Mode segmented control (2D/2.5D/3D), mini-map card.
 */
import { LAYER_DEFS, on, emit, state, CameraMode } from '../state';
import { MiniMap } from '../render/minimap';
import { Camera, makeCamera } from '../render/camera';
import { buildUpload } from './upload';

export let leftCamera: Camera = makeCamera(100, 100, '2d'); // kept in sync by main loop

let minimap: MiniMap | null = null;

export function getMinimap(): MiniMap | null { return minimap; }

export function buildLeftPanel(root: HTMLElement): void {
  root.innerHTML = `
    <div class="card">
      <div class="card-h"><span>Map Layers</span><button class="reset" id="layersReset">RESET</button></div>
      <div id="layerList">
        ${LAYER_DEFS.map((l) => `
          <div class="layer-row" data-layer="${l.key}">
            <span class="name"><span class="swatch" style="background:${l.color}"></span>${l.label}</span>
            <span class="switch ${state.layers[l.key] ? 'on' : ''}"></span>
          </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-h"><span>View Mode</span><span class="sub">projection</span></div>
      <div class="seg" id="viewSeg">
        <button data-mode="2d" class="active">2D</button>
        <button data-mode="2.5d">2.5D</button>
        <button data-mode="3d">3D</button>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><span>Mini-Map</span><span class="sub">domain overview</span></div>
      <canvas id="minimap"></canvas>
      <div class="mm-meta">
        <span class="coords" id="mmCoords">12.500° N, 72.000° E | Indian Ocean</span>
      </div>
    </div>
  `;

  // layer toggles
  root.querySelector('#layerList')!.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.layer-row') as HTMLElement | null;
    if (!row) return;
    const key = row.dataset.layer as keyof typeof state.layers;
    state.layers[key] = !state.layers[key];
    row.querySelector('.switch')!.classList.toggle('on', state.layers[key]);
    emit('layers');
  });

  root.querySelector('#layersReset')!.addEventListener('click', () => {
    for (const l of LAYER_DEFS) {
      state.layers[l.key] = ['baseMap', 'sarOverlay', 'oilSpill', 'spillBoundary', 'estSource', 'backTraj', 'fwdTraj', 'vessels', 'vesselTracks', 'currents', 'wind'].includes(l.key);
    }
    renderSwitches();
    emit('layers');
  });

  function renderSwitches(): void {
    root.querySelectorAll<HTMLElement>('.layer-row').forEach((row) => {
      const key = row.dataset.layer as keyof typeof state.layers;
      row.querySelector('.switch')!.classList.toggle('on', state.layers[key]);
    });
  }
  on('layers', renderSwitches);
  on('preset', renderSwitches);

  // view mode segmented control
  const seg = root.querySelector('#viewSeg')!;
  seg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.cameraMode = btn.dataset.mode as CameraMode;
    emit('camera');
  });
  on('camera', () => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.cameraMode));
  });

  // mini-map
  const mmCanvas = root.querySelector('#minimap') as HTMLCanvasElement;
  const mmCoords = root.querySelector('#mmCoords') as HTMLElement;
  minimap = new MiniMap(mmCanvas, mmCoords);

  buildUpload(root);
}
