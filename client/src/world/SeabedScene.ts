import * as THREE from 'three'
import { applyCaustics, causticsTime } from './caustics'
import { makeGodRays, makeWaterSurface } from './WaterFx'
import type { Bubbles } from './Bubbles'

// Movement sandbox: a patch of Sicilian seabed built from primitives (sand, dark volcanic rocks,
// Posidonia seagrass, drifting particles, a bubbling air vent) under a shimmering surface.
// Real assets replace the primitives in later milestones.
export const SURFACE_Y = 10
export const SANDBOX_RADIUS = 34
export const VENT_POSITION = new THREE.Vector3(4.5, 0, -7)
export const VENT_RADIUS = 1.8

const WATER_COLOR = new THREE.Color(0x0a4f7a)
const SEAGRASS_BLADES = 1800
const ROCKS = 40
const PARTICLES = 600
const PARTICLE_RADIUS = 12

export interface RockCollider {
  center: THREE.Vector3
  radius: number
}

/** How a level's seabed is laid out (defaults: the Level 1 / sandbox patch). */
export interface SeabedOptions {
  /** Sand height under a world point. */
  height?: (x: number, z: number) => number
  /** Sand patch size (m, square). */
  sandSize?: number
  /** Scattered rocks: how many, between which distances from the centre, and the layout seed. */
  rocks?: number
  rockRing?: [min: number, max: number]
  seed?: number
  /** Seagrass blades, and the half-size of the area the meadow clumps spread over. */
  seagrass?: number
  seagrassSpread?: number
  /** Seagrass height multiplier (Posidonia meadows grow tall). */
  seagrassHeight?: number
  /** Keep seagrass out of places (a door, a spawn point...). */
  seagrassClear?: (x: number, z: number) => boolean
  /** The bubbling air vent (null: none). */
  vent?: THREE.Vector3 | null
  /** Sunlight shafts slanting down from the surface (default on). */
  godRays?: boolean
  /** Size of the water surface (0: the level makes its own). */
  surfaceSize?: number
}

/** Sand height at a world position: flat where the player starts, gentle dunes further out. */
export function sandHeight(x: number, z: number): number {
  const dunes = Math.sin(x * 0.35) * Math.cos(z * 0.28) * 0.35 + Math.sin(x * 0.9 + z * 0.6) * 0.08
  return dunes * THREE.MathUtils.smoothstep(Math.hypot(x, z), 2, 8) - 0.02
}

export class SeabedScene {
  readonly rocks: RockCollider[] = []
  private rockMesh!: THREE.InstancedMesh
  private readonly particles: THREE.Points
  private readonly swayUniform = { value: 0 }
  private readonly godRayTime = { value: 0 }
  private ventTimer = 0
  private readonly ventOrigin: THREE.Vector3 | null
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly height: (x: number, z: number) => number
  private readonly options: SeabedOptions

  constructor(
    scene: THREE.Scene,
    root: THREE.Group,
    private readonly bubbles: Bubbles,
    options: SeabedOptions = {},
  ) {
    this.options = options
    this.height = options.height ?? sandHeight
    const vent = options.vent === undefined ? VENT_POSITION : options.vent
    this.ventOrigin = vent ? vent.clone().setY(this.height(vent.x, vent.z) + 0.35) : null
    scene.background = WATER_COLOR
    // ~30 m visibility, per the brief's underwater draw-distance budget.
    scene.fog = new THREE.FogExp2(WATER_COLOR, 0.06)

    root.add(new THREE.HemisphereLight(0x9fdcff, 0x1b2a2f, 1.4))
    const sun = new THREE.DirectionalLight(0xdff6ff, 1.6)
    sun.position.set(3, 10, 2)
    root.add(sun)

    root.add(makeSand(this.height, options.sandSize ?? 80))
    root.add(this.makeRocks())
    if (vent) root.add(makeVent(vent, this.height))
    root.add(this.makeSeagrass())
    if (options.surfaceSize !== 0) root.add(makeWaterSurface(SURFACE_Y, options.surfaceSize))
    if (options.godRays !== false) root.add(makeGodRays(SURFACE_Y, this.godRayTime))

    this.particles = makeParticles()
    root.add(this.particles)
  }

  /** `around`: the viewer, so the marine snow stays around them wherever they swim. */
  update(dt: number, elapsed: number, around?: THREE.Vector3): void {
    this.swayUniform.value = elapsed
    this.godRayTime.value = elapsed
    causticsTime.value = elapsed

    // Slow drift of marine snow; each flake wraps round the viewer's neighbourhood.
    const pos = this.particles.geometry.attributes.position as THREE.BufferAttribute
    const R = PARTICLE_RADIUS
    const wrap = (v: number, c: number) => c + ((((v - c + R) % (2 * R)) + 2 * R) % (2 * R)) - R
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - dt * 0.05
      if (around) {
        if (y < around.y - 3) y += 6
        if (y > around.y + 3) y -= 6
        pos.setX(i, wrap(pos.getX(i), around.x))
        pos.setZ(i, wrap(pos.getZ(i), around.z))
      } else if (y < 0) y += 6
      pos.setY(i, y)
    }
    pos.needsUpdate = true

