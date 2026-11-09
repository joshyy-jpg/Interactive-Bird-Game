import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PETAL_CONSTANTS, edgeMarker } from "./petals.js";

// Draws the sky petals from petals.js: a crisp, angular blossom that always
// faces the camera, inside a slowly turning gold hexagon with a soft glow.
// Unlit and unfogged, so a petal stays bright against the pastel sky.

const FLOWER_SIZE = 5;
const BURST_COUNT = 16;
const BURST_LIFE = 0.9; // seconds

// One angular blossom petal with a notched tip, base at the origin, pointing +y.
function createPetalShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.42, 0.5);
  s.lineTo(0.3, 0.92);
  s.lineTo(0.08, 1);
  s.lineTo(0, 0.84);
  s.lineTo(-0.08, 1);
  s.lineTo(-0.3, 0.92);
  s.lineTo(-0.42, 0.5);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

function tinted(geometry, hex) {
  const color = new THREE.Color().setHex(hex);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function createFlowerGeometry() {
  const pieces = [];
  for (const [scale, z, hex, turn] of [
    [1, 0, 0xf58fb6, 0],
    [0.66, 0.08, 0xffd3e3, Math.PI / 5],
  ]) {
    for (let i = 0; i < 5; i++) {
      const petal = createPetalShape();
      petal.scale(scale, scale, 1);
      petal.rotateZ(turn + (i / 5) * Math.PI * 2);
      petal.translate(0, 0, z);
      pieces.push(tinted(petal, hex));
    }
  }
  const heart = new THREE.CircleGeometry(0.17, 6);
  heart.translate(0, 0, 0.16);
  pieces.push(tinted(heart, 0xf9b93b));
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

function createGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, "rgba(255,226,190,0.95)");
  glow.addColorStop(0.4, "rgba(255,170,190,0.4)");
  glow.addColorStop(1, "rgba(255,160,190,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * @param {THREE.Scene} scene
 * @returns petal field controls; see the returned object below
 */
export function createPetalField(scene) {
  const root = new THREE.Group();
  root.name = "sky-petals";
  scene.add(root);

  const flowerGeometry = createFlowerGeometry();
  const flowerMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const hexGeometry = new THREE.RingGeometry(1.4, 1.52, 6);
  const hexMaterial = new THREE.MeshBasicMaterial({ color: 0xf9b93b, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const glowMaterial = new THREE.SpriteMaterial({
    map: createGlowTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    opacity: 0.8,
  });

  const slots = Array.from({ length: PETAL_CONSTANTS.setSize }, () => {
    const group = new THREE.Group();
    const flower = new THREE.Mesh(flowerGeometry, flowerMaterial);
    const hex = new THREE.Mesh(hexGeometry, hexMaterial);
    const glow = new THREE.Sprite(glowMaterial);
    flower.scale.setScalar(FLOWER_SIZE);
    hex.scale.setScalar(FLOWER_SIZE);
    glow.scale.set(FLOWER_SIZE * 6, FLOWER_SIZE * 6, 1);
    group.add(glow, hex, flower);
    group.visible = false;
    root.add(group);
    return { group, flower, hex, petal: null };
  });

  // Pickup burst: loose blossom petals thrown outward from the collected flower.
  const burstMesh = new THREE.InstancedMesh(
    createPetalShape(),
    new THREE.MeshBasicMaterial({ color: 0xf9a6c6, side: THREE.DoubleSide, fog: false, toneMapped: false }),
    BURST_COUNT
  );
  burstMesh.frustumCulled = false;
  burstMesh.visible = false;
  root.add(burstMesh);
  const burstParts = Array.from({ length: BURST_COUNT }, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    spin: new THREE.Euler(),
    spinRate: new THREE.Vector3(),
  }));
  let burstAge = BURST_LIFE;

  function startBurst(petal) {
    burstAge = 0;
    burstMesh.visible = true;
    for (const part of burstParts) {
      part.position.set(petal.x, petal.y, petal.z);
      part.velocity.randomDirection().multiplyScalar(14 + Math.random() * 22);
      part.spinRate.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
    }
  }

  const _matrix = new THREE.Matrix4();
  const _quat = new THREE.Quaternion();
  const _scale = new THREE.Vector3();
  const _point = new THREE.Vector3();

  function updateBurst(dt) {
    if (burstAge >= BURST_LIFE) return;
    burstAge += dt;
    const fade = Math.max(1 - burstAge / BURST_LIFE, 0);
    burstParts.forEach((part, i) => {
      part.velocity.y -= 12 * dt;
      part.position.addScaledVector(part.velocity, dt);
      part.spin.x += part.spinRate.x * dt;
      part.spin.y += part.spinRate.y * dt;
      part.spin.z += part.spinRate.z * dt;
      _matrix.compose(part.position, _quat.setFromEuler(part.spin), _scale.setScalar(2.4 * fade));
      burstMesh.setMatrixAt(i, _matrix);
    });
    burstMesh.instanceMatrix.needsUpdate = true;
    if (burstAge >= BURST_LIFE) burstMesh.visible = false;
  }

  return {
    /** Shows this bloom's petals, hiding any that are already collected. */
    setPetals(petals) {
      slots.forEach((slot, i) => {
        slot.petal = petals[i] ?? null;
        slot.group.visible = Boolean(slot.petal) && !slot.petal.collected;
      });
    },

    /** Hides the given petals and plays the pickup burst at the first of them. */
    collect(collected) {
      for (const slot of slots) {
        if (slot.petal && collected.some((p) => p.id === slot.petal.id)) slot.group.visible = false;
      }
      startBurst(collected[0]);
    },

    /** Bobs and spins the petals, keeping them turned to face the camera. */
    update(time, dt, camera) {
      slots.forEach((slot, i) => {
        if (!slot.group.visible) return;
        slot.group.position.set(slot.petal.x, slot.petal.y + Math.sin(time * 1.6 + i) * 1.2, slot.petal.z);
        slot.group.quaternion.copy(camera.quaternion);
        slot.flower.rotation.z = time * 0.7 + i;
        slot.hex.rotation.z = -time * 0.45;
      });
      updateBurst(dt);
    },

    /** Screen position for the guide marker. Call after rendering, so the camera is current. */
    markerFor(petal, camera) {
      _point.set(petal.x, petal.y, petal.z).applyMatrix4(camera.matrixWorldInverse);
      const behind = _point.z > 0;
      _point.applyMatrix4(camera.projectionMatrix);
      return edgeMarker(_point.x, _point.y, behind);
    },
  };
}
