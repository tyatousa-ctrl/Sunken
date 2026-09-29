import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'
import { Label } from '../ui/Label'
import { DECK_Y, halfWidthAt, type Galleon } from '../world/ship/Galleon'

const GRAVITY = 9.8
/** Seconds between the two clays of a pair: near enough together to be a double. */
export const CLAY_PAIR_GAP = 0.12
const CLAY_HIT_RADIUS = 0.4
const MAX_CLAYS = 6
/** A hand throw is too weak to fly far: speed it up (and keep it within a sporting range). */
const HAND_THROW_BOOST = 2.6
const HAND_THROW_MIN = 10
const HAND_THROW_MAX = 19
/** Lever angles (radians about the panel's axis): at rest it leans away; pulled, it's toward you. */
const LEVER_REST = -0.45
const LEVER_PULLED = 0.75
/** Pulled past this, the thrower fires; it re-arms once the lever is back near rest. */
const LEVER_FIRE = 0.5
const LEVER_REARM = -0.1
const LEVER_LENGTH = 0.3
const LEVER_COOLDOWN = 1.2

interface Clay {
  id: number
  seed: number
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  alive: boolean
  pendingAt: number
}

export interface Shooter {
  name: string
  color: string
  hits: number
  shots: number
}

export interface ClayFx {
  audio: AudioSystem
  debris: Particles
  splash: Particles
  /** A player threw a clay by hand (it's already flying here); in a crew, tell the others. */
  onThrow?: (at: THREE.Vector3, velocity: THREE.Vector3, localId: number) => void
}

// Clay pigeon shooting off the stern: a thrower on the starboard rail with a launch lever and a 1/2 switch,
// clays that shatter or splash, and a wooden scoreboard on the main mast.
export class ClayRange {
  readonly shooters: Shooter[] = [{ name: 'You', color: '#e8b930', hits: 0, shots: 0 }]
  readonly board: THREE.Mesh
  private readonly clays: Clay[] = []
  private readonly thrower = new THREE.Group()
  /** The control panel: pull the lever to launch; the switch picks one clay or two. */
  readonly lever: ClayLever
  readonly countSwitch: ClaySwitch
  /** The lever was pulled: launch this many clays (1 or 2). */
  onLever: (count: number) => void = () => {}
  /** Grab a clay off the stack and throw it yourself. */
  readonly stack: ClayStack
  private readonly sign = new Label({ width: 0.75, canvasWidth: 600, canvasHeight: 380, billboard: true })
  private readonly boardCanvas = document.createElement('canvas')
  private readonly boardTexture: THREE.CanvasTexture
  private time = 0
  private localId = 0
  private boardBroken = false
  private readonly v = new THREE.Vector3()
  private readonly toClay = new THREE.Vector3()

