import * as THREE from "three";
import { CHECKPOINTS } from "./course.js";

// Thin Three.js wrapper around course.js's checkpoint list: one ring mesh per
// checkpoint, recolored by reference (cheap — no per-mesh unique materials) to
// show which one is next, completed, or still ahead in the sequence.

/**
 * Builds one torus ring per checkpoint in course.js's CHECKPOINTS list.
 * @param {THREE.Scene} scene
 * @returns {{updateVisuals: (nextCheckpointIndex: number) => void, dispose: () => void}}
 */
export function createCheckpoints(scene) {
  const completedMaterial = new THREE.MeshStandardMaterial({
    color: 0x4ade80,
    emissive: 0x1a5c33,
    transparent: true,
    opacity: 0.35,
  });
  const nextMaterial = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    emissive: 0x7a5c00,
    emissiveIntensity: 1.2,
  });
  const futureMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
  });

  const rings = CHECKPOINTS.map((cp, i) => {
    const tubeRadius = 1.5;
    const geometry = new THREE.TorusGeometry(cp.radius * 0.8, tubeRadius, 12, 28);
    const mesh = new THREE.Mesh(geometry, futureMaterial);
    // TorusGeometry's ring already lies in the vertical XY plane with its hole
    // facing local +Z by default — exactly a standing gate facing this game's
    // forward direction (heading 0 = +Z). No X rotation needed; that would tip
    // it onto its side like a hoop lying flat on the ground.

    // Yaw to face the next checkpoint (or hold default facing for the last
    // one) so flying "through" each gate reads naturally along the course.
    const next = CHECKPOINTS[i + 1];
    if (next) {
      const dx = next.x - cp.x;
      const dz = next.z - cp.z;
      mesh.rotation.y = Math.atan2(dx, dz);
    }

    mesh.position.set(cp.x, cp.y, cp.z);
    scene.add(mesh);
    return mesh;
  });

  let lastIndex = -1;
  function updateVisuals(nextCheckpointIndex) {
    if (nextCheckpointIndex === lastIndex) return; // avoid redundant material swaps
    lastIndex = nextCheckpointIndex;
    rings.forEach((ring, i) => {
      ring.material =
        i < nextCheckpointIndex
          ? completedMaterial
          : i === nextCheckpointIndex
            ? nextMaterial
            : futureMaterial;
    });
  }
  updateVisuals(0);

  function dispose() {
    for (const ring of rings) {
      scene.remove(ring);
      ring.geometry.dispose();
    }
    completedMaterial.dispose();
    nextMaterial.dispose();
    futureMaterial.dispose();
  }

  return { updateVisuals, dispose };
}
