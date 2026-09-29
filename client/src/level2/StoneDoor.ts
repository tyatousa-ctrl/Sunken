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

/** The shape carved in a dial's middle; the clue stones frame their marks in the same shapes. */
export type Emblem = 'circle' | 'square' | 'triangle'

/** The three dials, left to right as you face the door: numbers, letters, signs. */
export const DIAL_SETS: { symbols: string[]; emblem: Emblem }[] = [
  { symbols: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], emblem: 'circle' },
  { symbols: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], emblem: 'square' },
  { symbols: ['!', '@', '#', '$', '%', '&', '?', '*', '+', '='], emblem: 'triangle' },
]

// The door of stone: a carved slab set into the reef that grinds down into the sand when opened,
// and in front of it three stone dials (numbers, letters, signs). Grip a dial's rim and turn it; it
// settles on the mark under the notch at the top when you let go.
export class StoneDoor {
  readonly group = new THREE.Group()
  readonly collider: BoxCollider
  readonly dials: StoneDial[]
  opened = false
  private readonly slab: THREE.Mesh
  private openT = -1

  constructor(
    position: THREE.Vector3,
    private readonly audio: AudioSystem,
    dialOffsets: THREE.Vector3[],
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

    this.dials = DIAL_SETS.map((set, i) => {
      const dial = new StoneDial(audio, set.symbols, set.emblem)
      dial.group.position.copy(dialOffsets[i])
      this.group.add(dial.group)
      return dial
    })
  }

  /** What the dials show, read left to right (e.g. "2C!"). */
  get code(): string {
    return this.dials.map((d) => d.symbol).join('')
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
    for (const dial of this.dials) dial.update()
    if (this.openT < 0 || this.openT >= 1) return
    this.openT = Math.min(1, this.openT + dt / OPEN_SECONDS)
    this.slab.position.y = DOOR_H / 2 - this.openT * DOOR_H
    // A slight shudder as it grinds.
    this.slab.position.x = Math.sin(this.openT * 90) * 0.01
  }
}

// A round stone lock with ten marks round its face. `onSet` is called with the mark when a turn settles.
export class StoneDial implements Interactable {
  readonly group = new THREE.Group()
  readonly pullable = false
  /** Index of the mark under the notch. */
  value = 0
  onSet: (symbol: string) => void = () => {}
  private readonly step: number
  private readonly face = new THREE.Group()
  private readonly holds = new Map<Hand, number>()
  private angle = 0
  private lastDigit = 0
  private readonly material: THREE.MeshStandardMaterial
  private readonly v = new THREE.Vector3()

  constructor(
    private readonly audio: AudioSystem,
    readonly symbols: string[],
    emblem: Emblem,
  ) {
    this.step = (Math.PI * 2) / symbols.length
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 1.3, 8), new THREE.MeshStandardMaterial({ color: 0x5b554c, roughness: 1, flatShading: true }))
    post.position.y = 0.65
    this.group.add(post)
    this.material = new THREE.MeshStandardMaterial({ map: makeDialTexture(symbols, emblem), roughness: 0.9 })
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

  /** The mark under the notch. */
  get symbol(): string {
    return this.symbols[this.value]
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
    this.angle = Math.round(this.angle / this.step) * this.step
    this.face.rotation.z = -this.angle
    this.value = this.digitAt(this.angle)
    this.audio.play('thud', this.center, 0.7)
    hand.pulse(0.5, 60)
    this.onSet(this.symbol)
  }

  setHighlight(on: boolean): void {
    this.material.emissive.setHex(on ? 0x2e7896 : 0x000000)
  }

  /** Show a mark (a crewmate turned it, or the crew already solved it); ignored while you hold it. */
  show(symbol: string): void {
    const i = this.symbols.indexOf(symbol)
    if (i < 0 || this.holds.size > 0) return
    this.value = this.lastDigit = i
    this.angle = i * this.step
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

  /** Turning clockwise (as you face it) brings the next mark up to the notch. */
  private digitAt(angle: number): number {
    const n = this.symbols.length
    const k = Math.round(angle / this.step)
    return ((k % n) + n) % n
  }

  /** Measured in the dial's fixed frame (not the turning face, or the turn would cancel itself). */
  private handAngle(hand: Hand): number {
    const p = this.group.worldToLocal(hand.worldPos(this.v)).sub(this.face.position)
    return Math.atan2(p.x, p.y)
  }
}

/** The marks carved round the dial (mark k sits k steps anticlockwise from the top), and its emblem. */
function makeDialTexture(symbols: string[], emblem: Emblem): THREE.CanvasTexture {
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
  ctx.fillStyle = '#2f2a23'
  ctx.font = 'bold 66px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const step = (Math.PI * 2) / symbols.length
  symbols.forEach((symbol, k) => {
    // The face turns clockwise by `angle` to bring mark k up, so k is printed anticlockwise of the first.
    const a = -k * step
    ctx.save()
    ctx.translate(256 + Math.sin(a) * 175, 256 - Math.cos(a) * 175)
    ctx.rotate(a)
    ctx.fillText(symbol, 0, 0)
    ctx.restore()
  })
  // The emblem in the middle: the shape its clue stone frames its mark in.
  ctx.lineWidth = 14
  drawEmblem(ctx, emblem, 256, 256, 62)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Outline of a circle, square or triangle centred on (x, y). */
export function drawEmblem(ctx: CanvasRenderingContext2D, emblem: Emblem, x: number, y: number, r: number): void {
  ctx.beginPath()
  if (emblem === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2)
  else if (emblem === 'square') ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8)
  else {
    ctx.moveTo(x, y - r * 1.05)
    ctx.lineTo(x + r * 1.05, y + r * 0.75)
    ctx.lineTo(x - r * 1.05, y + r * 0.75)
    ctx.closePath()
  }
  ctx.stroke()
}

/** Weathered stone with a wave border and the three dials' shapes. */
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
  // A wave border and the three carved shapes, one for each dial.
  ctx.beginPath()
  for (let x = 24; x <= 232; x += 4) ctx.lineTo(x, 40 + Math.sin(x * 0.12) * 8)
  ctx.stroke()
  drawEmblem(ctx, 'circle', 60, 175, 28)
  drawEmblem(ctx, 'square', 128, 175, 28)
  drawEmblem(ctx, 'triangle', 196, 178, 28)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
