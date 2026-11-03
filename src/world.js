import * as THREE from "three";
import { heightAt } from "./terrain.js";

// The world is "infinite" by recycling: the ground is one grid mesh that
// recenters under the bird in large steps (see groundRebuildThreshold below),
// and trees/rocks/clouds wrap around the bird in a moving window, so there is
// always scenery nearby for motion parallax but only a fixed, cheap amount.
//
// heightAt(x, z) is a pure function of world position (src/terrain.js) — it
// doesn't know or care where the "current window" is. So recentering the
// ground never causes a seam or a jump: every vertex at a given (x, z) always
// gets exactly the same height, whether it's mesh #1's edge or mesh #40's center.

export const WORLD_CONSTANTS = {
  groundExtent: 2600, // world units across the ground mesh
  groundSegments: 200, // grid resolution (129x129 vertices)
  groundRebuildThreshold: 220, // recenter the ground once the bird strays this far
  groundTileSize: 100, // world units per texture repeat (now applied via world-space UVs)
  featureHalfRange: 650, // trees/rocks live within this distance of the bird
  treeCount: 550,
  rockCount: 80,
  cloudCount: 40,
  cloudHalfRange: 1000,
  skyRadius: 1900,
};

/**
 * Wraps a fixed feature coordinate into the moving window
 * [center - half, center + half), preserving its position modulo the window
 * size — so features scroll off one side and reappear on the other.
 */
export function wrapAround(coord, center, half) {
  const range = 2 * half;
  return coord - Math.floor((coord - center + half) / range) * range;
}

function createGrassTexture(renderer) {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#708361";
  ctx.fillRect(0, 0, size, size);

  // Low-contrast mottling; strong shapes would make the tiling repeat obvious.
  const greens = ["#6b9c4a", "#8cbb67", "#749f52", "#86b25f"];
  for (let i = 0; i < 1600; i++) {
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = greens[(Math.random() * greens.length) | 0];
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 6 + Math.random() * 22, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 8; i++) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#9b855c";
    ctx.beginPath();
    ctx.ellipse(
      Math.random() * size,
      Math.random() * size,
      15 + Math.random() * 35,
      10 + Math.random() * 25,
      Math.random() * Math.PI,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // UVs are now computed in world-space (see buildGroundGeometry), spanning
  // many tile repeats directly, so the texture's own .repeat stays at 1x1.
  return texture;
}

function createCloudTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 22; i++) {
    const x = 80 + Math.random() * 350, y = 235 + Math.random() * 90;
    const r = 35 + Math.random() * 65;
    const gradient = ctx.createRadialGradient(x, y, r * 0.3, x, y, r);
    gradient.addColorStop(0, "rgba(255,251,237,0.85)");
    gradient.addColorStop(0.65, "rgba(230,237,235,0.45)");
    gradient.addColorStop(1, "rgba(213,230,234,0)");
    ctx.fillStyle = gradient; ctx.fillRect(x-r,y-r,r*2,r*2);
  }
  return new THREE.CanvasTexture(canvas);
}

function createSkyDome() {
  const geometry = new THREE.SphereGeometry(WORLD_CONSTANTS.skyRadius, 20, 14);
  const zenith = new THREE.Color(0x3479a5);
  const horizon = new THREE.Color(0xcbdedc);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const t = Math.max(positions.getY(i) / WORLD_CONSTANTS.skyRadius, 0);
    c.copy(horizon).lerp(zenith, Math.pow(t, 0.7));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false, // the dome IS the far distance; fogging it would blank it out
    depthWrite: false,
  });
  const dome = new THREE.Mesh(geometry, material);
  dome.renderOrder = -1;
  return dome;
}

// Scatters per-instance placement data (fixed world coords that get wrapped).
function scatterPlacements(count, half, scaleMin, scaleMax) {
  const placements = [];
  for (let i = 0; i < count; i++) {
    placements.push({
      x: (Math.random() - 0.5) * 2 * half,
      z: (Math.random() - 0.5) * 2 * half,
      scale: scaleMin + Math.random() * (scaleMax - scaleMin),
      rotY: Math.random() * Math.PI * 2,
    });
  }
  return placements;
}

