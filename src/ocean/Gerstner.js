import * as THREE from 'three';

export const MAX_GERSTNER = 6;
const G = 9.81;

/**
 * Long directional swell on top of the FFT field.
 * Breaks residual tiling and gives the slow rolling the aerial camera reads as swell.
 */
export function buildGerstnerWaves(env) {
  const dirs = [];
  const params = [];
  for (let i = 0; i < MAX_GERSTNER; i++) {
    dirs.push(new THREE.Vector2());
    params.push(new THREE.Vector4());
  }

  const swellAmp = env.ocean.swell * 1.8 * env.ocean.waveAmplitude;
  const secondAmp = env.ocean.secondarySwell * 1.1 * env.ocean.waveAmplitude;
  const steep = env.ocean.steepness;

  const waves = [
    { amp: swellAmp, lambda: 420, dir: env.ocean.swellDirection, steep: 0.32 * steep },
    { amp: swellAmp * 0.45, lambda: 260, dir: env.ocean.swellDirection + 12, steep: 0.28 * steep },
    { amp: secondAmp, lambda: 180, dir: env.ocean.secondarySwellDirection, steep: 0.3 * steep },
    { amp: secondAmp * 0.5, lambda: 110, dir: env.ocean.secondarySwellDirection - 18, steep: 0.25 * steep },
  ];

  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const rad = (w.dir * Math.PI) / 180;
    dirs[i].set(Math.cos(rad), Math.sin(rad));
    const k = (2 * Math.PI) / w.lambda;
    const omega = Math.sqrt(G * k);
    params[i].set(k, w.amp, w.steep, omega);
  }

  return { dirs, params };
}
