import * as THREE from 'three';
import { createFloatRenderTarget, FullscreenPass, makeComputeMaterial } from '../utils/GPUCompute.js';
import { SPECTRUM_UPDATE, BUTTERFLY, PERMUTATION } from '../shaders/fftKernels.js';
import { spectrumVariance, gaussianPair, mulberry32, GRAVITY } from './Spectra.js';

export class FFT {
  constructor(renderer, size) {
    this.renderer = renderer;
    this.pass = new FullscreenPass();
    this.patchSize = 200;
    this.loopPeriod = 200;
    this.setSize(size);
  }

  setSize(size) {
    this.N = size;
    this.stages = Math.log2(size);
    if (!Number.isInteger(this.stages)) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this._disposeTargets();
    this.ping = [createFloatRenderTarget(size), createFloatRenderTarget(size)];
    this.displacementTarget = createFloatRenderTarget(size, {
      linear: true,
      type: THREE.HalfFloatType,
    });
    this.derivativesTarget = createFloatRenderTarget(size, {
      linear: true,
      type: THREE.HalfFloatType,
    });
    this.butterflyTexture = this._buildButterflyTexture(size);
    this.h0Texture = new THREE.DataTexture(
      new Float32Array(size * size * 4),
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.h0Texture.minFilter = THREE.NearestFilter;
    this.h0Texture.magFilter = THREE.NearestFilter;
    this.h0Texture.wrapS = THREE.RepeatWrapping;
    this.h0Texture.wrapT = THREE.RepeatWrapping;
    this.h0Texture.colorSpace = THREE.NoColorSpace;
    this.h0Texture.needsUpdate = true;
    this._buildMaterials();
  }

  _buildMaterials() {
    this.spectrumMat = makeComputeMaterial(SPECTRUM_UPDATE, {
      uH0: { value: this.h0Texture },
      uTime: { value: 0 },
      uN: { value: this.N },
      uL: { value: 200 },
      uWaveSpeed: { value: 1 },
      uCurrent: { value: new THREE.Vector2() },
      uTarget: { value: 0 },
    });
    this.butterflyMat = makeComputeMaterial(BUTTERFLY, {
      uButterfly: { value: this.butterflyTexture },
      uSource: { value: null },
      uStage: { value: 0 },
      uDirection: { value: 0 },
    });
    this.permutationMat = makeComputeMaterial(PERMUTATION, {
      uSource: { value: null },
      uN: { value: this.N },
    });
  }

  _buildButterflyTexture(N) {
    const stages = Math.log2(N);
    const data = new Float32Array(stages * N * 4);
    const bitReversed = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < stages; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      bitReversed[i] = r;
    }
    for (let stage = 0; stage < stages; stage++) {
      for (let y = 0; y < N; y++) {
        const k = (y * (N >> (stage + 1))) % N;
        const angle = (2 * Math.PI * k) / N;
        const span = 1 << stage;
        const topWing = y % (1 << (stage + 1)) < span;
        let ia;
        let ib;
        if (stage === 0) {
          if (topWing) {
            ia = bitReversed[y];
            ib = bitReversed[y + 1];
          } else {
            ia = bitReversed[y - 1];
            ib = bitReversed[y];
          }
        } else if (topWing) {
          ia = y;
          ib = y + span;
        } else {
          ia = y - span;
          ib = y;
        }
        const idx = (stage + y * stages) * 4;
        data[idx] = Math.cos(angle);
        data[idx + 1] = Math.sin(angle);
        data[idx + 2] = ia;
        data[idx + 3] = ib;
      }
    }
    const tex = new THREE.DataTexture(data, stages, N, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Seed h0(k) from the wind-driven spectrum. Current does NOT enter here.
   * kMin / kMax band-limit this cascade so the three tiles don't share energy.
   */
  buildSpectrum({ ocean, wind }, { kMin = 0, kMax = Infinity, seed = 1337, energyShare = 1 } = {}) {
    const N = this.N;
    const L = (this.patchSize = ocean.patchSize);
    const data = this.h0Texture.image.data;
    const rng = mulberry32(seed);
    const windSpeed = Math.max(0.8, wind.speed * wind.influence);
    const params = {
      windSpeed,
      windDirRad: (wind.direction * Math.PI) / 180,
      fetch: wind.fetch,
      spreadExp: wind.alignment,
      amplitude: 1,
    };
    const twoPiOverL = (2 * Math.PI) / L;

    const ampOf = (m, n) => {
      const kx = twoPiOverL * m;
      const kz = twoPiOverL * n;
      const k = Math.hypot(kx, kz);
      if (k < kMin || k >= kMax) return 0;
      let s = spectrumVariance(ocean.spectrum, kx, kz, params);
      if (!Number.isFinite(s) || s < 0) s = 0;
      return Math.sqrt(s * 0.5);
    };

    let sumSq = 0;
    for (let y = 0; y < N; y++) {
      const n = y - N / 2;
      for (let x = 0; x < N; x++) {
        const m = x - N / 2;
        const a = ampOf(m, n);
        const am = ampOf(-m, -n);
        const [gr, gi] = gaussianPair(rng);
        const [gr2, gi2] = gaussianPair(rng);
        const idx = (x + y * N) * 4;
        data[idx] = a * gr;
        data[idx + 1] = a * gi;
        data[idx + 2] = am * gr2;
        data[idx + 3] = am * gi2;
        sumSq += data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
      }
    }

    const sigma = Math.sqrt(2 * sumSq) || 1e-6;
    const Hs = 4 * sigma;
    const HsTarget =
      THREE.MathUtils.clamp((0.21 * (windSpeed * windSpeed)) / GRAVITY, 0.04, 10) *
      ocean.waveAmplitude *
      energyShare;
    const scale = HsTarget / Hs;
    for (let i = 0; i < data.length; i++) data[i] *= scale;

    this.h0Texture.needsUpdate = true;
    const kMinPatch = twoPiOverL;
    this.loopPeriod = (2 * Math.PI) / Math.sqrt(GRAVITY * kMinPatch);
    this.spectrumMat.uniforms.uL.value = L;
  }

  update(time, waveSpeed, currentXZ = { x: 0, z: 0 }) {
    this.spectrumMat.uniforms.uTime.value = time;
    this.spectrumMat.uniforms.uWaveSpeed.value = waveSpeed;
    this.spectrumMat.uniforms.uCurrent.value.set(currentXZ.x, currentXZ.z);
    this._transformField(0, this.displacementTarget);
    this._transformField(1, this.derivativesTarget);
  }

  _transformField(target, outputTarget) {
    const r = this.renderer;
    this.spectrumMat.uniforms.uTarget.value = target;
    this.pass.render(r, this.spectrumMat, this.ping[0]);
    let src = 0;
    for (let dir = 0; dir < 2; dir++) {
      this.butterflyMat.uniforms.uDirection.value = dir;
      for (let stage = 0; stage < this.stages; stage++) {
        this.butterflyMat.uniforms.uStage.value = stage;
        this.butterflyMat.uniforms.uSource.value = this.ping[src].texture;
        this.pass.render(r, this.butterflyMat, this.ping[1 - src]);
        src = 1 - src;
      }
    }
    this.permutationMat.uniforms.uSource.value = this.ping[src].texture;
    this.pass.render(r, this.permutationMat, outputTarget);
  }

  get displacementTexture() {
    return this.displacementTarget.texture;
  }
  get derivativesTexture() {
    return this.derivativesTarget.texture;
  }

  _disposeTargets() {
    [this.ping?.[0], this.ping?.[1], this.displacementTarget, this.derivativesTarget].forEach(
      (rt) => rt && rt.dispose(),
    );
  }

  dispose() {
    this._disposeTargets();
    this.butterflyTexture?.dispose();
    this.h0Texture?.dispose();
    this.pass.dispose();
  }
}
