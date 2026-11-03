import * as THREE from "three";
import { createChaseCamera } from "./chaseCamera.js";
import { createWorld } from "./world.js";

/**
 * Sets up the Three.js renderer, camera, lighting, the environment (see
 * world.js), and the third-person chase camera (see chaseCamera.js).
 * @param {HTMLCanvasElement} canvas
 */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  // Fog color matches the sky dome's horizon color so distant ground and
  // scenery blend into the sky instead of ending at a hard line.
  const horizonColor = 0xcbdedc;
  scene.background = new THREE.Color(horizonColor);
  scene.fog = new THREE.Fog(horizonColor, 250, 2100);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    2400
  );
  camera.position.set(0, 32, -8);

  const hemiLight = new THREE.HemisphereLight(0xc9e7ff, 0x455338, 2.0);
  scene.add(hemiLight);
  const dirLight = new THREE.DirectionalLight(0xffe4b7, 2.5);
  dirLight.position.set(60, 120, 40);
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
