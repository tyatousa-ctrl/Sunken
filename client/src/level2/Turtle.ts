import * as THREE from 'three'
import { applyCaustics } from '../world/caustics'

const CRUISE_SPEED = 1.1
const RIDE_SPEED = 3.5

// A loggerhead turtle that glides a slow loop round the meadow, showing divers the way (her route
// passes most of the starfish). The Fish Whisperer can ride her: she carries a rider up to the top of
// the high reef, where the current stops anyone else, and then carries on with her loop.
export class Turtle {
  readonly group = new THREE.Group()
  /** Carrying someone: the stage moves the rider along with her. */
  riding = false
  private readonly flippers: THREE.Group[] = []
  private readonly head = new THREE.Group()
  private index = 0
  private rideTarget: THREE.Vector3 | null = null
  private onArrive: (() => void) | null = null
  private readonly v = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  private time = 0

  constructor(
    parent: THREE.Object3D,
    private readonly loop: THREE.Vector3[],
  ) {
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x7a4f27, roughness: 0.7 })
    applyCaustics(shellMat, 0.5)
    const skin = new THREE.MeshStandardMaterial({ color: 0xb58a5a, roughness: 0.85 })
    applyCaustics(skin, 0.4)
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1c, roughness: 0.75 })

    // Shell: a domed carapace with plates, and a pale belly. Her front is -z.
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), shellMat)
    shell.scale.set(0.95, 0.45, 1.25)
    const belly = new THREE.Mesh(new THREE.CircleGeometry(0.55, 18), new THREE.MeshStandardMaterial({ color: 0xe0c68f, roughness: 0.9 }))
    belly.rotation.x = Math.PI / 2
    belly.scale.set(0.93, 1.22, 1)
    this.group.add(shell, belly)
    for (let i = 0; i < 7; i++) {
      const plate = new THREE.Mesh(new THREE.CircleGeometry(0.13, 6), plateMat)
      const a = (i / 6) * Math.PI * 2
      const r = i === 6 ? 0 : 0.28
      plate.position.set(Math.cos(a) * r * 0.9, 0.24 - r * 0.25, Math.sin(a) * r * 1.2)
      plate.lookAt(plate.position.clone().multiply(new THREE.Vector3(1, 3, 1)).add(new THREE.Vector3(0, 1, 0)))
      this.group.add(plate)
    }

    // Big blunt head (loggerheads are named for it).
    this.head.position.set(0, 0.05, -0.72)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skin)
    skull.scale.set(1, 0.85, 1.2)
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.14, 8), plateMat)
    beak.rotation.x = -Math.PI / 2
    beak.position.set(0, -0.03, -0.24)
    this.head.add(skull, beak)
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }))
      eye.position.set(side * 0.13, 0.06, -0.12)
      this.head.add(eye)
    }
    this.group.add(this.head)

    // Long front flippers and short back ones, hinged at the shell's edge.
    for (const [x, z, length, width] of [[-0.45, -0.35, 0.75, 0.22], [0.45, -0.35, 0.75, 0.22], [-0.4, 0.5, 0.35, 0.16], [0.4, 0.5, 0.35, 0.16]]) {
      const hinge = new THREE.Group()
      hinge.position.set(x, 0, z)
      const flipper = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6), skin)
      flipper.scale.set(length, 0.05, width)
      flipper.position.x = Math.sign(x) * length * 0.45
      flipper.rotation.y = Math.sign(x) * (z < 0 ? 0.35 : -0.5)
      hinge.add(flipper)
      this.group.add(hinge)
      this.flippers.push(hinge)
    }

    this.group.position.copy(loop[0])
    parent.add(this.group)
  }

  /** Where a rider sits: just above her shell. */
  seat(target: THREE.Vector3): THREE.Vector3 {
    return this.group.localToWorld(target.set(0, 0.55, 0.1))
  }

  /** Carry a rider to `to`, then call `arrived` and carry on with the loop. */
  ride(to: THREE.Vector3, arrived: () => void): void {
    this.riding = true
    this.rideTarget = to.clone()
    this.onArrive = arrived
  }

  update(dt: number): void {
    this.time += dt
    // Slow, powerful strokes of the front flippers; the back ones steer.
    const stroke = Math.sin(this.time * (this.riding ? 3.2 : 1.8))
    this.flippers[0].rotation.z = stroke * 0.55
    this.flippers[1].rotation.z = -stroke * 0.55
    this.flippers[2].rotation.z = stroke * 0.2
    this.flippers[3].rotation.z = -stroke * 0.2
    this.head.rotation.y = Math.sin(this.time * 0.4) * 0.25

    const goal = this.rideTarget ?? this.loop[this.index]
    const to = this.v.copy(goal).sub(this.group.position)
    const dist = to.length()
    const speed = this.riding ? RIDE_SPEED : CRUISE_SPEED
    if (dist < 0.3) {
      if (this.rideTarget) {
        this.rideTarget = null
        this.riding = false
        const done = this.onArrive
        this.onArrive = null
        done?.()
      } else this.index = (this.index + 1) % this.loop.length
      return
    }
    this.group.position.addScaledVector(to, Math.min(1, (speed * dt) / dist))
    // Turn gently toward where she's going, pitching with the climb.
    const yaw = Math.atan2(-to.x, -to.z)
    const pitch = Math.atan2(to.y, Math.hypot(to.x, to.z)) * 0.6
    this.q.setFromEuler(new THREE.Euler(pitch, yaw, Math.sin(this.time * 0.9) * 0.06, 'YXZ'))
    this.group.quaternion.slerp(this.q, Math.min(1, dt * 1.5))
  }
}
