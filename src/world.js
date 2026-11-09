import * as THREE from "three";
import { landHeightAt, SEA_LEVEL } from "./terrain.js";
import { createSkyDome } from "./sky.js";
import { createSea } from "./sea.js";
import { createIslandField } from "./islandModels.js";

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
  cloudCount: 24,
  lowCloudCount: 8,
  cloudHalfRange: 1000,
  skyRadius: 2400,
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

// Painted clouds: a crisp flat-bottomed silhouette shaded from warm white to a
// pink underside, rather than a soft airbrushed blur. Colour and shape are two
// separate images: a single image with transparency filters its see-through
// pixels (which are black) into a dark fringe around each cloud.
function createCloudTextures() {
  const size = 512;
  const base = 330;
  const newCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    return canvas;
  };

  const shape = newCanvas();
  const shapeCtx = shape.getContext("2d");
  shapeCtx.fillStyle = "#000";
  shapeCtx.fillRect(0, 0, size, size);
  shapeCtx.beginPath();
  shapeCtx.rect(0, 0, size, base);
  shapeCtx.clip();
  shapeCtx.fillStyle = "#fff";
  for (let i = 0; i < 15; i++) {
    const t = i / 14;
    const swell = Math.sin(t * Math.PI);
    shapeCtx.beginPath();
    shapeCtx.arc(56 + t * 400, base - 18 - Math.random() * 74 * swell, 20 + swell * (30 + Math.random() * 34), 0, Math.PI * 2);
    shapeCtx.fill();
  }

  const paint = newCanvas();
  const paintCtx = paint.getContext("2d");
  const shade = paintCtx.createLinearGradient(0, base - 150, 0, base);
  shade.addColorStop(0, "#fffaf2");
  shade.addColorStop(0.55, "#fdeae6");
  shade.addColorStop(1, "#f6c3d2");
  paintCtx.fillStyle = shade;
  paintCtx.fillRect(0, 0, size, size);

  const map = new THREE.CanvasTexture(paint);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, alphaMap: new THREE.CanvasTexture(shape) };
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

// Ground colours by height relative to the sea: deep teal seabed, pale sand
// shallows and beaches, green islet tops, warm rock on steep slopes.
const GROUND_COLORS = {
  deep: new THREE.Color(0x2f9aa3),
  shallow: new THREE.Color(0xbfe6cf),
  sand: new THREE.Color(0xf6e2b8),
  grass: new THREE.Color(0x94c96a),
  grassHigh: new THREE.Color(0x7db35a),
  rock: new THREE.Color(0xd2a483),
};

function groundColor(height, steepness, target) {
  const C = GROUND_COLORS;
  if (height < SEA_LEVEL - 0.4) {
    const depth = Math.min((SEA_LEVEL - height) / 6, 1);
    return target.copy(C.shallow).lerp(C.deep, Math.pow(depth, 0.7));
  }
  if (height < SEA_LEVEL + 1.6) return target.copy(C.sand);
  target.copy(C.grass).lerp(C.grassHigh, Math.min((height - 1.6) / 25, 1));
  if (steepness > 0.32) target.lerp(C.rock, Math.min((steepness - 0.32) * 3, 1));
  return target;
}

