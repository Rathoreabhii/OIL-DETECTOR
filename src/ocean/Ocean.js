import * as THREE from 'three';
import { FFT } from './FFT.js';
import { HeightField } from './HeightField.js';
import { MAX_GERSTNER, buildGerstnerWaves } from './Gerstner.js';
import { WATER_VERT } from '../shaders/water.vert.js';
import { WATER_FRAG } from '../shaders/water.frag.js';
import { currentVector } from '../environment.js';

function createRadialGrid(rings = 200, segments = 280, inner = 3, outer = 32000) {
  const positions = [];
  const cols = segments + 1;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = inner * Math.pow(outer / inner, t);
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  const indices = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class Ocean {
  constructor(renderer, env) {
    this.renderer = renderer;
    this.env = env;
    this.fftSize = env.ocean.fftSize;
    this.cascades = [new FFT(renderer, this.fftSize), new FFT(renderer, this.fftSize), new FFT(renderer, this.fftSize)];
    this.heightField = new HeightField(renderer, 256, 220);
    this._offset = new THREE.Vector2();

    this.geometry = createRadialGrid();
    this.material = this._createMaterial();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;

    this.rebuildSpectrum();
  }

  _createMaterial() {
    const dummy = this.cascades[0];
    const gerstner = buildGerstnerWaves(this.env);
    const uniforms = {
      uDisp0: { value: dummy.displacementTexture },
      uDisp1: { value: dummy.displacementTexture },
      uDisp2: { value: dummy.displacementTexture },
      uDeriv0: { value: dummy.derivativesTexture },
      uDeriv1: { value: dummy.derivativesTexture },
      uDeriv2: { value: dummy.derivativesTexture },
      uPatchSizes: { value: new THREE.Vector3().fromArray(this.env.ocean.patchSizes) },
      uCascadeWeight: { value: new THREE.Vector3().fromArray(this.env.ocean.cascadeWeights) },
      uChoppiness: { value: this.env.ocean.choppiness },
      uTime: { value: 0 },
      uModelOffset: { value: this._offset },
      uGerstnerDir: { value: gerstner.dirs },
      uGerstnerParams: { value: gerstner.params },
      uRoughness: { value: this.env.water.roughness },
      uSpecular: { value: this.env.water.specular },
      uIor: { value: this.env.water.ior },
      uReflectionIntensity: { value: this.env.water.reflectionIntensity },
      uNormalScale: { value: 1 },
      uMicroDetail: { value: this.env.ocean.microDetail },
      uDeepColor: { value: new THREE.Color(this.env.water.deepColor) },
      uShallowColor: { value: new THREE.Color(this.env.water.shallowColor) },
      uScatterColor: { value: new THREE.Color(this.env.water.scatterColor) },
      uAbsorption: { value: this.env.water.absorption },
      uScattering: { value: this.env.water.scattering },
      uSunDirection: { value: new THREE.Vector3(0.4, 0.3, 0.2).normalize() },
      uSunColor: { value: new THREE.Color(this.env.sun.color) },
      uSunIntensity: { value: this.env.sun.intensity },
      uHorizonColor: { value: new THREE.Color('#d7c4a4') },
      uZenithColor: { value: new THREE.Color('#3a6ea5') },
      uCloudiness: { value: 0.62 },
      uCurrent: { value: new THREE.Vector2() },
      uCurrentInfluence: { value: this.env.current.influence },
      uHf: { value: this.heightField.texture },
      uHfOrigin: { value: this.heightField.origin },
      uHfDomain: { value: this.heightField.domain },
      uHfScale: { value: 1.15 },
      uFoamAmount: { value: this.env.ocean.foamAmount },
      uFogColor: { value: new THREE.Color(this.env.atmosphere.fogColor) },
      uFogDensity: { value: this.env.atmosphere.fogDensity },
      uExposure: { value: 1.05 },
    };

    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: false,
      depthWrite: true,
      fog: false,
      side: THREE.FrontSide,
    });
  }

  rebuildSpectrum() {
    const patches = this.env.ocean.patchSizes;
    const nyquist = (i) => (2 * Math.PI * (this.fftSize * 0.45)) / patches[i];
    const bands = [
      { kMin: 0, kMax: nyquist(0), energyShare: 0.55 },
      { kMin: nyquist(0) * 0.85, kMax: nyquist(1), energyShare: 0.32 },
      { kMin: nyquist(1) * 0.85, kMax: Infinity, energyShare: 0.18 },
    ];
    for (let i = 0; i < 3; i++) {
      this.cascades[i].patchSize = patches[i];
      this.cascades[i].buildSpectrum(
        { ocean: { ...this.env.ocean, patchSize: patches[i] }, wind: this.env.wind },
        { ...bands[i], seed: 2200 + i * 97 },
      );
    }
    this._syncGerstner();
  }

  _syncGerstner() {
    const g = buildGerstnerWaves(this.env);
    const u = this.material.uniforms;
    for (let i = 0; i < MAX_GERSTNER; i++) {
      u.uGerstnerDir.value[i].x = g.dirs[i].x;
      u.uGerstnerDir.value[i].y = g.dirs[i].y;
      u.uGerstnerParams.value[i].copy(g.params[i]);
    }
  }

  setSun(direction, color, intensity) {
    this.material.uniforms.uSunDirection.value.copy(direction);
    this.material.uniforms.uSunColor.value.copy(color);
    this.material.uniforms.uSunIntensity.value = intensity;
  }

  update(time, camera, dt = 0.016) {
    const env = this.env;
    const t = time * env.ocean.timeScale;
    const waveSpeed = env.ocean.waveSpeed;
    const r = this.renderer;
    const prevTM = r.toneMapping;
    const prevCS = r.outputColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    const cur = currentVector(env);
    const curScaled = {
      x: cur.x * env.current.influence,
      z: cur.z * env.current.influence,
    };
    for (const c of this.cascades) c.update(t, waveSpeed, curScaled);
    this.heightField.followCamera(camera);
    this.heightField.step(dt, t, curScaled, env.current.influence);
    r.toneMapping = prevTM;
    r.outputColorSpace = prevCS;

    const u = this.material.uniforms;
    u.uDisp0.value = this.cascades[0].displacementTexture;
    u.uDisp1.value = this.cascades[1].displacementTexture;
    u.uDisp2.value = this.cascades[2].displacementTexture;
    u.uDeriv0.value = this.cascades[0].derivativesTexture;
    u.uDeriv1.value = this.cascades[1].derivativesTexture;
    u.uDeriv2.value = this.cascades[2].derivativesTexture;
    u.uTime.value = t;
    u.uChoppiness.value = env.ocean.choppiness;
    u.uCascadeWeight.value.fromArray(env.ocean.cascadeWeights);
    u.uPatchSizes.value.fromArray(env.ocean.patchSizes);
    u.uMicroDetail.value = env.ocean.microDetail;
    u.uFoamAmount.value = env.ocean.foamAmount;
    u.uRoughness.value = env.water.roughness;
    u.uSpecular.value = env.water.specular;
    u.uReflectionIntensity.value = env.water.reflectionIntensity;
    u.uAbsorption.value = env.water.absorption;
    u.uScattering.value = env.water.scattering;
    u.uDeepColor.value.set(env.water.deepColor);
    u.uShallowColor.value.set(env.water.shallowColor);
    u.uScatterColor.value.set(env.water.scatterColor);
    u.uFogDensity.value = env.atmosphere.fogDensity;
    u.uFogColor.value.set(env.atmosphere.fogColor);

    u.uCurrent.value.set(cur.x, cur.z);
    u.uCurrentInfluence.value = env.current.influence;
    u.uHf.value = this.heightField.texture;
    u.uHfOrigin.value.copy(this.heightField.origin);
    u.uHfDomain.value = this.heightField.domain;

    const snap = 8;
    this._offset.set(Math.round(camera.position.x / snap) * snap, Math.round(camera.position.z / snap) * snap);
  }

  addDrop(worldX, worldZ, strength = 0.03) {
    this.heightField.addDrop(worldX, worldZ, strength);
  }

  dispose() {
    this.cascades.forEach((c) => c.dispose());
    this.heightField.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
