import { SPECTRA } from '../environment.js';

export const GRAVITY = 9.81;

export function gaussianPair(rng) {
  const u1 = Math.max(rng(), 1e-7);
  const u2 = rng();
  const r = Math.sqrt(-2.0 * Math.log(u1));
  const t = 2.0 * Math.PI * u2;
  return [r * Math.cos(t), r * Math.sin(t)];
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function directionalSpread(kx, kz, windDirRad, s) {
  const kLen = Math.hypot(kx, kz);
  if (kLen < 1e-8) return 0;
  const wx = Math.cos(windDirRad);
  const wz = Math.sin(windDirRad);
  const cosTheta = (kx * wx + kz * wz) / kLen;
  const lobe = Math.pow(Math.max(cosTheta, 0), 2 * s);
  const back = 0.08 * Math.pow(Math.max(-cosTheta, 0), 2 * s);
  return lobe + back;
}

function phillips(kx, kz, p) {
  const k2 = kx * kx + kz * kz;
  if (k2 < 1e-12) return 0;
  const k = Math.sqrt(k2);
  const L = (p.windSpeed * p.windSpeed) / GRAVITY;
  const l = L * 0.0015;
  const dir = directionalSpread(kx, kz, p.windDirRad, p.spreadExp);
  const damp = Math.exp(-k2 * l * l);
  const main = Math.exp(-1 / (k2 * L * L)) / (k2 * k2);
  return p.amplitude * main * dir * damp;
}

function piersonMoskowitz(kx, kz, p) {
  const k = Math.hypot(kx, kz);
  if (k < 1e-6) return 0;
  const omega = Math.sqrt(GRAVITY * k);
  const omegaP = GRAVITY / (1.026 * p.windSpeed);
  const Sw =
    (0.0081 * GRAVITY * GRAVITY) / Math.pow(omega, 5) * Math.exp(-1.25 * Math.pow(omegaP / omega, 4));
  const dwdk = 0.5 * Math.sqrt(GRAVITY / k);
  const dir = directionalSpread(kx, kz, p.windDirRad, p.spreadExp);
  return p.amplitude * ((Sw * dwdk) / k) * dir;
}

function jonswap(kx, kz, p) {
  const k = Math.hypot(kx, kz);
  if (k < 1e-6) return 0;
  const omega = Math.sqrt(GRAVITY * k);
  const V = Math.max(p.windSpeed, 0.8);
  const F = Math.max(p.fetch, 1);
  const dimless = (GRAVITY * F) / (V * V);
  const alpha = 0.076 * Math.pow(dimless, -0.22);
  const omegaP = 22.0 * Math.pow((GRAVITY * GRAVITY) / (V * F), 1 / 3);
  const sigma = omega <= omegaP ? 0.07 : 0.09;
  const r = Math.exp(-((omega - omegaP) ** 2) / (2 * sigma * sigma * omegaP * omegaP));
  const Sw =
    ((alpha * GRAVITY * GRAVITY) / Math.pow(omega, 5)) *
    Math.exp(-1.25 * Math.pow(omegaP / omega, 4)) *
    Math.pow(3.3, r);
  const dwdk = 0.5 * Math.sqrt(GRAVITY / k);
  const dir = directionalSpread(kx, kz, p.windDirRad, p.spreadExp);
  return p.amplitude * ((Sw * dwdk) / k) * dir;
}

export function spectrumVariance(name, kx, kz, params) {
  switch (name) {
    case SPECTRA.PHILLIPS:
      return phillips(kx, kz, params);
    case SPECTRA.PIERSON_MOSKOWITZ:
      return piersonMoskowitz(kx, kz, params);
    case SPECTRA.JONSWAP:
    default:
      return jonswap(kx, kz, params);
  }
}
