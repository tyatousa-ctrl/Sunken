import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'
import type { BoxCollider } from '../movement/environment'
import { applyCaustics } from '../world/caustics'

const DOOR_W = 2.6
const DOOR_H = 3.2
const OPEN_SECONDS = 3.5
const DIAL_RADIUS = 0.42
const DIGITS = 9
const STEP = (Math.PI * 2) / DIGITS

// The door of stone: a carved slab set into the reef that grinds down into the sand when opened,
// and beside it a stone dial with the numbers 1 to 9 round its face. Grip the rim and turn it; it
// settles on the number under the notch at the top when you let go.
export class StoneDoor {
  readonly group = new THREE.Group()
  readonly collider: BoxCollider
  readonly dial: StoneDial
  opened = false
  private readonly slab: THREE.Mesh
  private openT = -1

  constructor(
    position: THREE.Vector3,
    private readonly audio: AudioSystem,
    dialOffset: THREE.Vector3,
  ) {
    const stone = new THREE.MeshStandardMaterial({ map: makeDoorTexture(), roughness: 0.95 })
    applyCaustics(stone, 0.5)
    this.slab = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.4), stone)
    this.slab.position.y = DOOR_H / 2
    this.group.add(this.slab)
    // Lintel stone across the top.
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 1.2, 0.6, 0.8), new THREE.MeshStandardMaterial({ color: 0x5b554c, roughness: 1, flatShading: true }))
    lintel.position.y = DOOR_H + 0.3
    this.group.add(lintel)
    this.group.position.copy(position)
    this.group.updateMatrixWorld(true)
    const matrix = new THREE.Matrix4().makeTranslation(0, DOOR_H / 2, 0).premultiply(this.group.matrixWorld)
    this.collider = { matrix, inverse: matrix.clone().invert(), half: new THREE.Vector3(DOOR_W / 2, DOOR_H / 2, 0.3) }

    this.dial = new StoneDial(audio)
    this.dial.group.position.copy(dialOffset)
    this.group.add(this.dial.group)
  }

  /** Middle of the doorway (world). */
  get center(): THREE.Vector3 {
    return this.group.localToWorld(new THREE.Vector3(0, DOOR_H / 2, 0))
  }

  open(): void {
    if (this.opened) return
    this.opened = true
    this.openT = 0
    this.audio.play('impact', this.center, 0.8)
  }

  /** Already open (catching up with the crew): no grinding. */
  openNow(): void {
    this.opened = true
    this.openT = 1
    this.slab.position.y = -DOOR_H / 2
  }

  update(dt: number): void {
    this.dial.update()
    if (this.openT < 0 || this.openT >= 1) return
    this.openT = Math.min(1, this.openT + dt / OPEN_SECONDS)
    this.slab.position.y = DOOR_H / 2 - this.openT * DOOR_H
    // A slight shudder as it grinds.
    this.slab.position.x = Math.sin(this.openT * 90) * 0.01
  }
}

// A round stone lock with nine numbers. `onSet` is called with the number when a turn settles.
export class StoneDial implements Interactable {
  readonly group = new THREE.Group()
  /** The number under the notch (1–9). */
  value = 1
  onSet: (value: number) => void = () => {}
  private readonly face = new THREE.Group()
  private readonly holds = new Map<Hand, number>()
  private angle = 0
  private lastDigit = 1
  private readonly material: THREE.MeshStandardMaterial
  private readonly v = new THREE.Vector3()

