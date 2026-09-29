import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { applySurfaceShimmer } from './caustics'

// Underside of the water surface plus soft god rays slanting down from it.
export function makeWaterSurface(surfaceY: number): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({ color: 0x5fb8e6, side: THREE.DoubleSide })
  applySurfaceShimmer(material)
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), material)
  surface.rotation.x = Math.PI / 2
  surface.position.y = surfaceY
  return surface
}

export function makeGodRays(surfaceY: number, time: { value: number }): THREE.Mesh {
  const shafts: THREE.BufferGeometry[] = []
  const layout = [
    [-3, -6, 1.1],
    [2, -9, 1.6],
    [6, -4, 0.9],
    [-7, -12, 1.8],
    [9, -14, 1.4],
    [-1, -18, 2.0],
    [4, 3, 1.0],
  ]
  layout.forEach(([x, z, width], i) => {
    const height = surfaceY + 1
    const shaft = new THREE.CylinderGeometry(width * 0.35, width, height, 12, 1, true)
    shaft.translate(0, -height / 2, 0)
    shaft.rotateZ(0.18)
    shaft.rotateX(-0.08)
    shaft.translate(x, surfaceY, z)
    // Per-shaft phase so they flicker independently.
    const phase = new Float32Array(shaft.attributes.position.count).fill(i * 1.7)
    shaft.setAttribute('phase', new THREE.BufferAttribute(phase, 1))
    shafts.push(shaft)
  })

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uSurfaceY: { value: surfaceY } },
    vertexShader: /* glsl */ `
      attribute float phase;
      varying float vFade;
      varying float vPhase;
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vFade = uv.y;
        vPhase = phase;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vFade;
      varying float vPhase;
      varying vec3 vWorld;
      void main() {
        float flicker = 0.65 + 0.35 * sin(uTime * 0.7 + vPhase + vWorld.x * 0.3);
        float alpha = pow(vFade, 1.6) * 0.09 * flicker;
        gl_FragColor = vec4(0.75, 0.93, 1.0, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const rays = new THREE.Mesh(mergeGeometries(shafts), material)
  rays.renderOrder = 5
  return rays
}