  constructor(
    root: THREE.Group,
    private readonly ship: Galleon,
    private readonly fx: ClayFx,
  ) {
    // Thrower on the starboard rail, aimed out over the water.
    const z = 6.2
    this.thrower.position.set(halfWidthAt(z) - 0.5, DECK_Y, z)
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.6 })
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.8 })
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), wood)
    base.position.y = 0.25
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.12), iron)
    arm.position.set(0.25, 0.6, 0)
    arm.rotation.z = 0.35
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.25, 16), new THREE.MeshStandardMaterial({ color: 0xd9632b, roughness: 0.8 }))
    stack.position.set(-0.12, 0.62, -0.15)
    this.thrower.add(base, arm, stack)
    // Control panel on a post at the inboard side, facing the deck (-x), at hip height.
    const panel = new THREE.Group()
    panel.position.set(-0.45, 0, 0.25)
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), wood)
    post.position.y = 0.4
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.34), iron)
    box.position.y = 0.9
    panel.add(post, box)
    this.thrower.add(panel)
    this.lever = new ClayLever(panel, new THREE.Vector3(0, 1.0, -0.07), fx.audio, () => this.onLever(this.countSwitch.count))
    this.countSwitch = new ClaySwitch(panel, new THREE.Vector3(-0.061, 0.9, 0.07), fx.audio)
    ship.shake.add(this.thrower)
    this.stack = new ClayStack(stack, this, clayGeometryFor())
    this.sign.mesh.position.set(0, 1.55, 0)
    this.thrower.add(this.sign.mesh)
    this.sign.set([
      { text: 'Clay Thrower', size: 40, bold: true, color: '#f2b64a' },
      { text: 'Pull the lever toward you to launch', size: 28 },
      { text: 'Flip the switch for 1 or 2 clays at once', size: 28 },
      { text: 'or grab a clay from the stack and throw it out to sea', size: 28 },
      { text: 'for your crewmates to shoot', size: 24, color: '#b9c7cf' },
    ])

    const clayGeometry = clayGeometryFor()
    const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xe0662c, roughness: 0.8 })
    for (let i = 0; i < MAX_CLAYS; i++) {
      const mesh = new THREE.Mesh(clayGeometry, clayMaterial)
      mesh.visible = false
      root.add(mesh)
      this.clays.push({ id: 0, seed: 0, mesh, velocity: new THREE.Vector3(), alive: false, pendingAt: -1 })
    }

    // Scoreboard hangs on the main mast, facing the stern where the shooters stand.
    this.boardCanvas.width = 512
    this.boardCanvas.height = 320
    this.boardTexture = new THREE.CanvasTexture(this.boardCanvas)
    this.boardTexture.colorSpace = THREE.SRGBColorSpace
    this.board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.06), [
      wood,
      wood,
      wood,
      wood,
      new THREE.MeshStandardMaterial({ map: this.boardTexture, roughness: 0.9 }),
      wood,
    ])
    this.board.position.set(0, DECK_Y + 2.7, 0.3)
    ship.shake.add(this.board)
    this.drawBoard()
  }

  get anyInFlight(): boolean {
    return this.clays.some((c) => c.alive || c.pendingAt >= 0)
  }

  /** Launch one or two clays (solo play); a pair leaves almost together. */
  pull(count: number): void {
    for (let i = 0; i < count; i++) this.launchSeeded(++this.localId, Math.floor(Math.random() * 2 ** 31), i * CLAY_PAIR_GAP)
  }

  /** Keep the sign facing you. */
  faceSign(camera: THREE.Camera): void {
    this.sign.face(camera)
  }

  /** A clay thrown by hand leaves the hand here with this (already boosted) velocity. */
  launchThrown(id: number, at: THREE.Vector3, velocity: THREE.Vector3): void {
    const clay = this.clays.find((c) => !c.alive && c.pendingAt < 0)
    if (!clay) return
    clay.id = id
    clay.alive = true
    clay.mesh.visible = true
    clay.mesh.position.copy(at)
    clay.velocity.copy(velocity)
  }

  /** The server gave our hand-thrown clay its crew-wide id. */
  renameClay(localId: number, id: number): void {
    const clay = this.clays.find((c) => c.id === localId)
    if (clay) clay.id = id
  }

  /** Called by the stack when a held clay is let go. */
  throwFromHand(at: THREE.Vector3, handVelocity: THREE.Vector3): void {
    if (handVelocity.length() < 1.2) return
    const velocity = handVelocity.clone().multiplyScalar(HAND_THROW_BOOST)
    velocity.setLength(THREE.MathUtils.clamp(velocity.length(), HAND_THROW_MIN, HAND_THROW_MAX))
    // Always some lift, so a flat throw still sails.
    velocity.y = Math.max(velocity.y, velocity.length() * 0.35)
    const localId = -++this.localId
    this.launchThrown(localId, at, velocity)
    this.fx.audio.play('thud', at, 0.5)
    this.fx.onThrow?.(at, velocity, localId)
  }

  /** Launch a clay the server announced: the seed gives every player the same flight. */
  launchSeeded(id: number, seed: number, delay: number): void {
    const clay = this.clays.find((c) => !c.alive && c.pendingAt < 0)
    if (!clay) return
    clay.id = id
    clay.seed = seed
    clay.pendingAt = this.time + delay
  }

  /**
   * Which clays a shot's pellets pass through. With `apply` (solo), they shatter and count here;
   * in a crew the server confirms the hit first.
   */
  shoot(shooter: Shooter, origin: THREE.Vector3, directions: THREE.Vector3[], apply = true): number[] {
    if (apply) shooter.shots++
    const hit: number[] = []
    for (const clay of this.clays) {
      if (!clay.alive) continue
      for (const dir of directions) {
        this.toClay.subVectors(clay.mesh.position, origin)
        const along = this.toClay.dot(dir)
        if (along < 0) continue
        const miss = this.toClay.addScaledVector(dir, -along).length()
        if (miss < CLAY_HIT_RADIUS) {
          hit.push(clay.id)
          if (apply) this.shatter(clay)
          break
        }
      }
    }
    if (apply) {
      shooter.hits += hit.length
      this.drawBoard()
    }
    return hit
  }

  /** The server confirmed a hit. */
  shatterById(id: number): void {
    const clay = this.clays.find((c) => c.alive && c.id === id)
    if (clay) this.shatter(clay)
  }

  /** Crew scoreboard from the server's roster. */
  setShooters(list: Shooter[]): void {
    const same = list.length === this.shooters.length && list.every((s, i) => {
      const o = this.shooters[i]
      return o.name === s.name && o.hits === s.hits && o.shots === s.shots && o.color === s.color
    })
    if (same) return
    this.shooters.splice(0, this.shooters.length, ...list)
    this.drawBoard()
  }

  breakBoard(): void {
    if (this.boardBroken) return
    this.boardBroken = true
    this.board.getWorldPosition(this.v)
    this.board.visible = false
    this.fx.debris.emit({ position: this.v, spread: 5, velocity: new THREE.Vector3(0, 2, 2), color: 0x6b4527, size: 0.12, life: 2.2, count: 40 })
    this.fx.debris.emit({ position: this.v, spread: 3, color: 0x2a2a2a, size: 0.08, life: 1.5, count: 20 })
  }

  update(dt: number): void {
    this.time += dt
    this.lever.tick(dt)
    for (const clay of this.clays) {
      if (clay.pendingAt >= 0 && this.time >= clay.pendingAt) this.launch(clay)
      if (!clay.alive) continue
      clay.velocity.y -= GRAVITY * dt
      clay.mesh.position.addScaledVector(clay.velocity, dt)
      clay.mesh.rotation.y += dt * 20
      if (clay.mesh.position.y < 0) {
        clay.alive = false
        clay.mesh.visible = false
        this.fx.splash.emit({ position: clay.mesh.position.clone().setY(0.05), velocity: new THREE.Vector3(0, 3, 0), spread: 1.2, color: 0xeaf6ff, size: 0.18, life: 0.9, count: 18 })
        this.fx.audio.play('splash', clay.mesh.position, 0.7)
      }
    }
  }

  private launch(clay: Clay): void {
    clay.pendingAt = -1
    clay.alive = true
    clay.mesh.visible = true
    this.thrower.localToWorld(clay.mesh.position.set(0.6, 0.75, 0))
    // Out to starboard, anywhere from slightly forward to well astern (seeded, so everyone agrees).
    let s = clay.seed || 1
    const random = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
    const yaw = -0.6 + random() * 0.75
    const speed = 12 + random() * 4
    clay.velocity.set(Math.cos(yaw) * speed, 7 + random() * 2.2, -Math.sin(yaw) * speed)
    clay.velocity.applyQuaternion(this.ship.group.quaternion)
    this.fx.audio.play('thud', clay.mesh.position, 0.8)
  }

  private shatter(clay: Clay): void {
    clay.alive = false
    clay.mesh.visible = false
    const at = clay.mesh.position
    this.fx.debris.emit({ position: at, velocity: clay.velocity.clone().multiplyScalar(0.4), spread: 2.5, color: 0xe0662c, size: 0.06, life: 1.6, count: 24 })
    this.fx.debris.emit({ position: at, velocity: clay.velocity.clone().multiplyScalar(0.3), spread: 1, color: 0x8a6a55, size: 0.2, endSize: 0.5, life: 0.5, count: 4, alpha: 0.5 })
    this.fx.audio.play('crack', at)
  }

  private drawBoard(): void {
    const ctx = this.boardCanvas.getContext('2d')!
    ctx.fillStyle = '#2f3b2c'
    ctx.fillRect(0, 0, 512, 320)
    ctx.strokeStyle = '#8a5a2b'
    ctx.lineWidth = 14
    ctx.strokeRect(7, 7, 498, 306)
    ctx.fillStyle = '#f0ead8'
    ctx.font = 'bold 40px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.fillText('Clay Shoot', 256, 62)
    ctx.font = '24px Georgia, serif'
    ctx.fillStyle = '#cfc7b0'
    ctx.textAlign = 'left'
    ctx.fillText('Shooter', 40, 110)
    ctx.textAlign = 'right'
    ctx.fillText('Hits', 360, 110)
    ctx.fillText('Shots', 470, 110)
    const sorted = [...this.shooters].sort((a, b) => b.hits - a.hits)
    sorted.forEach((s, i) => {
      const y = 158 + i * 44
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(52, y - 10, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#f0ead8'
      ctx.font = 'bold 32px Georgia, serif'
      ctx.textAlign = 'left'
      ctx.fillText(s.name, 76, y)
      ctx.textAlign = 'right'
      ctx.fillText(String(s.hits), 360, y)
      ctx.fillText(String(s.shots), 470, y)
    })
    this.boardTexture.needsUpdate = true
  }
}

