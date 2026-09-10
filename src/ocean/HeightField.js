import * as THREE from 'three';
import { createFloatRenderTarget, FullscreenPass, makeComputeMaterial } from '../utils/GPUCompute.js';
import { HF_UPDATE, HF_DROP } from '../shaders/heightField.js';

/**
 * 2D wave-equation height field (GPU).
 * Milder than pool demos: high damping, weak forcing, current-advected.
 */
export class HeightField {
  constructor(renderer, size = 256, domain = 220) {
    this.renderer = renderer;
    this.size = size;
    this.domain = domain;
    this.pass = new FullscreenPass();
    this.ping = [
      createFloatRenderTarget(size),
      createFloatRenderTarget(size),
    ];
    for (const rt of this.ping) {
      rt.texture.wrapS = THREE.ClampToEdgeWrapping;
      rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    }
    this.src = 0;
    this.origin = new THREE.Vector2();

    this.updateMat = makeComputeMaterial(HF_UPDATE, {
      uState: { value: null },
      uCurrent: { value: new THREE.Vector2() },
      uDt: { value: 0.016 },
      uDomain: { value: domain },
      uSpeed: { value: 0.22 },
      uDamping: { value: 0.985 },
      uTime: { value: 0 },
      uForce: { value: 0 },
      uN: { value: size },
    });

    this.dropMat = makeComputeMaterial(HF_DROP, {
      uState: { value: null },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uRadius: { value: 0.045 },
      uStrength: { value: 0.035 },
    });
  }

  get texture() {
    return this.ping[this.src].texture;
  }

  step(dt, time, current, influence) {
    const r = this.renderer;
    const prevTM = r.toneMapping;
    const prevCS = r.outputColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;

    const u = this.updateMat.uniforms;
    u.uState.value = this.ping[this.src].texture;
    u.uCurrent.value.set(current.x, current.z);
    u.uDt.value = Math.min(dt, 0.033);
    u.uTime.value = time;
    u.uForce.value = 0.018 * influence * Math.min(Math.hypot(current.x, current.z), 2.0);
    this.pass.render(r, this.updateMat, this.ping[1 - this.src]);
    this.src = 1 - this.src;

    r.toneMapping = prevTM;
    r.outputColorSpace = prevCS;
  }

  addDrop(worldX, worldZ, strength = 0.035) {
    const uvx = (worldX - this.origin.x) / this.domain + 0.5;
    const uvz = (worldZ - this.origin.y) / this.domain + 0.5;
    if (uvx < 0.02 || uvx > 0.98 || uvz < 0.02 || uvz > 0.98) return;

    const r = this.renderer;
    const prevTM = r.toneMapping;
    const prevCS = r.outputColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;

    this.dropMat.uniforms.uState.value = this.ping[this.src].texture;
    this.dropMat.uniforms.uCenter.value.set(uvx, uvz);
    this.dropMat.uniforms.uStrength.value = strength;
    this.pass.render(r, this.dropMat, this.ping[1 - this.src]);
    this.src = 1 - this.src;

    r.toneMapping = prevTM;
    r.outputColorSpace = prevCS;
  }

  followCamera(camera) {
    const snap = 4;
    this.origin.set(
      Math.round(camera.position.x / snap) * snap,
      Math.round(camera.position.z / snap) * snap,
    );
  }

  dispose() {
    this.ping.forEach((rt) => rt.dispose());
    this.pass.dispose();
  }
}
