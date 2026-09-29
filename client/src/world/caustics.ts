import type * as THREE from 'three'

// Shared animated caustics: bright light ripples projected down from the surface onto
// upward-facing surfaces. Built from animated Voronoi cell edges (F2 − F1), our own shader.
export const causticsTime = { value: 0 }

const CAUSTIC_GLSL = /* glsl */ `
uniform float uCausticTime;
varying vec3 vCausticPos;
varying vec3 vCausticNormal;

vec2 causticHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float causticCells(vec2 p, float t) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = causticHash(cell + g);
      o = 0.5 + 0.45 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return 1.0 - smoothstep(0.0, 0.14, f2 - f1);
}

float caustic(vec3 worldPos, float t) {
  vec2 p = worldPos.xz * 0.9;
  p += 0.35 * vec2(sin(p.y * 1.1 + t * 0.5), cos(p.x * 0.9 - t * 0.4));
  p += 0.12 * vec2(sin(p.y * 3.1 - t * 0.9), cos(p.x * 2.7 + t * 0.8));
  return causticCells(p, t * 0.9) * (0.55 + 0.45 * causticCells(p * 1.9 + 3.7, -t * 0.7));
}
`

const VERTEX_CAPTURE = /* glsl */ `
{
  vec4 causticLocal = vec4(transformed, 1.0);
  vec3 causticN = objectNormal;
  #ifdef USE_INSTANCING
    causticLocal = instanceMatrix * causticLocal;
    causticN = mat3(instanceMatrix) * causticN;
  #endif
  vCausticPos = (modelMatrix * causticLocal).xyz;
  vCausticNormal = normalize(mat3(modelMatrix) * causticN);
}
`

export interface CausticOptions {
  /** Which way surfaces must face to catch the light (default: up). */
  facing?: 'up' | 'down' | 'any'
  /** Colour of the light (default: the surface's own colour). */
  tint?: [number, number, number]
}

/** Adds caustics to a lit (standard) material. `strength` ~0.3–0.8. */
export function applyCaustics(material: THREE.Material, strength = 0.55, options: CausticOptions = {}): void {
  const facing = options.facing ?? 'up'
  // Which surfaces catch the ripples: floors (light from above), ceilings (light bounced up off
  // glowing water) or every surface.
  const facingExpr = facing === 'up' ? 'clamp(vCausticNormal.y, 0.0, 1.0)' : facing === 'down' ? 'clamp(-vCausticNormal.y, 0.0, 1.0)' : '1.0'
  const tint = options.tint ? `vec3(${options.tint.map((c) => c.toFixed(3)).join(', ')})` : 'diffuseColor.rgb'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCausticTime = causticsTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCausticPos;\nvarying vec3 vCausticNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERTEX_CAPTURE)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CAUSTIC_GLSL)
      .replace(
        '#include <opaque_fragment>',
        `float causticFacing = ${facingExpr};
         outgoingLight += ${tint} * caustic(vCausticPos, uCausticTime) * causticFacing * ${strength.toFixed(2)};
         #include <opaque_fragment>`,
      )
  }
  material.customProgramCacheKey = () => `caustics-${strength}-${facing}-${options.tint?.join(',') ?? ''}`
}

/** Shimmer for the underside of the water surface (unlit material). */
export function applySurfaceShimmer(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCausticTime = causticsTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCausticPos;\nvarying vec3 vCausticNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCausticPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCausticNormal = vec3(0.0, 1.0, 0.0);',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CAUSTIC_GLSL)
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight += vec3(0.55, 0.85, 1.0) * caustic(vCausticPos * 0.6, uCausticTime * 0.8) * 0.6;
         #include <opaque_fragment>`,
      )
  }
  material.customProgramCacheKey = () => 'surface-shimmer'
}