let sharedClayGeometry: THREE.BufferGeometry | null = null
function clayGeometryFor(): THREE.BufferGeometry {
  sharedClayGeometry ??= new THREE.CylinderGeometry(0.11, 0.08, 0.03, 16)
  return sharedClayGeometry
}

// The stack of clays on the thrower: grip it to take one, then throw it (let go mid-swing).
export class ClayStack implements Interactable {
  private held: THREE.Mesh | null = null
  private holder: Hand | null = null
  private readonly home: THREE.Vector3
  private readonly v = new THREE.Vector3()

  constructor(
    readonly object: THREE.Mesh,
    private readonly range: ClayRange,
    geometry: THREE.BufferGeometry,
  ) {
    this.home = object.position.clone()
    this.held = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xe0662c, roughness: 0.8 }))
    this.held.visible = false
  }

  grabGap(point: THREE.Vector3, hand: Hand): number {
    if (this.holder === hand) return Infinity
    return point.distanceTo(this.object.getWorldPosition(this.v)) - 0.16
  }

  grab(hand: Hand): void {
    // If it was pulled from a distance, the stack goes back on the thrower; you keep one clay.
    this.object.position.copy(this.home)
    this.holder = hand
    const clay = this.held!
    hand.grip.add(clay)
    clay.position.set(0, -0.01, -0.06)
    clay.rotation.set(0, 0, 0)
    clay.visible = true
    hand.pulse(0.25, 25)
  }

  release(hand: Hand, throwVelocity: THREE.Vector3): void {
    if (hand !== this.holder) return
    this.holder = null
    const clay = this.held!
    const at = clay.getWorldPosition(new THREE.Vector3())
    clay.visible = false
    clay.removeFromParent()
    this.range.throwFromHand(at, throwVelocity)
  }

  setHighlight(on: boolean): void {
    ;(this.object.material as THREE.MeshStandardMaterial).emissive.setHex(on ? 0x2e7896 : 0x000000)
  }
}

