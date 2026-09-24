# Maritime environment (port 5173 — frozen)

**This README is the cinematic FFT ocean only.** Do not demo **5173**.

- Judge Map: **http://localhost:5174** — `SIH.md`
- Dashboard: **http://localhost:5175** — `oceantrace_frontend/`
- Live numbers: **`CURRENT_STATE.md`**
- API: port **8000**

Cinematic browser scene: **spectral FFT ocean**, atmosphere, and a clean **wind / current / time** API.

This pass is **open ocean only**. No land, city, oil, ships, AIS, or forensic UI.

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`). Needs a desktop browser with **WebGL2** and float color buffers (Chrome, Edge, Firefox, recent Safari).

## What you should see

- Open-ocean FFT swell (calmer than a storm sim)
- Local height-field physics (mild ripples, click to disturb)
- Controllable **current** (speed, direction, influence) — water transport, not wind
- Sun glitter, Fresnel, sky reflection

Controls: LMB orbit, RMB pan, wheel zoom. The camera cannot dive under the sea surface.

## Simulation state

Exposed on `window.environment`:

```js
environment = {
  time,
  ocean: { patchSizes, choppiness, swell, ... },
  current: { speed, direction, visible },  // water transport (m/s, degrees toward)
  wind:    { speed, direction, influence, fetch }, // atmospheric forcing
  sun, water, atmosphere
}
```

**Wind** rebuilds the JONSWAP spectrum (sea state).  
**Current** advects micro-chop and the optional drift arrows, and is the vector later oil / particles / drift reconstruction will use. They are not the same variable.

Toggle **Current → show drift** in the GUI to see transport.

## Architecture (later phases)

```
OCEAN → CURRENT → WIND → OIL SIMULATION → VESSELS → DRIFT MODEL → SOURCE RECONSTRUCTION → ATTRIBUTION
```

| Module | Role |
|---|---|
| `src/environment.js` | Shared sim state |
| `src/ocean/FFT.js` | Tessendorf GPU IFFT |
| `src/ocean/Spectra.js` | JONSWAP / Phillips / PM |
| `src/ocean/Ocean.js` | Radial mesh + 3 cascades + shading |
| `src/sky/Atmosphere.js` | Preetham sky + sun |
