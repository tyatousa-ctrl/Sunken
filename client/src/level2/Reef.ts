import * as THREE from 'three'
import type { RockCollider } from '../world/SeabedScene'
import { applyCaustics } from '../world/caustics'

export interface Boulder {
  center: THREE.Vector3
  /** Size along x, y, z (the rock is a lumpy ball this big). */
  size: THREE.Vector3
  /** Keep it level (a flat-topped stone) instead of a random tumble. */
  level?: boolean
}

// Rocky reef built from big volcanic boulders: one instanced mesh, and a sphere collider for each
// boulder (a little smaller than it looks, so divers can squeeze close).
export class Reef {
  readonly mesh: THREE.InstancedMesh
  readonly colliders: RockCollider[] = []

  constructor(parent: THREE.Object3D, boulders: Boulder[], seed = 5) {
    let s = seed
    const random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const material = new THREE.MeshStandardMaterial({ color: 0x3a3431, roughness: 0.95, flatShading: true })
    applyCaustics(material, 0.7)
    this.mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), material, boulders.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    boulders.forEach((b, i) => {
      q.setFromEuler(b.level ? new THREE.Euler(0, random() * 3, 0) : new THREE.Euler(random() * 3, random() * 3, random() * 3))
      this.mesh.setMatrixAt(i, m.compose(b.center, q, b.size))
      // Oblong rocks get a chain of spheres along their long axis.
      const r = Math.min(b.size.x, b.size.y, b.size.z) * 0.92
      const long = Math.max(b.size.x, b.size.z)
      const axis = b.size.x >= b.size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
      const n = Math.max(1, Math.round(long / Math.max(r, 0.5)))
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0 : (k / (n - 1) - 0.5) * 2 * (long - r)
        this.colliders.push({ center: b.center.clone().addScaledVector(axis, t), radius: r })
      }
    })
    this.mesh.instanceMatrix.needsUpdate = true
    parent.add(this.mesh)
  }
}

/** A clay amphora lying in the sand (decoration). */
export function makeAmphora(): THREE.Mesh {
  const profile = [
    [0.0, 0.0], [0.05, 0.02], [0.08, 0.12], [0.16, 0.3], [0.17, 0.42], [0.13, 0.55], [0.07, 0.62], [0.06, 0.72], [0.08, 0.76], [0.0, 0.76],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const material = new THREE.MeshStandardMaterial({ color: 0xa65d36, roughness: 0.9 })
  applyCaustics(material, 0.5)
  return new THREE.Mesh(new THREE.LatheGeometry(profile, 14), material)
}

interface School {
  center: THREE.Vector3
  radius: number
  speed: number
  offsets: { phase: number; lift: number; lane: number }[]
}

// Schools of bream (and a few golden salema) circling over the meadow: one instanced mesh for all.
export class ReefFish {
  private readonly mesh: THREE.InstancedMesh
  private readonly schools: School[] = []
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3(1, 1, 1)

  constructor(parent: THREE.Object3D, centers: { center: THREE.Vector3; radius: number; count: number }[]) {
    const body = new THREE.SphereGeometry(0.08, 8, 6)
    body.scale(0.45, 0.8, 1.6)
    const tail = new THREE.ConeGeometry(0.06, 0.1, 4)
    tail.rotateX(Math.PI / 2)
    tail.translate(0, 0, 0.16)
    const geometry = mergeTwo(body, tail)
    const material = new THREE.MeshStandardMaterial({ color: 0xb9c3c8, roughness: 0.4, metalness: 0.5 })
    const total = centers.reduce((n, c) => n + c.count, 0)
    this.mesh = new THREE.InstancedMesh(geometry, material, total)
    let seed = 17
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const colors = [new THREE.Color(0xb9c3c8), new THREE.Color(0xd9c46a), new THREE.Color(0x9fb0b8)]
    let k = 0
    centers.forEach((c, i) => {
      const offsets = Array.from({ length: c.count }, () => ({ phase: random() * 0.9, lift: (random() - 0.5) * 1.2, lane: (random() - 0.5) * 1.6 }))
      for (let j = 0; j < c.count; j++) this.mesh.setColorAt(k++, colors[i % colors.length])
      this.schools.push({ center: c.center, radius: c.radius, speed: 0.25 + random() * 0.15, offsets })
    })
    parent.add(this.mesh)
  }

  update(elapsed: number): void {
    let k = 0
    for (const school of this.schools) {
      for (const o of school.offsets) {
        const a = elapsed * school.speed + o.phase
        const r = school.radius + o.lane
        this.p.set(Math.cos(a) * r, o.lift + Math.sin(elapsed * 0.7 + o.phase * 7) * 0.2, Math.sin(a) * r).add(school.center)
        // Swimming round the circle: facing along its tangent (fish front is -z).
        this.q.setFromEuler(new THREE.Euler(0, Math.PI - a, 0))
        this.mesh.setMatrixAt(k++, this.m.compose(this.p, this.q, this.s))
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const ga = a.toNonIndexed()
  const gb = b.toNonIndexed()
  const pos = new Float32Array([...ga.attributes.position.array, ...gb.attributes.position.array])
  const nor = new Float32Array([...ga.attributes.normal.array, ...gb.attributes.normal.array])
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return out
}
