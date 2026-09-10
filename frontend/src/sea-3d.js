/**
 * Sea-tab 3D hulls. Orthographic, pixel-aligned with the 2D overlay.
 * Shared placeholder GLB — not type-accurate tankers.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const HULL_URL = "/ships/hull.glb";
const TANKER_PX = 210;
const TYPE_SCALE = {
  oil_tanker: 1,
  product_tanker: 0.88,
  chemical_tanker: 0.84,
  cargo: 0.78,
  passenger: 0.74,
  fishing: 0.48,
  other: 0.56,
};

function typeScale(type) {
  return TYPE_SCALE[String(type || "other")] || TYPE_SCALE.other;
}

function normalizeRoot(object) {
  const wrap = new THREE.Group();
  wrap.add(object);
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  object.position.sub(center);
  object.position.y -= box.min.y - center.y;
  const longest = Math.max(size.x, size.z, 0.001);
  wrap.scale.setScalar(1 / longest);
  wrap.updateMatrixWorld(true);
  return wrap;
}

export function createSea3d(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 800, 0);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xd7e6f0, 0x152028, 1.15));
  const sun = new THREE.DirectionalLight(0xfff4e4, 1.55);
  sun.position.set(-40, 120, 30);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8eb4c8, 0.45);
  fill.position.set(50, 60, -40);
  scene.add(fill);

  const ships = new Map();
  let proto = null;
  let ready = false;
  let failed = false;

  const loader = new GLTFLoader();
  const loadPromise = new Promise((resolve) => {
    loader.load(
      HULL_URL,
      (gltf) => {
        proto = normalizeRoot(gltf.scene);
        proto.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = false;
            node.receiveShadow = false;
            if (node.material) {
              node.material.side = THREE.DoubleSide;
              node.material.metalness = Math.min(node.material.metalness ?? 0.3, 0.45);
            }
          }
        });
        ready = true;
        resolve(true);
      },
      undefined,
      () => {
        failed = true;
        resolve(false);
      },
    );
  });

  function size() {
    const parent = canvas.parentElement;
    const w = Math.max(1, canvas.clientWidth || parent?.clientWidth || 0);
    const h = Math.max(1, canvas.clientHeight || parent?.clientHeight || 0);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    return { w, h };
  }

  function ensureShip(key) {
    let rec = ships.get(key);
    if (rec) return rec;
    if (!proto) return null;
    const root = proto.clone(true);
    root.rotation.x = 0.18;
    scene.add(root);
    rec = { root };
    ships.set(key, rec);
    return rec;
  }

  function sync(poses, leaking, hoverKey, elapsed, freeze) {
    if (!ready || failed) return false;
    const { w, h } = size();
    if (w <= 1 || h <= 1) return false;
    const live = new Set();
    for (const row of poses) {
      const rec = ensureShip(row.key);
      if (!rec) continue;
      live.add(row.key);
      const seed = row.i * 1.7;
      const wobble = freeze ? 0 : Math.sin(elapsed * 1.2 + seed) * 0.03;
      const bob = freeze ? 0 : Math.sin(elapsed * 0.95 + seed * 1.3) * 4;
      rec.root.position.set(row.pose.x - w / 2, bob, row.pose.y - h / 2);
      rec.root.rotation.set(0.18, -row.pose.rad, wobble);
      const boost = leaking.has(row.key) || hoverKey === row.key ? 1.06 : 1;
      rec.root.scale.setScalar(TANKER_PX * typeScale(row.vessel.type) * boost);
    }
    for (const [key, rec] of ships) {
      if (live.has(key)) continue;
      scene.remove(rec.root);
      ships.delete(key);
    }
    renderer.render(scene, camera);
    return true;
  }

  function clear() {
    for (const rec of ships.values()) scene.remove(rec.root);
    ships.clear();
    renderer.clear();
  }

  return {
    loadPromise,
    isReady() {
      return ready && !failed;
    },
    failed() {
      return failed;
    },
    sync,
    clear,
    resize: size,
    dispose() {
      clear();
      renderer.dispose();
    },
  };
}
