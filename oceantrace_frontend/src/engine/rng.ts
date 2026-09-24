/**
 * OCEANTRACE — Seeded deterministic RNG (mulberry32) + gaussian.
 * PLAN §4: "deterministic (seeded RNG)". SEED = 20260820 (PLAN §3).
 */
export const SEED = 20260820;

/** mulberry32 — fast 32-bit PRNG, returns float in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded gaussian via Box–Muller (Ziggurat-lite: two uniforms per pair,
 * cached second value). Independent of mulberry32 stream reuse.
 */
export function gaussianFactory(seed: number): () => number {
  const rand = mulberry32(seed);
  let cached: number | null = null;
  return function (): number {
    if (cached !== null) { const v = cached; cached = null; return v; }
    let u = 0, v = 0, s = 0;
    do {
      u = rand() * 2 - 1;
      v = rand() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    cached = v * f;
    return u * f;
  };
}

/** Legacy helper kept for ad-hoc use: mulberry32 + polar Box–Muller. */
export function gaussian(seed: number): () => number {
  return gaussianFactory(seed);
}
