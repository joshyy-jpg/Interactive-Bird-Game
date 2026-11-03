// Shared world-space definitions keep visible tunnels and boost volumes identical.
export const WIND_TILE = 800;
export const WIND_TEMPLATES = [
  { x: 0, y: 32, z: 110, dx: 0, dy: 0, dz: 1, length: 180, radius: 14 },
  { x: 270, y: 95, z: 300, dx: 0.8, dy: 0.22, dz: 0.56, length: 230, radius: 18 },
];
export function nearbyWindStreams(position) {
  const cx = Math.round(position.x / WIND_TILE), cz = Math.round(position.z / WIND_TILE);
  const result = [];
  for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
    for (const t of WIND_TEMPLATES) {
      const length = Math.hypot(t.dx, t.dy, t.dz);
      result.push({ ...t, x: t.x + x * WIND_TILE, z: t.z + z * WIND_TILE, dx: t.dx / length, dy: t.dy / length, dz: t.dz / length });
    }
  }
  return result;
}
export function sampleWind(position, heading, pitch, streams = nearbyWindStreams(position)) {
  let strength = 0;
  for (const s of streams) {
    const x = position.x-s.x, y = position.y-s.y, z = position.z-s.z;
    const along = x*s.dx + y*s.dy + z*s.dz;
    if (Math.abs(along) >= s.length / 2) continue;
    const radial = Math.hypot(x-along*s.dx, y-along*s.dy, z-along*s.dz);
    if (radial >= s.radius) continue;
    const alignment = Math.max(0, Math.sin(heading)*Math.cos(pitch)*s.dx + Math.sin(pitch)*s.dy + Math.cos(heading)*Math.cos(pitch)*s.dz);
    const edge = Math.min(1, (1-radial/s.radius)*4) * Math.min(1, (s.length/2-Math.abs(along))/18);
    strength = Math.max(strength, alignment*alignment*edge);
  }
  return { strength, acceleration: strength * 12 };
}
