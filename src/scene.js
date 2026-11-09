import * as THREE from "three";
import { createChaseCamera } from "./chaseCamera.js";
import { createWorld } from "./world.js";
import { SKY_PALETTE, SUN_DIRECTION } from "./sky.js";

/**
 * Sets up the Three.js renderer, camera, lighting, the environment (see
 * world.js), and the third-person chase camera (see chaseCamera.js).
 * @param {HTMLCanvasElement} canvas
 */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Neutral tone mapping keeps the pastel sunset colours close to what's authored.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  // Fog colour is the sky's horizon colour (see sky.js), so distant sea,
  // islands and clouds fade into the sky with no visible line.
  scene.background = new THREE.Color(SKY_PALETTE.horizon);
  scene.fog = new THREE.Fog(SKY_PALETTE.horizon, 320, 2300);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    2700
  );
  camera.position.set(0, 32, -8);

  // Golden-hour light: warm low sun, pink sky fill, soft warm bounce lighting the islands' undersides.
  const hemiLight = new THREE.HemisphereLight(0xffe4ec, 0xc9b5a6, 2.0);
  scene.add(hemiLight);
  const dirLight = new THREE.DirectionalLight(0xffd3a1, 2.6);
  dirLight.position.copy(SUN_DIRECTION).multiplyScalar(300);
  scene.add(dirLight);

  const world = createWorld(scene, renderer);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const chase = createChaseCamera(camera);

  /** Smoothly trails the bird, swinging toward its tail on turns and dives. */
  function updateChaseCamera(flightState, dt) {
    chase.update(flightState, dt);
  }

  function render() {
    renderer.render(scene, camera);
  }

  return {
    scene,
    camera,
    renderer,
    render,
    updateChaseCamera,
    updateWorld: world.update,
    addToScene: (obj) => scene.add(obj),
  };
}
