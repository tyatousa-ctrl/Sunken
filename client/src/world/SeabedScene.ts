import * as THREE from 'three'

// Milestone 1 placeholder world: a patch of Sicilian seabed built from primitives
// (sand, dark volcanic rocks, Posidonia seagrass, drifting particles). Replaced by
// real assets and the proper water shaders in later milestones.
const WATER_COLOR = new THREE.Color(0x0a4f7a)
const SEAGRASS_BLADES = 1800
const ROCKS = 40
const PARTICLES = 600
const PARTICLE_RADIUS = 12

export class SeabedScene {
  private readonly seagrass: THREE.InstancedMesh
  private readonly seagrassMaterial: THREE.MeshStandardMaterial
  private readonly particles: THREE.Points
  private swayUniform = { value: 0 }

  constructor(scene: THREE.Scene) {
    scene.background = WATER_COLOR
    // ~30 m visibility, per the brief's underwater draw-distance budget.
    scene.fog = new THREE.FogExp2(WATER_COLOR, 0.07)

    scene.add(new THREE.HemisphereLight(0x9fdcff, 0x1b2a2f, 1.4))
    const sun = new THREE.DirectionalLight(0xdff6ff, 1.6)
    sun.position.set(3, 10, 2)
    scene.add(sun)

    scene.add(makeSand())
    scene.add(makeRocks())

    this.seagrassMaterial = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.8, side: THREE.DoubleSide })
    this.seagrassMaterial.onBeforeCompile = (shader) => {
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
    this.seagrass = makeSeagrass(this.seagrassMaterial)
    scene.add(this.seagrass)

    this.particles = makeParticles()
    scene.add(this.particles)
  }

  update(dt: number, elapsed: number): void {
    this.swayUniform.value = elapsed
    // Slow drift of marine snow; wrap around the local volume.
    const pos = this.particles.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - dt * 0.05
      if (y < 0) y += 6
      pos.setY(i, y)
    }
    pos.needsUpdate = true
  }
}

// Seeded random so the layout is identical on every client (matters once multiplayer lands).
function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

function makeSand(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(80, 80, 80, 80)
  geometry.rotateX(-Math.PI / 2)
  const pos = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const dist = Math.hypot(x, z)
    // Flat where the player stands, gentle dunes further out.
    const dunes = Math.sin(x * 0.35) * Math.cos(z * 0.28) * 0.35 + Math.sin(x * 0.9 + z * 0.6) * 0.08
    pos.setY(i, dunes * THREE.MathUtils.smoothstep(dist, 2, 8) - 0.02)
  }
  geometry.computeVertexNormals()
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xd8c79a, roughness: 1 }))
}

function makeRocks(): THREE.InstancedMesh {
  const random = rng(7)
  const mesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2c2a2b, roughness: 0.95, flatShading: true }),
    ROCKS,
  )
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  for (let i = 0; i < ROCKS; i++) {
    const angle = random() * Math.PI * 2
    const radius = 4 + random() * 22
    const size = 0.3 + random() * random() * 2.5
    p.set(Math.cos(angle) * radius, size * 0.2, Math.sin(angle) * radius)
    q.setFromEuler(new THREE.Euler(random() * 3, random() * 3, random() * 3))
    s.set(size * (0.8 + random() * 0.6), size * (0.5 + random() * 0.4), size * (0.8 + random() * 0.6))
    mesh.setMatrixAt(i, m.compose(p, q, s))
  }
  return mesh
}

function makeSeagrass(material: THREE.Material): THREE.InstancedMesh {
  const random = rng(42)
  // A single ribbon blade, 1 unit tall, pivoting at its base.
  const blade = new THREE.PlaneGeometry(0.06, 1, 1, 4)
  blade.translate(0, 0.5, 0)
  const mesh = new THREE.InstancedMesh(blade, material, SEAGRASS_BLADES)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  let placed = 0
  while (placed < SEAGRASS_BLADES) {
    // Clumped meadows: pick a clump centre, then scatter blades around it.
    const cx = (random() - 0.5) * 40
    const cz = (random() - 0.5) * 40
    if (Math.hypot(cx, cz) < 2.5) continue
    for (let j = 0; j < 30 && placed < SEAGRASS_BLADES; j++, placed++) {
      p.set(cx + (random() - 0.5) * 1.6, 0, cz + (random() - 0.5) * 1.6)
      q.setFromEuler(new THREE.Euler((random() - 0.5) * 0.3, random() * Math.PI, (random() - 0.5) * 0.3))
      s.set(1, 0.4 + random() * 0.8, 1)
      mesh.setMatrixAt(placed, m.compose(p, q, s))
    }
  }
  return mesh
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
