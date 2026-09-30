import * as THREE from 'three'
import { Particles } from '../../fx/Particles'

/** Direction toward the low golden-hour sun (over the open sea, astern and to starboard). */
export const SUN_DIR = new THREE.Vector3(0.35, 0.13, 0.93).normalize()
const HORIZON = new THREE.Color(0xf1c28e)
const ZENITH = new THREE.Color(0x4c82bf)
/** A deep blue dusk (the sky and light for a moment at the bow with Rose). */
const DUSK_HORIZON = new THREE.Color(0x1d3566)
const DUSK_ZENITH = new THREE.Color(0x07143a)

// The world above water at golden hour off Sicily: sky, animated sea, limestone cliffs with a
// lighthouse, and Mount Etna smoking on the horizon. Everything is built in code.
export class AboveWater {
  /** The sun as seen from the ship (turns as the ship turns). */
  private readonly sunDir = SUN_DIR.clone()
  private readonly sun: THREE.DirectionalLight
  private readonly hemi: THREE.HemisphereLight
  private readonly horizon = HORIZON.clone()
  private readonly zenith = ZENITH.clone()
  private readonly scene: THREE.Scene
  private dusk = 0
  private readonly oceanUniforms = {
    uTime: { value: 0 },
    uSun: { value: this.sunDir },
    uHorizon: { value: this.horizon },
    uDusk: { value: 0 },
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
  }
  private readonly plume = new Particles({ max: 60, gravity: 0, drag: 0 })
  private plumeTimer = 0
  private readonly beacon: THREE.Mesh

  /**
   * `scenery`: where the sea, coast and volcano go (moved around the ship when it sails); the sky
   * and the lights stay in `root`.
   */
  constructor(scene: THREE.Scene, root: THREE.Group, scenery: THREE.Object3D = root) {
    this.scene = scene
    scene.background = HORIZON.clone()
    scene.fog = new THREE.Fog(HORIZON.clone(), 250, 4200)

    this.hemi = new THREE.HemisphereLight(0xdcebff, 0x8a7350, 2.1)
    root.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xffd3a0, 2.8)
    this.sun.position.copy(SUN_DIR).multiplyScalar(100)
    root.add(this.sun)

    root.add(makeSky(this.sunDir, this.horizon, this.zenith))
    scenery.add(this.makeOcean())
    scenery.add(makeCliffs())
    const lighthouse = makeLighthouse()
    this.beacon = lighthouse.userData.beacon
    scenery.add(lighthouse)
    scenery.add(makeEtna())
    scenery.add(this.plume.points)
  }

  /** Fade the sky, sea and light toward a deep blue dusk (0: golden hour, 1: dusk). */
  setDusk(t: number): void {
    t = THREE.MathUtils.clamp(t, 0, 1)
    if (t === this.dusk) return
    this.dusk = t
    this.horizon.lerpColors(HORIZON, DUSK_HORIZON, t)
    this.zenith.lerpColors(ZENITH, DUSK_ZENITH, t)
    this.oceanUniforms.uDusk.value = t
    const fog = this.scene.fog as THREE.Fog | null
    if (fog?.color) fog.color.copy(this.horizon)
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(this.horizon)
    this.hemi.intensity = THREE.MathUtils.lerp(2.1, 0.9, t)
    this.hemi.color.set(0xdcebff).lerp(new THREE.Color(0x7d9be0), t)
    this.sun.intensity = THREE.MathUtils.lerp(2.8, 0.45, t)
    this.sun.color.set(0xffd3a0).lerp(new THREE.Color(0x9bb0ff), t)
  }

  /** The ship has turned to `heading` (radians, CCW from above): the sun swings the other way. */
  setHeading(heading: number): void {
    this.sunDir.copy(SUN_DIR).applyAxisAngle(new THREE.Vector3(0, 1, 0), -heading)
    this.sun.position.copy(this.sunDir).multiplyScalar(100)
  }

  update(dt: number, elapsed: number, halfHeight: number): void {
    this.oceanUniforms.uTime.value = elapsed
    const beam = 0.6 + 0.4 * Math.max(0, Math.sin(elapsed * 1.3))
    ;(this.beacon.material as THREE.MeshBasicMaterial).color.setScalar(beam)
    this.plumeTimer -= dt
    if (this.plumeTimer <= 0) {
      this.plumeTimer = 1.2
      this.plume.emit({
        position: ETNA_TOP,
        velocity: new THREE.Vector3(18, 22, 6),
        spread: 6,
        color: 0x9c948f,
        size: 140,
        endSize: 420,
        life: 45,
        alpha: 0.55,
      })
    }
    this.plume.update(dt, halfHeight)
  }

  private makeOcean(): THREE.Mesh {
    const material = new THREE.ShaderMaterial({
      uniforms: this.oceanUniforms,
      fog: true,
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform vec3 uSun;
        uniform vec3 uHorizon;
        uniform float uDusk;
        varying vec3 vWorld;
        // Slope of a few travelling sine swells, for a cheap animated normal.
        vec2 slope(vec2 p) {
          vec2 s = vec2(0.0);
          s += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.35 + uTime * 1.1) * 0.12;
          s += vec2(-0.4, 0.9) * cos(dot(p, vec2(-0.4, 0.9)) * 0.9 + uTime * 1.7) * 0.07;
          s += vec2(0.95, -0.3) * cos(dot(p, vec2(0.95, -0.3)) * 2.3 + uTime * 2.6) * 0.04;
          s += vec2(0.2, 0.98) * cos(dot(p, vec2(0.2, 0.98)) * 5.1 + uTime * 3.9) * 0.02;
          return s;
        }
        void main() {
          vec3 n = normalize(vec3(-slope(vWorld.xz).x, 1.0, -slope(vWorld.xz).y));
          vec3 view = normalize(cameraPosition - vWorld);
          float fresnel = pow(1.0 - max(dot(n, view), 0.0), 4.0);
          vec3 deep = mix(vec3(0.05, 0.22, 0.34), vec3(0.01, 0.05, 0.16), uDusk);
          vec3 color = mix(deep, uHorizon * 0.95, clamp(fresnel * 1.2, 0.0, 1.0));
          vec3 h = normalize(uSun + view);
          float glint = pow(max(dot(n, h), 0.0), 220.0) * 3.0;
          color += mix(vec3(1.0, 0.85, 0.6), vec3(0.6, 0.7, 1.0), uDusk) * glint * (1.0 - 0.6 * uDusk);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    })
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), material)
    ocean.rotation.x = -Math.PI / 2
    return ocean
  }
}