  constructor(private readonly audio: AudioSystem) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 1.3, 8), new THREE.MeshStandardMaterial({ color: 0x5b554c, roughness: 1, flatShading: true }))
    post.position.y = 0.65
    this.group.add(post)
    this.material = new THREE.MeshStandardMaterial({ map: makeDialTexture(), roughness: 0.9 })
    applyCaustics(this.material, 0.4)
    // The face is a thick stone disc facing +z, turning about z.
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(DIAL_RADIUS, DIAL_RADIUS, 0.12, 36), [
      new THREE.MeshStandardMaterial({ color: 0x6d665b, roughness: 1 }),
      this.material,
      this.material,
    ])
    disc.rotation.x = Math.PI / 2
    this.face.add(disc)
    this.face.position.set(0, 1.6, 0.05)
    this.group.add(this.face)
    // The notch at the top that marks the chosen number.
    const notch = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 4), new THREE.MeshStandardMaterial({ color: 0xc59a3c, roughness: 0.4, metalness: 0.6 }))
    notch.rotation.z = Math.PI
    notch.position.set(0, 1.6 + DIAL_RADIUS + 0.1, 0.1)
    this.group.add(notch)
  }

  get held(): boolean {
    return this.holds.size > 0
  }

  /** World centre of the dial's face. */
  get center(): THREE.Vector3 {
    return this.face.getWorldPosition(new THREE.Vector3())
  }

  grabGap(point: THREE.Vector3): number {
    const p = this.face.worldToLocal(this.v.copy(point))
    const r = Math.hypot(p.x, p.y)
    return Math.hypot(Math.max(0, r - DIAL_RADIUS), p.z) - 0.1
  }

  grab(hand: Hand): void {
    this.holds.set(hand, this.handAngle(hand))
    hand.pulse(0.3, 30)
  }

  release(hand: Hand): void {
    this.holds.delete(hand)
    if (this.holds.size > 0) return
    // Settle on the nearest number with a heavy click.
    this.angle = Math.round(this.angle / STEP) * STEP
    this.face.rotation.z = -this.angle
    this.value = this.digitAt(this.angle)
    this.audio.play('thud', this.center, 0.7)
    hand.pulse(0.5, 60)
    this.onSet(this.value)
  }

  setHighlight(on: boolean): void {
    this.material.emissive.setHex(on ? 0x2e7896 : 0x000000)
  }

  /** Show a number (e.g. the crew already solved it). */
  show(value: number): void {
    this.value = value
    this.angle = (value - 1) * STEP
    this.face.rotation.z = -this.angle
  }

  update(): void {
    if (this.holds.size === 0) return
    let turn = 0
    for (const [hand, last] of this.holds) {
      const now = this.handAngle(hand)
      let d = now - last
      if (d > Math.PI) d -= Math.PI * 2
      if (d < -Math.PI) d += Math.PI * 2
      turn += d
      this.holds.set(hand, now)
    }
    this.angle += turn / this.holds.size
    this.face.rotation.z = -this.angle
    // A little tick as each number passes the notch.
    const digit = this.digitAt(this.angle)
    if (digit !== this.lastDigit) {
      this.lastDigit = digit
      this.audio.play('click', this.center, 0.5)
      for (const hand of this.holds.keys()) hand.pulse(0.2, 20)
    }
  }

  /** Turning clockwise (as you face it) brings the next number up to the notch. */
  private digitAt(angle: number): number {
    const k = Math.round(angle / STEP)
    return ((((k % DIGITS) + DIGITS) % DIGITS) + 1)
  }

  /** Measured in the dial's fixed frame (not the turning face, or the turn would cancel itself). */
  private handAngle(hand: Hand): number {
    const p = this.group.worldToLocal(hand.worldPos(this.v)).sub(this.face.position)
    return Math.atan2(p.x, p.y)
  }
}

/** Numbers 1–9 carved round the dial; number k sits (k-1) steps anticlockwise from the top. */
function makeDialTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#7d7466'
  ctx.fillRect(0, 0, 512, 512)
  ctx.strokeStyle = '#4b4439'
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.arc(256, 256, 236, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(256, 256, 70, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#2f2a23'
  ctx.font = 'bold 84px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let k = 1; k <= DIGITS; k++) {
    // The face turns clockwise by `angle` to bring number k up, so k is printed anticlockwise of 1.
    const a = -(k - 1) * STEP
    const x = 256 + Math.sin(a) * 165
    const y = 256 - Math.cos(a) * 165
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(a)
    ctx.fillText(String(k), 0, 0)
    ctx.restore()
  }
  // A carved starfish in the middle: the clue's "stars".
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 55 : 22
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    ctx.lineTo(256 + Math.cos(a) * r, 256 + Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Weathered stone with a wave border and a big carved starfish. */
function makeDoorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 320
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#6d665b'
  ctx.fillRect(0, 0, 256, 320)
  let seed = 3
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(${40 + rand() * 40}, ${38 + rand() * 30}, ${30 + rand() * 25}, 0.25)`
    ctx.fillRect(rand() * 256, rand() * 320, 2 + rand() * 6, 2 + rand() * 6)
  }
  ctx.strokeStyle = '#3f392f'
  ctx.lineWidth = 6
  ctx.strokeRect(14, 14, 228, 292)
  // A wave border and a big carved star.
  ctx.beginPath()
  for (let x = 24; x <= 232; x += 4) ctx.lineTo(x, 40 + Math.sin(x * 0.12) * 8)
  ctx.stroke()
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 70 : 28
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    ctx.lineTo(128 + Math.cos(a) * r, 175 + Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
