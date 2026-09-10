/**
 * Single source of truth for the maritime environment.
 *
 * Wind  = atmospheric forcing  → drives the wave SPECTRUM (sea state).
 * Current = water transport    → later drives oil, particles, drift.
 * They are never collapsed into one fake direction.
 *
 * Later phases consume this object:
 *   OCEAN → CURRENT → WIND → OIL → VESSELS → DRIFT → SOURCE → ATTRIBUTION
 */

export const SPECTRA = Object.freeze({
  JONSWAP: 'JONSWAP',
  PHILLIPS: 'Phillips',
  PIERSON_MOSKOWITZ: 'Pierson-Moskowitz',
});

/** Degrees: 0 = toward +X (east), 90 = toward +Z (south). */
export function headingToVec2(degrees, length = 1) {
  const r = (degrees * Math.PI) / 180;
  return { x: Math.cos(r) * length, z: Math.sin(r) * length };
}

export function createEnvironment() {
  return {
    time: 0,
    paused: false,

    ocean: {
      spectrum: SPECTRA.JONSWAP,
      // Three disjoint FFT tiles (metres). Large swell / wind sea / chop.
      patchSizes: [2048, 256, 32],
      cascadeWeights: [1.0, 0.72, 0.48],
      fftSize: 256,
      choppiness: 1.15,
      waveAmplitude: 0.95,
      waveSpeed: 0.92,
      timeScale: 1.0,
      steepness: 0.7,
      swell: 0.38,
      swellDirection: 78,
      secondarySwell: 0.16,
      secondarySwellDirection: 142,
      foamAmount: 0.32,
      microDetail: 0.62,
    },

    current: {
      /** Water transport speed in m/s. */
      speed: 0.7,
      /** Direction water moves TOWARD (deg). 0 = east, 90 = south. */
      direction: 90,
      /** 0..1 how strongly current advects ripples / streaks. */
      influence: 0.7,
      /** Sparse drift streaks on the surface. */
      visible: false,
    },

    wind: {
      /** Atmospheric wind speed in m/s. Drives JONSWAP energy. */
      speed: 8.2,
      /** Direction the wind blows TOWARD (deg) = wave propagation. */
      direction: 72,
      /** 0..1 mix of how strongly wind reshapes the spectrum. */
      influence: 1.0,
      fetch: 90000,
      alignment: 5.5,
    },

    sun: {
      elevation: 18,
      azimuth: 90,
      intensity: 2.2,
      color: '#ffe4b3',
    },

    water: {
      deepColor: '#08243f',
      shallowColor: '#1b8ea8',
      scatterColor: '#1a7fa0',
      roughness: 0.03,
      ior: 1.333,
      specular: 1.7,
      reflectionIntensity: 1.12,
      absorption: 0.95,
      scattering: 1.1,
    },

    atmosphere: {
      turbidity: 2.8,
      rayleigh: 1.6,
      mieCoefficient: 0.003,
      mieDirectionalG: 0.8,
      exposure: 0.35,
      fogDensity: 0.000012,
      fogColor: '#c9dcea',
    },
  };
}

export function currentVector(env) {
  return headingToVec2(env.current.direction, env.current.speed);
}

export function windVector(env) {
  return headingToVec2(env.wind.direction, env.wind.speed * env.wind.influence);
}

export function snapshot(env) {
  return JSON.parse(JSON.stringify(env));
}
