import * as THREE from 'three'

/** A diver's head this close to the hole makes the eel lunge. */
const LUNGE_RANGE = 2.2
const LUNGE_SECONDS = 0.35
const COOLDOWN = 3
const OUT_IDLE = 0.35
const OUT_LUNGE = 1.1

// A moray eel living in a hole (in a wreck's hull or among rocks). It sways at the mouth of its hole,
// jaws working; swim too close and it lunges out at you. The Fish Whisperer can calm it for a while.
export class Moray {
  readonly group = new THREE.Group()
  private readonly body: THREE.Mesh
  private readonly head = new THREE.Group()
  private readonly jaw: THREE.Mesh
  private out = OUT_IDLE
  private lunge = -1
  private cooldown = 0
  private calm = 0
  private time = Math.random() * 10
  private readonly v = new THREE.Vector3()

  /** `at`: the hole's mouth (world); `facing`: the way out of the hole. */
  constructor(parent: THREE.Object3D, at: THREE.Vector3, facing: THREE.Vector3) {
    const skin = new THREE.MeshStandardMaterial({ color: 0x5a5a2a, roughness: 0.6 })
    // Mottled yellow-brown body along +z (out of the hole).
    this.body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5), skin)
    this.group.add(this.body)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), skin)
    skull.scale.set(0.9, 1, 1.6)
    const upper = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 8).rotateX(Math.PI / 2), skin)
    upper.position.set(0, 0.02, 0.2)
    this.jaw = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.7 }))
    this.jaw.position.set(0, -0.05, 0.16)
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), new THREE.MeshBasicMaterial({ color: 0xd8d860 }))
      eye.position.set(side * 0.07, 0.06, 0.1)
      this.head.add(eye)
    }
    this.head.add(skull, upper, this.jaw)
    this.group.add(this.head)
    // The hole: a dark ring the eel lives in.
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.22, 14), new THREE.MeshBasicMaterial({ color: 0x050505 }))
    hole.position.z = 0.005
    this.group.add(hole)
    this.group.position.copy(at)
    this.group.lookAt(at.clone().add(facing))
    parent.add(this.group)
    this.pose()
  }

  /** The Fish Whisperer's calm: back into its hole, no lunging for a while. */
  soothe(seconds: number): void {
    this.calm = seconds
    this.lunge = -1
  }

  /** How close a point is to the eel's hole (world). */
  distanceTo(point: THREE.Vector3): number {
    return this.group.getWorldPosition(this.v).distanceTo(point)
  }

  /** Returns true the moment it lunges at `head` (the stage pushes the diver back). */
  update(dt: number, head: THREE.Vector3): boolean {
    this.time += dt
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.calm = Math.max(0, this.calm - dt)
    let struck = false
    if (this.calm > 0) {
      this.out += (0.05 - this.out) * Math.min(1, dt * 3)
    } else if (this.lunge >= 0) {
      this.lunge += dt
      const t = this.lunge / LUNGE_SECONDS
      this.out = OUT_IDLE + (OUT_LUNGE - OUT_IDLE) * Math.sin(Math.min(1, t) * Math.PI)
      if (t >= 1) {
        this.lunge = -1
        this.cooldown = COOLDOWN
      }
    } else {
      this.out += (OUT_IDLE + Math.sin(this.time * 0.7) * 0.08 - this.out) * Math.min(1, dt * 2)
      if (this.cooldown === 0 && this.distanceTo(head) < LUNGE_RANGE) {
        this.lunge = 0
        struck = true
      }
    }
    this.pose()
    return struck
  }

  private pose(): void {
    // Head at the end of the body; a lazy side-to-side sway; jaws opening and closing.
    this.body.scale.set(1, 1, Math.max(0.05, this.out + 0.1))
    this.body.position.z = this.out
    this.head.position.set(Math.sin(this.time * 1.3) * 0.05 * this.out, 0, this.out)
    this.head.rotation.y = Math.sin(this.time * 1.3) * 0.2
    this.jaw.rotation.x = 0.15 + Math.max(0, Math.sin(this.time * 2.1)) * 0.25 + (this.lunge >= 0 ? 0.5 : 0)
  }
}
