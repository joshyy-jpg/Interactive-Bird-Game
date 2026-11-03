import * as THREE from "three";
import { nearbyWindStreams, WIND_TILE } from "./wind.js";

export function createWindVisuals(scene) {
  const root = new THREE.Group(); scene.add(root);
  const material = new THREE.MeshBasicMaterial({ color: 0xb5f7ed, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false });
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xc6fff2, transparent: true, opacity: 0.2, depthWrite: false });
  const ringGeometry = new THREE.TorusGeometry(1, 0.012, 4, 48);
  const shellGeometry = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
  shellGeometry.rotateX(Math.PI/2);
  const streakGeometry = new THREE.BufferGeometry();
  const points = [];
  for (let i = 0; i < 24; i++) {
    const angle = i * 2.39996, r = 0.55 + (i%4)*0.1, z = i/24;
    points.push(Math.cos(angle)*r,Math.sin(angle)*r,z,Math.cos(angle)*r,Math.sin(angle)*r,z+0.04);
  }
  streakGeometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  const streakMaterial = new THREE.LineBasicMaterial({color:0xe0fff7,transparent:true,opacity:0.5,depthWrite:false});
  let tile = '', streams = [], visuals = [];
  function update(position, time) {
    const nextTile = `${Math.round(position.x/WIND_TILE)},${Math.round(position.z/WIND_TILE)}`;
    if (tile !== nextTile) {
      tile = nextTile; root.clear(); visuals = []; streams = nearbyWindStreams(position);
      for (const s of streams) {
        const group = new THREE.Group(); group.position.set(s.x,s.y,s.z);
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(s.dx,s.dy,s.dz));
        const shell = new THREE.Mesh(shellGeometry,material); shell.scale.set(s.radius,s.radius,s.length); group.add(shell);
        const rings = [];
        for (let i = 0; i < 6; i++) {
          const ring = new THREE.Mesh(ringGeometry,ringMaterial); ring.scale.setScalar(s.radius); group.add(ring); rings.push(ring);
        }
        const streaks = new THREE.LineSegments(streakGeometry,streakMaterial);
        streaks.scale.set(s.radius,s.radius,s.length*0.7); group.add(streaks);
        root.add(group); visuals.push({s,rings,streaks});
      }
    }
    for (const {s,rings,streaks} of visuals) {
      rings.forEach((ring,i) => ring.position.z = ((i/6 + time*0.13)%1-0.5)*s.length);
      streaks.position.z = -s.length*0.48 + (time*0.2%0.25)*s.length;
    }
    return streams;
  }
  return { update };
}
