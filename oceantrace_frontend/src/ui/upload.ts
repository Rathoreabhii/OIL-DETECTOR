/** Judge upload: SAR (+ optional AIS) → POST /api/investigate. Not live satellite. */
import { investigateUpload } from '../api';
import { applyCase } from '../caseView';
import { emit, state } from '../state';
import { readEnvForm } from './rightPanel';

const RGB = 'RGB photos (JPEG/WebP) are not Sentinel-1 SAR. Use a dataset PNG or GeoTIFF.';

function isRgb(file: File): boolean {
  const n = file.name.toLowerCase();
  const t = (file.type || '').toLowerCase();
  return n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.webp') || t === 'image/jpeg' || t === 'image/webp';
}

export function buildUpload(root: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.id = 'cardUpload';
  wrap.innerHTML = `
    <div class="card-h"><span>Judge upload</span><span class="sub">SAR + optional AIS</span></div>
    <form id="judgeUpload" class="upload-form" autocomplete="off">
      <label>SAR image (PNG / GeoTIFF)
        <input type="file" name="sar" accept=".png,.tif,.tiff,.TIF,.TIFF" required />
      </label>
      <label>AIS CSV (optional)
        <input type="file" name="ais" accept=".csv,text/csv" />
      </label>
      <p class="upload-hint">PNG or GeoTIFF (.tif). Zenodo 32-bit TIFFs use VV (band 1) like training. JPEG/phone photos are rejected.</p>
      <button type="submit" class="cta upload-go" id="uploadGo">Run detect → drift → score</button>
      <p class="upload-status" id="uploadStatus" role="status"></p>
    </form>
  `;
  root.appendChild(wrap);

  const form = wrap.querySelector('#judgeUpload') as HTMLFormElement;
  const status = wrap.querySelector('#uploadStatus') as HTMLElement;
  const go = wrap.querySelector('#uploadGo') as HTMLButtonElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sar = (form.elements.namedItem('sar') as HTMLInputElement).files?.[0];
    const ais = (form.elements.namedItem('ais') as HTMLInputElement).files?.[0];
    if (!sar || sar.size === 0) {
      status.textContent = 'Choose a SAR PNG or GeoTIFF.';
      status.dataset.kind = 'error';
      return;
    }
    if (isRgb(sar)) {
      status.textContent = RGB;
      status.dataset.kind = 'error';
      return;
    }
    const fd = new FormData();
    fd.append('sar', sar, sar.name);
    if (ais && ais.size > 0) fd.append('ais', ais, ais.name);
    const env = readEnvForm();
    fd.set('wind_speed', String(env?.wind.speed_ms ?? 6.4));
    fd.set('wind_toward', String(env?.wind.toward_deg ?? 65));
    fd.set('current_speed', String(env?.current.speed_ms ?? 0.38));
    fd.set('current_toward', String(env?.current.toward_deg ?? 72));
    go.disabled = true;
    status.dataset.kind = 'busy';
    status.textContent = 'Running detect → drift → score…';
    try {
      const data = await investigateUpload(fd);
      applyCase(data);
      state.playing = false;
      emit('caseReplaced');
      state.tHours = 0;
      emit('investigation');
      emit('time');
      emit('playback');
      const src = data.slick?.source ?? 'unknown';
      const area = data.slick?.area_km2;
      const n = data.vessels?.length ?? 0;
      const top = data.vessels?.[0]?.name;
      status.dataset.kind = 'ok';
      status.textContent = [
        data.title ?? 'upload_001',
        src,
        typeof area === 'number' ? `${area.toFixed(2)} km²` : null,
        n ? `${top} #1 of ${n}` : 'no AIS uploaded — ranks empty',
        'timeline at SAR detection (t=0)',
      ].filter(Boolean).join(' · ');
    } catch (err) {
      status.dataset.kind = 'error';
      status.textContent = err instanceof Error ? err.message : 'Upload failed';
    } finally {
      go.disabled = false;
    }
  });
}