// Builds a fresh ground mesh geometry centered at (centerX, centerZ), with
// vertex heights sampled from the terrain and coloured by height and slope.
function buildGroundGeometry(centerX, centerZ, safeZones) {
  const W = WORLD_CONSTANTS;
  const geometry = new THREE.PlaneGeometry(
    W.groundExtent,
    W.groundExtent,
    W.groundSegments,
    W.groundSegments
  );
  geometry.rotateX(-Math.PI / 2);
  geometry.deleteAttribute("uv");

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const worldX = position.getX(i) + centerX;
    const worldZ = position.getZ(i) + centerZ;
    position.setY(i, landHeightAt(worldX, worldZ, safeZones));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    groundColor(position.getY(i), 1 - normal.getY(i), color).toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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

  // --- Ground (seabed and islets) ---
  const groundMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
  });
  const ground = new THREE.Mesh(buildGroundGeometry(0, 0, []), groundMaterial);
  scene.add(ground);
  let lastGroundCenter = { x: 0, z: 0 };

  // --- Sky, sea and floating islands ---
  const sky = createSkyDome(W.skyRadius);
  scene.add(sky);
  const sea = createSea(scene, renderer);
  const islands = createIslandField(scene);

  // --- Islet trees: cherry blossoms and leafy trees, only where there's dry land ---
  const treePlacements = scatterPlacements(W.treeCount, W.featureHalfRange, 1.4, 2.6);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 6);
  trunkGeo.translate(0, 1.6, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(1.9, 0);
  canopyGeo.scale(1, 0.8, 1);
  canopyGeo.translate(0, 3.9, 0);
  const trunks = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({ color: 0x6e4a3c, flatShading: true }),
    W.treeCount
  );
  const canopies = new THREE.InstancedMesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }),
    W.treeCount
  );
  const upperCanopies = new THREE.InstancedMesh(
    canopyGeo.clone().scale(0.68, 0.7, 0.68).translate(0.5, 2.0, -0.3),
    canopies.material,
    W.treeCount
  );
  const treeTints = [0xf8b4cc, 0xf39dbb, 0xffcfe0, 0x86c066, 0x6fae58];
  const tint = new THREE.Color();
  treePlacements.forEach((p, i) => {
    tint.setHex(treeTints[i % treeTints.length]);
    canopies.setColorAt(i, tint);
    upperCanopies.setColorAt(i, tint.multiplyScalar(1.06));
  });

  // --- Rocks ---
  const rockPlacements = scatterPlacements(W.rockCount, W.featureHalfRange, 0.5, 1.4);
  const rockGeo = new THREE.DodecahedronGeometry(0.6, 0);
  rockGeo.translate(0, 0.3, 0);
  const rocks = new THREE.InstancedMesh(
    rockGeo,
    new THREE.MeshStandardMaterial({ color: 0xd8b48f, roughness: 1, flatShading: true }),
    W.rockCount
  );

  // Instances always surround the camera; whole-mesh culling would blink them out.
  for (const mesh of [trunks, canopies, upperCanopies, rocks]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // --- Clouds ---
  const cloudMaterials = [0, 1, 2].map(
    () =>
      new THREE.SpriteMaterial({
        ...createCloudTextures(),
        transparent: true,
        depthWrite: false,
        opacity: 0.94,
      })
  );
  const lowCloudMaterials = cloudMaterials.map((material) => {
    const low = material.clone();
    low.opacity = 0.78;
    return low;
  });
  const clouds = [];
  for (let i = 0; i < W.cloudCount + W.lowCloudCount; i++) {
    const low = i >= W.cloudCount;
    const sprite = new THREE.Sprite((low ? lowCloudMaterials : cloudMaterials)[i % 3]);
    const scale = low ? 140 + Math.random() * 160 : 95 + Math.random() * 120;
    sprite.scale.set(scale, scale * (low ? 0.4 : 0.6), 1);
    clouds.push({
      sprite,
      x: (Math.random() - 0.5) * 2 * W.cloudHalfRange,
      z: (Math.random() - 0.5) * 2 * W.cloudHalfRange,
      y: low ? 45 + Math.random() * 70 : 170 + Math.random() * 190,
    });
    scene.add(sprite);
  }

  const _matrix = new THREE.Matrix4();
  const _quat = new THREE.Quaternion();
  const _axisY = new THREE.Vector3(0, 1, 0);
  const _pos = new THREE.Vector3();
  const _scl = new THREE.Vector3();

  // `minHeight`/`maxHeight` limit where a feature may stand (relative to the
  // sea), e.g. trees only on dry islet ground; elsewhere it's hidden (scale 0).
  function placeInstances(mesh, placements, center, safeZones, squashY = 1, minHeight = SEA_LEVEL + 1.8, maxHeight = Infinity) {
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const worldX = wrapAround(p.x, center.x, WORLD_CONSTANTS.featureHalfRange);
      const worldZ = wrapAround(p.z, center.z, WORLD_CONSTANTS.featureHalfRange);
      const height = landHeightAt(worldX, worldZ, safeZones);
      _pos.set(worldX, height, worldZ);
      _quat.setFromAxisAngle(_axisY, p.rotY);
      const clear = height < minHeight || height > maxHeight;
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

    const time = performance.now() / 1000;
    sky.position.set(center.x, center.y, center.z);
    sea.update(center, time);
    islands.update(center, time);

    placeInstances(trunks, treePlacements, center, safeZones);
    placeInstances(canopies, treePlacements, center, safeZones);
    placeInstances(upperCanopies, treePlacements, center, safeZones);
    placeInstances(rocks, rockPlacements, center, safeZones, 0.6, SEA_LEVEL - 0.5, SEA_LEVEL + 2.5);

    for (const cloud of clouds) {
      cloud.sprite.position.set(
        wrapAround(cloud.x, center.x, W.cloudHalfRange),
        cloud.y,
        wrapAround(cloud.z, center.z, W.cloudHalfRange)
      );
    }
  }

  update({ x: 0, y: 30, z: 0 });
  return { update, islandCount: islands.count };
}
