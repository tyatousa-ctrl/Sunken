import * as THREE from 'three'
import { applyCaustics } from '../world/caustics'

const CRUISE_SPEED = 1.3
/** NOS: this much faster, for this long, then this long to refill. */
const BOOST_FACTOR = 3.5
export const BOOST_SECONDS = 7
export const RECHARGE_SECONDS = 7

// A loggerhead turtle that glides a loop round the meadow and up over the top of the high reef. Anyone
// can grip her shell and ride along. Strapped to her shell is a NOS canister: press its button and she
// shoots along three and a half times as fast for 7 s; then it takes 7 s to refill.
export class Turtle {
  readonly group = new THREE.Group()
  /** Seconds of boost left (0: cruising). */
  boostLeft = 0
  /** Seconds until the canister's full again (0: ready). */
  recharge = 0
  private readonly flippers: THREE.Group[] = []
  private readonly head = new THREE.Group()
  private index = 0
  private readonly nos = new THREE.Group()
  private readonly lamp: THREE.MeshBasicMaterial
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

    // The NOS canister: a silver bottle strapped across the back of her shell, a red push-button on
    // top, and a lamp: green ready, blue boosting, orange refilling.
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8ced4, roughness: 0.25, metalness: 0.85 })
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 14).rotateZ(Math.PI / 2), steel)
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 10).rotateX(Math.PI / 2), steel)
    nozzle.position.set(0, -0.02, 0.1)
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.13, 0.13), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }))
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0xd8261d, roughness: 0.4 }))
    button.position.y = 0.075
    this.lamp = new THREE.MeshBasicMaterial({ color: 0x3cff6a })
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), this.lamp)
    lamp.position.set(0.12, 0.05, 0)
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.06), new THREE.MeshBasicMaterial({ map: nosLabel(), transparent: true }))
    label.rotation.x = -Math.PI / 2
    label.position.set(0, 0.062, 0.035)
    this.nos.add(bottle, nozzle, strap, button, lamp, label)
    this.nos.position.set(0, 0.3, 0.35)
    this.group.add(this.nos)

    this.group.position.copy(loop[0])
    parent.add(this.group)
  }

  /** The NOS button (world). */
  get nosButton(): THREE.Vector3 {
    return this.nos.localToWorld(new THREE.Vector3(0, 0.08, 0))
  }

  get nosReady(): boolean {
    return this.boostLeft === 0 && this.recharge === 0
  }

  /** Hit the NOS: true if it fired (it may be empty and refilling). */
  pressNos(): boolean {
    if (!this.nosReady) return false
    this.boostLeft = BOOST_SECONDS
    return true
  }

  /** Where a rider sits: just above her shell. */
  seat(target: THREE.Vector3): THREE.Vector3 {
    return this.group.localToWorld(target.set(0, 0.55, 0.1))
  }

  update(dt: number): void {
    this.time += dt
    // Slow, powerful strokes of the front flippers; the back ones steer.
    if (this.boostLeft > 0) {
      this.boostLeft = Math.max(0, this.boostLeft - dt)
      if (this.boostLeft === 0) this.recharge = RECHARGE_SECONDS
    } else this.recharge = Math.max(0, this.recharge - dt)
    this.lamp.color.setHex(this.boostLeft > 0 ? 0x4ab0ff : this.recharge > 0 ? 0xff9a2a : 0x3cff6a)
    const boosting = this.boostLeft > 0
    const stroke = Math.sin(this.time * (boosting ? 6 : 1.8))
    this.flippers[0].rotation.z = stroke * 0.55
    this.flippers[1].rotation.z = -stroke * 0.55
    this.flippers[2].rotation.z = stroke * 0.2
    this.flippers[3].rotation.z = -stroke * 0.2
    this.head.rotation.y = Math.sin(this.time * 0.4) * 0.25

    const goal = this.loop[this.index]
    const to = this.v.copy(goal).sub(this.group.position)
    const dist = to.length()
    const speed = CRUISE_SPEED * (boosting ? BOOST_FACTOR : 1)
    if (dist < 0.3 + (boosting ? 0.4 : 0)) {
      this.index = (this.index + 1) % this.loop.length
      return
    }
    this.group.position.addScaledVector(to, Math.min(1, (speed * dt) / dist))
    // Turn gently toward where she's going, pitching with the climb.
    const yaw = Math.atan2(-to.x, -to.z)
    const pitch = Math.atan2(to.y, Math.hypot(to.x, to.z)) * 0.6
    this.q.setFromEuler(new THREE.Euler(pitch, yaw, Math.sin(this.time * 0.9) * 0.06, 'YXZ'))
    this.group.quaternion.slerp(this.q, Math.min(1, dt * (boosting ? 4 : 1.5)))
  }
}

function nosLabel(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 76
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#1b3a8a'
  ctx.fillRect(0, 0, 256, 76)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'italic bold 58px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NOS', 128, 40)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
