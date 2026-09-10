import * as THREE from 'three';
import { FULLSCREEN_VERT } from '../shaders/fullscreen.vert.js';

export function createFloatRenderTarget(size, { linear = false, type = THREE.FloatType } = {}) {
  const filter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  return new THREE.WebGLRenderTarget(size, size, {
    type,
    format: THREE.RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

export class FullscreenPass {
  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(this.geometry, null);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }

  render(renderer, material, target) {
    this.mesh.material = material;
    const prev = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAuto;
  }

  dispose() {
    this.geometry.dispose();
  }
}

export function makeComputeMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    glslVersion: THREE.GLSL3,
  });
}