    if (!this.ventOrigin) return
    this.ventTimer += dt
    while (this.ventTimer > 0.05) {
      this.ventTimer -= 0.05
      this.bubbles.emit(this.ventOrigin, this.up, 2, 0.8, 0.8)
    }
  }

  private makeRocks(): THREE.InstancedMesh {
    const random = rng(this.options.seed ?? 7)
    const count = this.options.rocks ?? ROCKS
    const [ringMin, ringMax] = this.options.rockRing ?? [4, 26]
    const material = new THREE.MeshStandardMaterial({ color: 0x2c2a2b, roughness: 0.95, flatShading: true })
    applyCaustics(material, 0.7)
    const mesh = (this.rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), material, count))
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2
      const radius = ringMin + random() * (ringMax - ringMin)
      const size = 0.3 + random() * random() * 2.5
      p.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
      p.y = this.height(p.x, p.z) + size * 0.2
      q.setFromEuler(new THREE.Euler(random() * 3, random() * 3, random() * 3))
      s.set(size * (0.8 + random() * 0.6), size * (0.5 + random() * 0.4), size * (0.8 + random() * 0.6))
      mesh.setMatrixAt(i, m.compose(p, q, s))
      this.rocks.push({ center: p.clone(), radius: ((s.x + s.y + s.z) / 3) * 0.9 })
    }
    return mesh
  }

  /** Remove rocks that would poke through something placed on the seabed (e.g. the wreck). */
  removeRocks(inside: (center: THREE.Vector3, radius: number) => boolean): void {
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
    this.rocks.forEach((rock, i) => {
      if (rock.radius > 0 && inside(rock.center, rock.radius)) {
        this.rockMesh.setMatrixAt(i, hidden)
        rock.radius = 0
      }
    })
    this.rockMesh.instanceMatrix.needsUpdate = true
  }

  private makeSeagrass(): THREE.InstancedMesh {
    const material = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.8, side: THREE.DoubleSide })
    material.onBeforeCompile = (shader) => {
      // Sway blades by height so the base stays planted.
      shader.uniforms.uSway = this.swayUniform
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uSway;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float phase = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5;
           transformed.x += sin(uSway * 1.3 + phase) * 0.18 * position.y * position.y;
           transformed.z += cos(uSway * 0.9 + phase) * 0.08 * position.y * position.y;`,
        )
    }

    const random = rng((this.options.seed ?? 7) * 6)
    const blades = this.options.seagrass ?? SEAGRASS_BLADES
    const spread = this.options.seagrassSpread ?? 20
    const clear = this.options.seagrassClear ?? ((x: number, z: number) => Math.hypot(x, z) < 2.5)
    // A single ribbon blade, 1 unit tall, pivoting at its base.
    const blade = new THREE.PlaneGeometry(0.06, 1, 1, 4)
    blade.translate(0, 0.5, 0)
    const mesh = new THREE.InstancedMesh(blade, material, blades)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    let placed = 0
    while (placed < blades) {
      // Clumped meadows: pick a clump centre, then scatter blades around it.
      const cx = (random() - 0.5) * spread * 2
      const cz = (random() - 0.5) * spread * 2
      if (clear(cx, cz)) continue
      for (let j = 0; j < 30 && placed < blades; j++, placed++) {
        p.set(cx + (random() - 0.5) * 1.6, 0, cz + (random() - 0.5) * 1.6)
        p.y = this.height(p.x, p.z)
        q.setFromEuler(new THREE.Euler((random() - 0.5) * 0.3, random() * Math.PI, (random() - 0.5) * 0.3))
        s.set(1, (0.4 + random() * 0.8) * (this.options.seagrassHeight ?? 1), 1)
        mesh.setMatrixAt(placed, m.compose(p, q, s))
      }
    }
    return mesh
  }
}

// Seeded random so the layout is identical on every client (matters once multiplayer lands).
function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

function makeSand(height: (x: number, z: number) => number, size: number): THREE.Mesh {
  const segments = Math.round(size)
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  const pos = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)))
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({ color: 0xcfbf95, roughness: 1 })
  applyCaustics(material, 0.6)
  return new THREE.Mesh(geometry, material)
}

function makeVent(at: THREE.Vector3, height: (x: number, z: number) => number): THREE.Mesh {
  // A low volcanic cone; the air vent bubbles out of its top.
  const geometry = new THREE.CylinderGeometry(0.25, 0.9, 0.45, 9, 1, true)
  geometry.translate(0, 0.2, 0)
  const material = new THREE.MeshStandardMaterial({ color: 0x3a2f2c, roughness: 1, flatShading: true, side: THREE.DoubleSide })
  applyCaustics(material, 0.5)
  const vent = new THREE.Mesh(geometry, material)
  vent.position.copy(at)
  vent.position.y = height(at.x, at.z)
  return vent
}

function makeParticles(): THREE.Points {
  const random = rng(99)
  const positions = new Float32Array(PARTICLES * 3)
  for (let i = 0; i < PARTICLES; i++) {
    positions[i * 3] = (random() - 0.5) * PARTICLE_RADIUS * 2
    positions[i * 3 + 1] = random() * 6
    positions[i * 3 + 2] = (random() - 0.5) * PARTICLE_RADIUS * 2
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xcfefff, size: 0.025, transparent: true, opacity: 0.6, depthWrite: false }),
  )
}
