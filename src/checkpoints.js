import * as THREE from "three";
import { CHECKPOINTS } from "./course.js";

// Thin Three.js wrapper around course.js's checkpoint list: one ring mesh per
// checkpoint, recolored by reference (cheap — no per-mesh unique materials) to
// show which one is next, completed, or still ahead in the sequence.

/**
 * Builds one glowing gold ring per checkpoint in course.js's CHECKPOINTS list:
 * a polished gold torus, a thin inner band, and a soft additive glow shell.
 * @param {THREE.Scene} scene
 * @returns {{updateVisuals: (nextCheckpointIndex: number) => void, animate: (time: number) => void, dispose: () => void}}
 */
export function createCheckpoints(scene) {
  const looks = {
    next: {
      ring: new THREE.MeshStandardMaterial({ color: 0xffd56e, emissive: 0xffaa2a, emissiveIntensity: 0.9, metalness: 0.45, roughness: 0.3 }),
      glow: new THREE.MeshBasicMaterial({ color: 0xffc960, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
    },
    future: {
      ring: new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffd9a0, emissiveIntensity: 0.25, metalness: 0.2, roughness: 0.4, transparent: true, opacity: 0.55 }),
      glow: new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false }),
    },
    completed: {
      ring: new THREE.MeshStandardMaterial({ color: 0xfff6e6, emissive: 0xffe9c4, emissiveIntensity: 0.2, transparent: true, opacity: 0.22 }),
      glow: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    },
  };
  const geometries = [];

  const rings = CHECKPOINTS.map((cp, i) => {
    const radius = cp.radius * 0.8;
    const gate = new THREE.Group();
    // TorusGeometry's ring already lies in the vertical XY plane with its hole
    // facing local +Z by default — exactly a standing gate facing this game's
    // forward direction (heading 0 = +Z). No X rotation needed; that would tip
    // it onto its side like a hoop lying flat on the ground.
    const ringGeo = new THREE.TorusGeometry(radius, 1.3, 16, 64);
    const innerGeo = new THREE.TorusGeometry(radius * 0.86, 0.28, 8, 64);
    const glowGeo = new THREE.TorusGeometry(radius, 3.4, 12, 64);
    geometries.push(ringGeo, innerGeo, glowGeo);
    const ring = new THREE.Mesh(ringGeo, looks.future.ring);
    const inner = new THREE.Mesh(innerGeo, looks.future.ring);
    const glow = new THREE.Mesh(glowGeo, looks.future.glow);
    glow.renderOrder = 3;
    gate.add(ring, inner, glow);

    // Yaw to face the next checkpoint (or hold default facing for the last
    // one) so flying "through" each gate reads naturally along the course.
    const next = CHECKPOINTS[i + 1];
    if (next) {
      const dx = next.x - cp.x;
      const dz = next.z - cp.z;
      gate.rotation.y = Math.atan2(dx, dz);
    }

    gate.position.set(cp.x, cp.y, cp.z);
    scene.add(gate);
    return { gate, ring, inner, glow };
  });

  let lastIndex = -1;
  function updateVisuals(nextCheckpointIndex) {
    if (nextCheckpointIndex === lastIndex) return; // avoid redundant material swaps
    lastIndex = nextCheckpointIndex;
    rings.forEach((r, i) => {
      const look = i < nextCheckpointIndex ? looks.completed : i === nextCheckpointIndex ? looks.next : looks.future;
      r.ring.material = look.ring;
      r.inner.material = look.ring;
      r.glow.material = look.glow;
    });
  }
  updateVisuals(0);

  // The next gate breathes: its glow and shine pulse gently.
  function animate(time) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 3);
    looks.next.glow.opacity = 0.2 + 0.16 * pulse;
    looks.next.ring.emissiveIntensity = 0.75 + 0.35 * pulse;
  }

  function dispose() {
    for (const r of rings) scene.remove(r.gate);
    geometries.forEach((g) => g.dispose());
    for (const look of Object.values(looks)) {
      look.ring.dispose();
      look.glow.dispose();
    }
  }

  return { updateVisuals, animate, dispose };
}