// The launch lever: grip the red knob and pull it toward you. Past the notch the thrower fires (a
// clunk and a jolt in the hand); let go and it springs back, ready again.
export class ClayLever implements Interactable {
  readonly object = new THREE.Group()
  readonly pullable = false
  private readonly knob: THREE.Mesh
  private holder: Hand | null = null
  private angle = LEVER_REST
  private armed = true
  private cooldown = 0
  private readonly v = new THREE.Vector3()

  constructor(
    panel: THREE.Object3D,
    at: THREE.Vector3,
    private readonly audio: AudioSystem,
    private readonly fire: () => void,
  ) {
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.4, metalness: 0.7 })
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 12).rotateX(Math.PI / 2), iron)
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, LEVER_LENGTH, 8), iron)
    rod.position.y = LEVER_LENGTH / 2
    this.knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), new THREE.MeshStandardMaterial({ color: 0xc0271d, roughness: 0.35 }))
    this.knob.position.y = LEVER_LENGTH
    this.object.add(hub, rod, this.knob)
    this.object.position.copy(at)
    panel.add(this.object)
    this.setAngle(LEVER_REST)
  }

  grabGap(point: THREE.Vector3, hand: Hand): number {
    if (this.holder && this.holder !== hand) return Infinity
    // Knob or anywhere on the upper half of the rod.
    const knob = this.knob.getWorldPosition(this.v)
    return Math.min(point.distanceTo(knob) - 0.05, point.distanceTo(this.object.localToWorld(this.v.set(0, LEVER_LENGTH * 0.6, 0))) - 0.04)
  }

  grab(hand: Hand): void {
    hand.pulse(0.3, 30)
    // Keyboard and mouse: one grab is one full pull.
    if (hand.virtual) {
      this.setAngle(LEVER_PULLED)
      this.trigger(hand)
      this.armed = true
      hand.held = null
      return
    }
    this.holder = hand
  }

  release(hand: Hand): void {
    if (hand === this.holder) this.holder = null
  }

  setHighlight(on: boolean): void {
    ;(this.knob.material as THREE.MeshStandardMaterial).emissive.setHex(on ? 0x5a2020 : 0x000000)
  }

  update(): void {
    const hand = this.holder
    if (!hand) return
    // The hand's position round the pivot, in the panel's frame: toward the deck (-x) is "pulled".
    const local = this.object.parent!.worldToLocal(hand.worldPos(this.v)).sub(this.object.position)
    const target = THREE.MathUtils.clamp(Math.atan2(-local.x, Math.max(0.02, local.y)), LEVER_REST, LEVER_PULLED)
    this.setAngle(target)
    if (this.armed && this.angle > LEVER_FIRE) this.trigger(hand)
    if (!this.armed && this.angle < LEVER_REARM) this.armed = true
  }

  /** Springs back when nobody holds it. */
  tick(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt)
    if (this.holder) return
    this.setAngle(this.angle + (LEVER_REST - this.angle) * (1 - Math.exp(-10 * dt)))
    if (this.angle < LEVER_REARM) this.armed = true
  }

  private trigger(hand: Hand): void {
    this.armed = false
    this.object.getWorldPosition(this.v)
    this.audio.play('thud', this.v, 0.9)
    hand.pulse(0.8, 70)
    if (this.cooldown > 0) return
    this.cooldown = LEVER_COOLDOWN
    this.fire()
  }

  private setAngle(angle: number): void {
    this.angle = angle
    // Positive tips the top toward -x (the deck side, toward whoever's pulling).
    this.object.rotation.z = angle
  }
}

