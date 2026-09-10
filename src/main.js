import * as THREE from 'three';
import { createEnvironment } from './environment.js';
import { createCamera, clampCamera, DEFAULT_VIEW } from './camera.js';
import { Ocean } from './ocean/Ocean.js';
import { CurrentField } from './ocean/CurrentField.js';
import { Atmosphere } from './sky/Atmosphere.js';
import { createGui } from './gui.js';

const canvas = document.getElementById('canvas');
const loader = document.getElementById('loader');
const errorBox = document.getElementById('error');

function fail(err) {
  console.error(err);
  if (loader) loader.style.display = 'none';
  if (errorBox) {
    errorBox.style.display = 'block';
    errorBox.textContent = String(err && err.stack ? err.stack : err);
  }
}

window.addEventListener('error', (e) => fail(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => fail(e.reason));

try {
  const env = createEnvironment();
  window.environment = env;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
    alpha: false,
  });
  renderer.debug.checkShaderErrors = true;
  const gl = renderer.getContext();
  const _compile = gl.compileShader.bind(gl);
  gl.compileShader = (shader) => {
    _compile(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      fail(gl.getShaderInfoLog(shader));
    }
  };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x6a93c4, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = env.atmosphere.exposure;
  renderer.autoClear = true;

  if (!renderer.capabilities.isWebGL2) {
    throw new Error('WebGL2 is required for the ocean renderer.');
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#6a93c4');
  scene.fog = null;

  const { camera, controls } = createCamera(canvas);
  const atmosphere = new Atmosphere(scene, env);

  const ocean = new Ocean(renderer, env);
  scene.add(ocean.mesh);

  const currentField = new CurrentField(scene, env, camera);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let downX = 0;
  let downY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 7) return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(waterPlane, hit)) {
      ocean.addDrop(hit.x, hit.z, 0.028);
    }
  });

  createGui(env, {
    onWindChange: () => ocean.rebuildSpectrum(),
    onResetCamera: () => {
      camera.position.copy(DEFAULT_VIEW.position);
      controls.target.copy(DEFAULT_VIEW.target);
      controls.update();
    },
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  let simTime = 0;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!env.paused) {
      simTime += dt;
      env.time = simTime;
    }

    renderer.toneMappingExposure = env.atmosphere.exposure;

    const sunDir = atmosphere.update();
    ocean.setSun(sunDir, ocean.material.uniforms.uSunColor.value.set(env.sun.color), env.sun.intensity);
    ocean.update(simTime, camera, dt);
    currentField.update(dt);
    clampCamera(camera, controls);
    controls.update();
    renderer.render(scene, camera);
  }

  loader.style.display = 'none';
  frame();
} catch (err) {
  fail(err);
}