// Builds a fresh ground mesh geometry centered at (centerX, centerZ), with
// vertex heights sampled from the terrain and UVs computed in world-space so
// the grass texture tiles consistently no matter where the grid is centered.
function buildGroundGeometry(centerX, centerZ, safeZones) {
  const W = WORLD_CONSTANTS;
  const geometry = new THREE.PlaneGeometry(
    W.groundExtent,
    W.groundExtent,
    W.groundSegments,
    W.groundSegments
  );
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    const worldX = position.getX(i) + centerX;
    const worldZ = position.getZ(i) + centerZ;
    position.setY(i, heightAt(worldX, worldZ, safeZones));
    uv.setXY(i, worldX / W.groundTileSize, worldZ / W.groundTileSize);
  }
  position.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Builds the environment (ground, trees, rocks, clouds, sky) and returns an
 * update(center, safeZones) that keeps it wrapped around the bird each frame.
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 */
export function createWorld(scene, renderer) {
  const W = WORLD_CONSTANTS;

  // --- Ground ---
  const groundMaterial = new THREE.MeshStandardMaterial({
    map: createGrassTexture(renderer),
    roughness: 1,
  });
  const ground = new THREE.Mesh(buildGroundGeometry(0, 0, []), groundMaterial);
  scene.add(ground);
  let lastGroundCenter = { x: 0, z: 0 };

  // --- Sky dome ---
  const sky = createSkyDome();
  scene.add(sky);

  const mountains = new THREE.Group();
  const mountainGeo = new THREE.ConeGeometry(1, 1, 17, 9);
  const mp = mountainGeo.attributes.position;
  for (let i = 0; i < mp.count; i++) {
    const y = mp.getY(i);
    const ripple = 1 + 0.24 * Math.sin(mp.getX(i) * 21 + mp.getZ(i) * 15 + y * 12);
    mp.setX(i, mp.getX(i) * ripple); mp.setZ(i, mp.getZ(i) * ripple);
  }
  mountainGeo.computeVertexNormals();
  const mountainColors = new Float32Array(mp.count * 3);
  for (let i = 0; i < mp.count; i++) {
    const snowLine = 0.18 + Math.sin(mp.getX(i)*25 + mp.getZ(i)*17)*0.06;
    const color = new THREE.Color(mp.getY(i) > snowLine ? 0xe3e7df : mp.getY(i) > -0.15 ? 0x78888a : 0x506f66);
    color.toArray(mountainColors, i*3);
  }
  mountainGeo.setAttribute("color", new THREE.BufferAttribute(mountainColors,3));
  const mountainMat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:1 });
  for (let i = 0; i < 30; i++) {
    const angle = i / 30 * Math.PI * 2;
    const peak = new THREE.Mesh(mountainGeo,mountainMat);
    const height = 180 + (Math.sin(i*7.3)*0.5+0.5)*230;
    peak.scale.set(180 + (i%4)*45,height,170 + (i%3)*45);
    peak.position.set(Math.cos(angle)*1450,height/2-35,Math.sin(angle)*1450);
    peak.rotation.y = i*2.4; mountains.add(peak);
  }
  scene.add(mountains);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({map:createCloudTexture(),color:0xffecc1,transparent:true,opacity:0.45,depthWrite:false,fog:false}));
  sun.scale.set(460,460,1); scene.add(sun);

  // --- Trees: trunk + canopy instanced meshes sharing the same transforms ---
  const treePlacements = scatterPlacements(W.treeCount, W.featureHalfRange, 5.0, 11.0);
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.0, 6);
  trunkGeo.translate(0, 0.5, 0);
  const canopyGeo = new THREE.ConeGeometry(0.9, 2.0, 7);
  canopyGeo.translate(0, 1.9, 0);
  const trunks = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({ color: 0x7a5230 }),
    W.treeCount
  );
  const canopies = new THREE.InstancedMesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({ color: 0x284e3e }),
    W.treeCount
  );

  const upperCanopies = new THREE.InstancedMesh(canopyGeo.clone(), new THREE.MeshStandardMaterial({ color: 0x365e46 }), W.treeCount);
  upperCanopies.geometry.scale(0.75, 0.85, 0.75);
  upperCanopies.geometry.translate(0, 0.9, 0);

  // --- Rocks ---
  const rockPlacements = scatterPlacements(W.rockCount, W.featureHalfRange, 0.5, 1.4);
  const rockGeo = new THREE.DodecahedronGeometry(0.6, 0);
  rockGeo.translate(0, 0.3, 0);
  const rocks = new THREE.InstancedMesh(
    rockGeo,
    new THREE.MeshStandardMaterial({ color: 0x8d8d8d, roughness: 1 }),
    W.rockCount
  );

  // Instances always surround the camera; whole-mesh culling would blink them out.
  for (const mesh of [trunks, canopies, upperCanopies, rocks]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // --- Clouds ---
  const cloudMaterial = new THREE.SpriteMaterial({
    map: createCloudTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  });
  const clouds = [];
  for (let i = 0; i < W.cloudCount; i++) {
    const sprite = new THREE.Sprite(cloudMaterial);
    const scale = 95 + Math.random() * 120;
    sprite.scale.set(scale, scale * 0.6, 1);
    clouds.push({
      sprite,
      x: (Math.random() - 0.5) * 2 * W.cloudHalfRange,
      z: (Math.random() - 0.5) * 2 * W.cloudHalfRange,
      y: 160 + Math.random() * 180,
    });
    scene.add(sprite);
  }

  const _matrix = new THREE.Matrix4();
  const _quat = new THREE.Quaternion();
  const _axisY = new THREE.Vector3(0, 1, 0);
  const _pos = new THREE.Vector3();
  const _scl = new THREE.Vector3();

  function placeInstances(mesh, placements, center, safeZones, squashY = 1) {
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const worldX = wrapAround(p.x, center.x, WORLD_CONSTANTS.featureHalfRange);
      const worldZ = wrapAround(p.z, center.z, WORLD_CONSTANTS.featureHalfRange);
      _pos.set(worldX, heightAt(worldX, worldZ, safeZones), worldZ);
      _quat.setFromAxisAngle(_axisY, p.rotY);
      const clear = safeZones.some(zone => Math.hypot(worldX-zone.x,worldZ-zone.z) < Math.min(zone.radius, 28));
      const scale = clear ? 0 : p.scale;
      _scl.set(scale, scale * squashY, scale);
      _matrix.compose(_pos, _quat, _scl);
      mesh.setMatrixAt(i, _matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Keeps the whole environment wrapped around the given center (bird
   * position). `safeZones` (terrain.js zones — spawn point, active checkpoints)
   * are threaded through to both the ground mesh and scenery placement so nothing
   * sits inside a flattened checkpoint zone.
   *
   * @param {boolean} [force] - rebuild the ground mesh immediately regardless
   *        of distance moved. Used right after choosing a mode (e.g. Time
   *        Trial), so newly-active checkpoint safe zones are reflected in the
   *        visible ground right away rather than waiting for the bird to
   *        wander groundRebuildThreshold units — a checkpoint can be closer
   *        to spawn than that threshold, and collision is always correct
   *        either way (flight.js calls heightAt directly), but the ground
   *        mesh itself would otherwise lag visually until the next rebuild.
   */
  function update(center, safeZones = [], force = false) {
    // Rebuild the ground mesh only when the bird has strayed far from the last
    // build center — cheap enough to do in one frame, no need every frame.
    const distFromLastBuild = Math.hypot(
      center.x - lastGroundCenter.x,
      center.z - lastGroundCenter.z
    );
    if (force || distFromLastBuild > W.groundRebuildThreshold) {
      const oldGeometry = ground.geometry;
      ground.geometry = buildGroundGeometry(center.x, center.z, safeZones);
      oldGeometry.dispose();
      ground.position.set(center.x, 0, center.z);
      lastGroundCenter = { x: center.x, z: center.z };
    }

    sky.position.set(center.x, center.y, center.z);
    mountains.position.set(center.x, 0, center.z);
    sun.position.set(center.x - 500, 620, center.z + 1050);

    placeInstances(trunks, treePlacements, center, safeZones);
    placeInstances(canopies, treePlacements, center, safeZones);
    placeInstances(upperCanopies, treePlacements, center, safeZones);
    placeInstances(rocks, rockPlacements, center, safeZones, 0.6);

    for (const cloud of clouds) {
      cloud.sprite.position.set(
        wrapAround(cloud.x, center.x, W.cloudHalfRange),
        cloud.y,
        wrapAround(cloud.z, center.z, W.cloudHalfRange)
      );
    }
  }

  update({ x: 0, y: 30, z: 0 });
  return { update };
}