// A toggle switch on the panel: flip it (touch or grip it) between 1 and 2 clays per pull.
export class ClaySwitch implements Interactable {
  readonly object = new THREE.Group()
  readonly pullable = false
  count: 1 | 2 = 1
  private readonly bat: THREE.Mesh
  private readonly plate: THREE.Mesh
  private readonly canvas = document.createElement('canvas')
  private readonly texture: THREE.CanvasTexture
  private touchCooldown = 0
  private touching = false
  private readonly v = new THREE.Vector3()

  constructor(
    panel: THREE.Object3D,
    at: THREE.Vector3,
    private readonly audio: AudioSystem,
  ) {
    this.canvas.width = 256
    this.canvas.height = 128
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    // The plate faces the deck (-x).
    this.plate = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), new THREE.MeshBasicMaterial({ map: this.texture }))
    this.plate.rotation.y = -Math.PI / 2
    const brass = new THREE.MeshStandardMaterial({ color: 0xc19a3e, roughness: 0.35, metalness: 0.8 })
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 12).rotateZ(Math.PI / 2), brass)
    collar.position.x = -0.006
    // The bat sticks out toward the deck and tips left (1) or right (2).
    this.bat = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.05, 8).translate(0, 0.025, 0).rotateZ(Math.PI / 2), brass)
    this.bat.position.x = -0.012
    this.object.add(this.plate, collar, this.bat)
    this.object.position.copy(at)
    panel.add(this.object)
    this.set(1, false)
  }

  grabGap(point: THREE.Vector3): number {
    return point.distanceTo(this.object.getWorldPosition(this.v)) - 0.06
  }

  grab(hand: Hand): void {
    this.flip(hand)
    hand.held = null
  }

  release(): void {}

  setHighlight(on: boolean): void {
    ;(this.bat.material as THREE.MeshStandardMaterial).emissive.setHex(on ? 0x2e7896 : 0x000000)
  }

  update(dt: number): void {
    this.touchCooldown = Math.max(0, this.touchCooldown - dt)
  }

  /** Poke it with a hand (any hand, even one holding a gun) to flip it too. */
  touch(hands: Hand[]): void {
    this.object.getWorldPosition(this.v)
    const hand = hands.find((h) => h.connected && h.worldPos(new THREE.Vector3()).distanceTo(this.v) < 0.09)
    if (hand && !this.touching && this.touchCooldown === 0) this.flip(hand)
    this.touching = !!hand
  }

  private flip(hand: Hand): void {
    this.touchCooldown = 0.5
    this.set(this.count === 1 ? 2 : 1, true)
    hand.pulse(0.4, 30)
  }

  private set(count: 1 | 2, sound: boolean): void {
    this.count = count
    // Tipped toward the "1" (ship-forward, -z) side or the "2" side.
    this.bat.rotation.set(0, count === 1 ? -0.5 : 0.5, 0)
    if (sound) this.audio.play('click', this.object.getWorldPosition(this.v), 0.8)
    const ctx = this.canvas.getContext('2d')!
    ctx.fillStyle = '#1b1d20'
    ctx.fillRect(0, 0, 256, 128)
    ctx.font = 'bold 22px monospace'
    ctx.fillStyle = '#c9b98f'
    ctx.textAlign = 'center'
    ctx.fillText('CLAYS', 128, 26)
    ctx.font = 'bold 64px monospace'
    for (const [n, x] of [[1, 48], [2, 208]] as const) {
      const on = n === count
      ctx.fillStyle = on ? '#ffcf4a' : '#4a4a4a'
      ctx.fillText(String(n), x, 104)
      if (on) {
        ctx.beginPath()
        ctx.arc(x, 44, 7, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    this.texture.needsUpdate = true
  }
}