const ETNA_TOP = new THREE.Vector3(-1900, 880, -2700)

function makeSky(sunDir: THREE.Vector3, horizon: THREE.Color, zenith: THREE.Color): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir }, uHorizon: { value: horizon }, uZenith: { value: zenith } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float up = clamp(dir.y, 0.0, 1.0);
        vec3 color = mix(uHorizon, uZenith, pow(up, 0.45));
        float s = max(dot(dir, uSun), 0.0);
        color += vec3(1.0, 0.75, 0.45) * pow(s, 8.0) * 0.35;
        color += vec3(1.0, 0.9, 0.7) * pow(s, 900.0) * 6.0;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), material)
  sky.renderOrder = -10
  return sky
}

/** Cheap value noise for terrain shapes. */
function noise(x: number, z: number): number {
  return (
    Math.sin(x * 0.011 + Math.sin(z * 0.007) * 2) * 0.5 +
    Math.sin(z * 0.023 + x * 0.004) * 0.3 +
    Math.sin((x + z) * 0.061) * 0.12 +
    Math.sin(x * 0.13 - z * 0.09) * 0.05
  )
}

/** The coastline runs along z at this x (port side, about 420 m away). */
function shoreX(z: number): number {
  return -420 - 60 * Math.sin(z * 0.004) - 25 * Math.sin(z * 0.013)
}

function makeCliffs(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(700, 2600, 70, 130)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(-650, 0, -600)
  const pos = geometry.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const rock = new THREE.Color(0xcaa36e)
  const scrub = new THREE.Color(0x5f6b3a)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const inland = shoreX(z) - x
    // A sheer limestone face rising from the sea, then rolling hills behind it.
    const face = THREE.MathUtils.smoothstep(inland, -10, 25)
    const hills = 45 + 35 * noise(x, z) + Math.max(0, inland - 60) * 0.12
    const h = face * hills - (1 - face) * 12
    pos.setY(i, h)
    c.copy(rock).lerp(scrub, THREE.MathUtils.smoothstep(inland, 40, 120) * 0.8)
    colors.set([c.r, c.g, c.b], i * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }))
}

function makeLighthouse(): THREE.Group {
  const group = new THREE.Group()
  const z = -260
  const x = shoreX(z) - 18
  const white = new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.8 })
  const red = new THREE.MeshStandardMaterial({ color: 0xa8322b, roughness: 0.8 })
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 22, 16), white)
  tower.position.y = 11
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.6, 3, 16), red)
  band.position.y = 15
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.5, 16), red)
  cap.position.y = 25.2
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2, 12), new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }))
  beacon.position.y = 23
  group.add(tower, band, cap, beacon)
  group.userData.beacon = beacon
  group.position.set(x, 44, z)
  return group
}

function makeEtna(): THREE.Group {
  const group = new THREE.Group()
  const mountain = new THREE.Mesh(
    new THREE.ConeGeometry(1500, 950, 40, 4, true),
    new THREE.MeshStandardMaterial({ color: 0x5a4f4a, roughness: 1, flatShading: true }),
  )
  const snow = new THREE.Mesh(new THREE.ConeGeometry(420, 270, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0xece9e4, roughness: 1 }))
  snow.position.y = 350
  group.add(mountain, snow)
  group.position.set(ETNA_TOP.x, ETNA_TOP.y - 480, ETNA_TOP.z)
  return group
}
