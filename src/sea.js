import * as THREE from "three";
import { SEA_LEVEL } from "./terrain.js";

// A turquoise sea at SEA_LEVEL that follows the bird. Slightly see-through, so
// sandy shallows around islets show as lighter lagoons. A scrolling,
// seamlessly tiling ripple normal map catches the low sun as golden sparkles.

const SEA_SIZE = 7000; // reaches past the fog, so its edge is never seen
const RIPPLE_TILE = 45; // world units per normal-map repeat

// Sum of sine waves with whole-number frequencies, so the map tiles seamlessly.
function createRippleNormalMap() {
  const size = 256;
  const waves = [];
  let seed = 7;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // Broad swells plus many fine ripples, so sun glints break into small sparkles up close.
  for (let i = 0; i < 26; i++) {
    const reach = i < 8 ? 10 : 40;
    const kx = Math.round((rand() - 0.5) * reach) || 1;
    const ky = Math.round((rand() - 0.5) * reach) || 2;
    waves.push({ kx, ky, phase: rand() * Math.PI * 2, amp: Math.pow(Math.hypot(kx, ky), -1.25) });
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const a = (2 * Math.PI * (w.kx * x + w.ky * y)) / size + w.phase;
        const c = Math.cos(a) * w.amp;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const nx = -dx * 0.16;
      const ny = -dy * 0.16;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.repeat.set(SEA_SIZE / RIPPLE_TILE, SEA_SIZE / RIPPLE_TILE);
  texture.needsUpdate = true;
  return texture;
}

export function createSea(scene, renderer) {
  const normalMap = createRippleNormalMap();
  if (renderer) normalMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const material = new THREE.MeshPhongMaterial({
    color: 0x34c3bd,
    specular: 0xf2d6ae,
    shininess: 240,
    normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    transparent: true,
    opacity: 0.84,
    depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(geometry, material);
  sea.position.y = SEA_LEVEL;
  sea.renderOrder = 1; // after the opaque world, before other see-through things
  sea.frustumCulled = false;
  scene.add(sea);

  function update(center, time) {
    // Snap to whole ripple tiles so the ripples stay fixed in the world as the sea follows the bird.
    sea.position.x = Math.round(center.x / RIPPLE_TILE) * RIPPLE_TILE;
    sea.position.z = Math.round(center.z / RIPPLE_TILE) * RIPPLE_TILE;
    normalMap.offset.set(time * 0.006, time * 0.011);
  }

  return { update, mesh: sea };
}
