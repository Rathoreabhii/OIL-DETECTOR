import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export class Atmosphere {
  constructor(scene, env) {
    this.env = env;
    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    this.sky.material.depthWrite = false;
    this.sky.material.fog = false;
    this.sky.material.toneMapped = true;
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.sunLight = new THREE.DirectionalLight(env.sun.color, env.sun.intensity);
    this.sunLight.castShadow = false;
    scene.add(this.sunLight);

    this.hemi = new THREE.HemisphereLight(0xb7d4f0, 0x2a241c, 0.45);
    scene.add(this.hemi);

    this.sun = new THREE.Vector3();
    this._sync(env);
  }

  _sync(env) {
    const phi = THREE.MathUtils.degToRad(90 - env.sun.elevation);
    const theta = THREE.MathUtils.degToRad(env.sun.azimuth);
    this.sun.setFromSphericalCoords(1, phi, theta);

    const u = this.sky.material.uniforms;
    u.turbidity.value = env.atmosphere.turbidity;
    u.rayleigh.value = env.atmosphere.rayleigh;
    u.mieCoefficient.value = env.atmosphere.mieCoefficient;
    u.mieDirectionalG.value = env.atmosphere.mieDirectionalG;
    u.sunPosition.value.copy(this.sun);

    this.sunLight.position.copy(this.sun).multiplyScalar(10000);
    this.sunLight.color.set(env.sun.color);
    this.sunLight.intensity = env.sun.intensity * 0.55;
  }

  update() {
    this._sync(this.env);
    return this.sun;
  }
}
