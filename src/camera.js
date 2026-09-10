import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const DEFAULT_VIEW = {
  // Look NORTH (‑Z). Sun sits to the RIGHT (+X), not in the lens.
  position: new THREE.Vector3(0, 380, 1200),
  target: new THREE.Vector3(80, 0, -1600),
};

export function createCamera(canvas) {
  const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 1, 2000000);
  camera.position.copy(DEFAULT_VIEW.position);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(DEFAULT_VIEW.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.minDistance = 20;
  controls.maxDistance = 28000;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enablePan = true;
  controls.update();

  return { camera, controls };
}

export function clampCamera(camera, controls) {
  if (camera.position.y < 8) camera.position.y = 8;
  if (controls.target.y < 0) controls.target.y = 0;
  if (controls.target.y > 40) controls.target.y = 40;
}
