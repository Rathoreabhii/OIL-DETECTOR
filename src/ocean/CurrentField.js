import * as THREE from 'three';
import { currentVector } from '../environment.js';

/**
 * Drift streaks that move with CURRENT (water transport), not wind.
 */
export class CurrentField {
  constructor(scene, env, camera) {
    this.env = env;
    this.camera = camera;
    this.count = 900;
    this.span = 280;
    const geo = new THREE.PlaneGeometry(0.35, 6.5);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcfefff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.frustumCulled = false;
    this.mesh.visible = env.current.visible;
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
    this.pos = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) {
      this.pos[i * 2] = (Math.random() - 0.5) * this.span;
      this.pos[i * 2 + 1] = (Math.random() - 0.5) * this.span;
    }
  }

  update(dt) {
    const visible = this.env.current.visible;
    this.mesh.visible = visible;
    if (!visible) return;
    const cur = currentVector(this.env);
    const speed = Math.hypot(cur.x, cur.z);
    this.mesh.material.opacity = 0.08 + Math.min(speed, 2) * 0.08 * this.env.current.influence;
    const yaw = Math.atan2(cur.x, cur.z);
    const cx = this.camera.position.x;
    const cz = this.camera.position.z;
    const half = this.span * 0.5;
    for (let i = 0; i < this.count; i++) {
      let x = this.pos[i * 2] + cur.x * dt * 2.4;
      let z = this.pos[i * 2 + 1] + cur.z * dt * 2.4;
      if (x > half) x -= this.span;
      if (x < -half) x += this.span;
      if (z > half) z -= this.span;
      if (z < -half) z += this.span;
      this.pos[i * 2] = x;
      this.pos[i * 2 + 1] = z;
      this.dummy.position.set(cx + x, 0.35, cz + z);
      this.dummy.rotation.set(0, yaw, 0);
      const s = 0.55 + (i % 7) * 0.12;
      this.dummy.scale.set(s, 1, s * (1.4 + speed));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
