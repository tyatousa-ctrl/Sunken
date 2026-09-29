import * as THREE from 'three'
import { FLOOR_Y, LAGOON } from './Cavern'
import { SURFACE_Y } from '../world/SeabedScene'

const SEGMENTS = 64
const LEAVE_SECONDS = 6

// The keeper: an ancient sea serpent asleep on the gold before the great chest, coiled with its tail
// trailing into the lagoon. Scales of deep teal and bronze, a crest of fins, eyes shut. It breathes
// slowly. Come near without a gift and it stirs (and shoves you back); feed it the pearl and it wakes
// gently, gulps it down, and slides away into the lagoon, leaving the chest.
export class Keeper {
  readonly group = new THREE.Group()
  /** Fed and gone. */
  gone = false
  private readonly curve: THREE.CatmullRomCurve3
  private readonly body: THREE.InstancedMesh
  private readonly head = new THREE.Group()
  private readonly eyes: THREE.MeshStandardMaterial
  private readonly radii: number[] = []
  private time = 0
  private stir = 0
  private leaving = -1
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly s = new THREE.Vector3()
  private readonly p = new THREE.Vector3()

  constructor(parent: THREE.Object3D) {
    // Head resting on the gold just before the dais; coils behind it; the tail down into the lagoon,
    // and on into its depths (the far end, for when it leaves).
    const y = FLOOR_Y + 0.45
    const points = [
      [0, y, 3.4], [1.8, y, 2.4], [2.6, y, 0.6], [1.6, y, -1], [-0.6, y, -1.2], [-2.4, y, -0.2], [-2.8, y, 1.6],
      [-1.4, y + 0.1, 2.8], [0.6, y, 1.6], [0.4, y - 0.1, -0.2], [0, SURFACE_Y - 0.4, LAGOON.z + LAGOON.rz - 0.6],
      [0.6, SURFACE_Y - 2.5, LAGOON.z + 2], [-0.8, SURFACE_Y - 4, LAGOON.z - 2], [0, SURFACE_Y - 4.5, LAGOON.z - 5],
    ].map(([x, py, z]) => new THREE.Vector3(x, py, z))
    this.curve = new THREE.CatmullRomCurve3(points)
    const scales = new THREE.MeshStandardMaterial({ color: 0x1f5a55, roughness: 0.35, metalness: 0.45, emissive: 0x06201c })
    this.body = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), scales, SEGMENTS)
    for (let i = 0; i < SEGMENTS; i++) {
      const t = i / (SEGMENTS - 1)
      // Thick behind the head, tapering to the tail.
      this.radii.push(0.55 * (1 - t * 0.8) * (t < 0.04 ? 0.85 : 1))
    }
    this.group.add(this.body)

    // The head: long snout, horned brow, a crest, eyes closed to slits.
    const skin = new THREE.MeshStandardMaterial({ color: 0x24665f, roughness: 0.35, metalness: 0.45, emissive: 0x06201c })
    const bronze = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.3, metalness: 0.8 })
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.6, 18, 12), skin)
    skull.scale.set(1, 0.7, 1.5)
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), skin)
    snout.scale.set(0.9, 0.55, 1.6)
    snout.position.set(0, -0.08, 0.8)
    this.eyes = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb020, emissiveIntensity: 0.05 })
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), this.eyes)
      eye.scale.set(1, 0.35, 1)
      eye.position.set(side * 0.42, 0.15, 0.45)
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.8, 8), bronze)
      horn.position.set(side * 0.3, 0.45, -0.35)
      horn.rotation.set(-1.1, 0, side * 0.3)
      this.head.add(eye, horn)
    }
    for (let i = 0; i < 5; i++) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5 - i * 0.06, 4), bronze)
      fin.position.set(0, 0.42 - i * 0.02, -0.2 - i * 0.28)
      fin.rotation.x = -0.6
      this.head.add(fin)
    }
    this.head.add(skull, snout)
    this.group.add(this.head)
    parent.add(this.group)
    this.pose(0)
  }

  /** Its mouth (world), where the pearl goes. */
  get mouth(): THREE.Vector3 {
    return this.head.localToWorld(new THREE.Vector3(0, -0.1, 1.9))
  }

  /** Where its head lies (world). */
  get headPosition(): THREE.Vector3 {
    return this.head.getWorldPosition(new THREE.Vector3())
  }

  /** Someone came too close without a gift: it stirs, eyes cracking open. */
  disturb(): void {
    this.stir = 1.5
  }

  /** Fed: it wakes, and slides away into the lagoon. */
  leave(now = false): void {
    if (this.leaving >= 0 || this.gone) return
    this.leaving = now ? LEAVE_SECONDS : 0
    if (now) {
      this.gone = true
      this.group.visible = false
    }
  }

  update(dt: number): void {
    this.time += dt
    this.stir = Math.max(0, this.stir - dt)
    if (this.gone) return
    let slide = 0
    if (this.leaving >= 0) {
      this.leaving += dt
      // A moment to wake and swallow, then away down the coils into the water.
      slide = THREE.MathUtils.smoothstep(this.leaving, 1.6, LEAVE_SECONDS) * 0.93
      this.eyes.emissiveIntensity = 1.2
      if (this.leaving >= LEAVE_SECONDS) {
        this.gone = true
        this.group.visible = false
        return
      }
    } else {
      this.eyes.emissiveIntensity = this.stir > 0 ? 0.9 : 0.05
    }
    this.pose(slide)
  }

  /** Lay the body along its coils, shifted `slide` of the way toward the tail's end. */
  private pose(slide: number): void {
    const breathe = 1 + Math.sin(this.time * 0.7) * 0.03
    const span = 0.8
    for (let i = 0; i < SEGMENTS; i++) {
      const t = Math.min(1, slide + (i / (SEGMENTS - 1)) * span)
      this.curve.getPointAt(t, this.p)
      const r = this.radii[i] * (i < 20 ? breathe : 1)
      this.body.setMatrixAt(i, this.m.compose(this.p, this.q.identity(), this.s.set(r, r * 0.85, r)))
    }
    this.body.instanceMatrix.needsUpdate = true
    // The head sits just ahead of the first coil, facing along it; it lifts when stirred or fed.
    const t0 = Math.min(1, slide)
    const at = this.curve.getPointAt(t0, new THREE.Vector3())
    const ahead = this.curve.getTangentAt(t0, new THREE.Vector3()).negate()
    const lift = this.stir > 0 || (this.leaving >= 0 && this.leaving < 1.6) ? 0.5 : 0
    this.head.position.copy(at).addScaledVector(ahead, 0.7).add(new THREE.Vector3(0, lift + Math.sin(this.time * 0.7) * 0.03, 0))
    this.head.lookAt(this.head.position.clone().add(ahead.setY(0)))
  }
}
