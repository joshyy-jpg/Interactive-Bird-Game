import * as THREE from "three";

// Golden-hour pastel sky ("Dreamflight" look): peach-gold horizon, pink and
// lavender bands, soft blue overhead, and a low warm sun.
//
// Colours are plain sRGB hex values. The sky shader writes them straight to the
// screen (no tone mapping), and three.js applies fog after tone mapping in the
// output colour space, so far-away fogged objects fade into exactly
// SKY_PALETTE.horizon and meet the sky with no visible seam.
export const SKY_PALETTE = {
  zenith: 0x86acd8,
  upper: 0xbcb8e4,
  mid: 0xf7c4cf,
  horizon: 0xffdcb4,
  sunGlow: 0xffc98c,
  sun: 0xfff6e2,
};

// Low sun, ahead and to the left of the spawn heading (+z; the bird's left is +x).
export const SUN_DIRECTION = new THREE.Vector3(0.6, 0.33, 0.73).normalize();

function srgb(hex) {
  return new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

export function createSkyDome(radius) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: srgb(SKY_PALETTE.zenith) },
      upper: { value: srgb(SKY_PALETTE.upper) },
      mid: { value: srgb(SKY_PALETTE.mid) },
      horizon: { value: srgb(SKY_PALETTE.horizon) },
      sunGlow: { value: srgb(SKY_PALETTE.sunGlow) },
      sunColor: { value: srgb(SKY_PALETTE.sun) },
      sunDir: { value: SUN_DIRECTION.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith, upper, mid, horizon, sunGlow, sunColor, sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizon, mid, smoothstep(0.015, 0.16, h));
        col = mix(col, upper, smoothstep(0.14, 0.42, h));
        col = mix(col, zenith, smoothstep(0.38, 0.95, h));
        float s = max(dot(d, sunDir), 0.0);
        // Glow fades out right at the horizon so the sky meets the fogged sea cleanly.
        float nearHorizon = smoothstep(0.0, 0.1, h);
        col = mix(col, sunGlow, pow(s, 5.0) * 0.6 * nearHorizon);
        col += sunColor * (smoothstep(0.9993, 0.9997, s) + pow(s, 80.0) * 0.35) * nearHorizon;
        gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), material);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}
