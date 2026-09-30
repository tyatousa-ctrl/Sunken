import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'
import type { Player } from '../movement/Player'
import { Label } from '../ui/Label'
import { DECK_Y, NEST_FLOOR_Y, type Galleon } from '../world/ship/Galleon'
import { deckHalfWidth } from './deck'
import { ROOF_Y } from './Quarterdeck'

/**
 * A zipline's ship-local points: the part you slide along (`top` just outside the crow's nest rim at
 * head height, down to a stopper knot at `stop`), and where the rope is made fast at each end.
 */
export interface ZiplineRoute {
  top: THREE.Vector3
  stop: THREE.Vector3
  mastTie: THREE.Vector3
  railTie: THREE.Vector3
  /** Where the slide down lands you: said on the sign at the top. */
  to: string
  /** Where zipping up it takes you: said on the sign at the bottom. */
  from: string
}

const LAND_Z = 5.2
/** From the main nest down and aft to the starboard side of the main deck. */
export const DECK_ROUTE: ZiplineRoute = {
  top: new THREE.Vector3(0.72, NEST_FLOOR_Y + 1.85, 0.62),
  stop: new THREE.Vector3(deckHalfWidth(LAND_Z) - 0.9, DECK_Y + 2.1, LAND_Z),
  mastTie: new THREE.Vector3(0.12, NEST_FLOOR_Y + 2.5, 0.12),
  railTie: new THREE.Vector3(deckHalfWidth(LAND_Z + 0.4) - 0.08, DECK_Y + 1.0, LAND_Z + 0.4),
  to: 'the main deck',
  from: 'the crow\'s nest',
}
/** From the main nest aft to the quarterdeck, where Polly perches (a gentler run). */
export const POLLY_ROUTE: ZiplineRoute = {
  top: new THREE.Vector3(-0.72, NEST_FLOOR_Y + 1.85, 0.62),
  stop: new THREE.Vector3(-0.6, ROOF_Y + 2.1, 10.3),
  mastTie: new THREE.Vector3(-0.12, NEST_FLOOR_Y + 2.5, 0.12),
  railTie: new THREE.Vector3(-0.6, ROOF_Y + 1.0, 12.95),
  to: 'the quarterdeck, by Polly',
  from: 'the crow\'s nest',
}
/** Sliding speed (m/s) with one hand on the rope, and braking with both; zipping up is slower. */
const SPEED = 4
const BRAKED_SPEED = 2
const UP_SPEED = 2.6
const ACCELERATION = 5
/** Grip within this of the rope to take hold. */
const GRAB_REACH = 0.08

/** What happens at each end of a ride (landing in a crow's nest); without one, you drop off. */
export interface ZiplineEnds {
  top?: () => void
  stop?: () => void
}

// A zipline: a rope from a crow's nest down to the deck (or across to the other nest). Grip it and hold
// on: you slide the way you're facing, down it or up it, the rope whirring through your hand. Push the
// thumbstick back to change direction, grip with your other hand too to brake. Let go on the way and you
// drop; at a knot you drop off, and at a nest you climb in.
export class Zipline implements Interactable {
  readonly pullable = false
  private rider: Hand | null = null
  private brake: Hand | null = null
  private t = 0
  /** +1: toward `stop` (usually down); -1: toward `top` (zipping up). */
  private dir = 1
  private flipCooldown = 0
  private speed = 0
  private buzz = 0
  private whirr = 0
  private readonly rope: THREE.Mesh
  private readonly top = new THREE.Vector3()
  private readonly stop = new THREE.Vector3()
  private readonly sign = new Label({ width: 0.55, canvasWidth: 560, canvasHeight: 300, billboard: true })
  private readonly bottomSign = new Label({ width: 0.5, canvasWidth: 560, canvasHeight: 300, billboard: true })
  private readonly v = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly line = new THREE.Line3()

  constructor(
    private readonly ship: Galleon,
    private readonly rig: THREE.Object3D,
    private readonly player: Player,
    private readonly audio: AudioSystem,
    private readonly route: ZiplineRoute = DECK_ROUTE,
    private readonly landing: ZiplineEnds = {},
    private readonly camera: THREE.Camera | null = null,
  ) {
    const { top: TOP, stop: STOP, mastTie: MAST_TIE, railTie: RAIL_TIE } = route
    const tar = new THREE.MeshStandardMaterial({ color: 0x7a5c38, roughness: 0.95 })
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1b, roughness: 0.85 })
    this.rope = ropeBetween(TOP, STOP, 0.016, tar)
    ship.shake.add(this.rope, ropeBetween(MAST_TIE, TOP, 0.016, tar), ropeBetween(STOP, RAIL_TIE, 0.016, tar))
    // The stopper knot, and a wooden block where the rope is lashed at the rail.
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), tar)
    knot.position.copy(STOP)
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.2), wood)
    cleat.position.copy(RAIL_TIE)
    ship.shake.add(knot, cleat)

    // A sign hanging by the top of the rope, in the nest.
    this.sign.mesh.position.set(TOP.x * 0.5, TOP.y - 0.3, TOP.z + 0.1 * Math.sign(TOP.z || 1))
    ship.shake.add(this.sign.mesh)
    this.sign.set(signLines(route.to))
    // And one at the bottom end, for zipping up.
    this.bottomSign.mesh.position.copy(STOP).add(new THREE.Vector3(0, -0.45, 0))
    ship.shake.add(this.bottomSign.mesh)
    this.bottomSign.set(signLines(route.from))
  }

  get riding(): boolean {
    return this.rider !== null
  }

  /** Keep the sign facing you. */
  face(camera: THREE.Camera): void {
    this.sign.face(camera)
    this.bottomSign.face(camera)
  }

  grabGap(point: THREE.Vector3, hand: Hand): number {
    if (hand === this.rider || hand === this.brake) return Infinity
    this.ends()
    this.line.closestPointToPoint(point, true, this.v)
    return point.distanceTo(this.v) - GRAB_REACH
  }

  grab(hand: Hand): void {
    hand.pulse(0.4, 40)
    if (this.rider) {
      this.brake = hand
      return
    }
    this.ends()
    this.t = this.line.closestPointToPointParameter(hand.worldPos(this.v), true)
    // Go the way you're facing along the rope (at either end, the only way there is).
    this.dir = this.facingDir()
    if (this.t > 0.97) this.dir = -1
    else if (this.t < 0.03) this.dir = 1
    this.rider = hand
    this.speed = 0
    this.player.riding = true
  }

  /** +1 if you face toward the `stop` end, -1 if toward the `top` (downhill when unsure). */
  private facingDir(): number {
    if (!this.camera) return 1
    const along = this.v2.subVectors(this.line.end, this.line.start).setY(0)
    const facing = this.camera.getWorldDirection(this.v).setY(0)
    if (along.lengthSq() < 1e-6 || facing.lengthSq() < 1e-6) return 1
    const dot = along.normalize().dot(facing.normalize())
    return Math.abs(dot) < 0.2 ? 1 : Math.sign(dot)
  }

  release(hand: Hand): void {
    if (hand === this.brake) {
      this.brake = null
      return
    }
    if (hand !== this.rider) return
    // Still holding on with the other hand: that one carries you.
    if (this.brake) {
      this.rider = this.brake
      this.brake = null
      return
    }
    this.letGo()
  }

  /** Off the rope now (the attack started, or you reached the bottom). */
  forceRelease(): void {
    for (const hand of [this.brake, this.rider]) if (hand && hand.held === this) hand.held = null
    this.brake = null
    this.letGo()
  }

  setHighlight(on: boolean): void {
    ;(this.rope.material as THREE.MeshStandardMaterial).emissive.setHex(on ? 0x2e5a70 : 0x000000)
  }

  update(dt: number): void {
    const hand = this.rider
    if (!hand) return
    this.ends()
    const length = this.line.distance()
    // Thumbstick back (on the gripping hand): the other way.
    this.flipCooldown = Math.max(0, this.flipCooldown - dt)
    if (this.flipCooldown === 0 && hand.stick.y > 0.7) {
      this.dir = -this.dir
      this.speed = 0
      this.flipCooldown = 0.8
      hand.pulse(0.4, 40)
    }
    const up = (this.line.end.y - this.line.start.y) * this.dir > 0.2
    const target = this.brake ? BRAKED_SPEED : up ? UP_SPEED : SPEED
    this.speed += THREE.MathUtils.clamp(target - this.speed, -ACCELERATION * 2 * dt, ACCELERATION * dt)
    this.t = THREE.MathUtils.clamp(this.t + (this.dir * this.speed * dt) / length, 0, 1)
    // Carry the body so the gripping hand stays on the rope.
    this.line.at(this.t, this.v)
    this.rig.position.add(this.v.sub(hand.worldPos(this.v2)))
    this.rig.updateMatrixWorld(true)

    // The rope running through your glove: a steady buzz and a whirr.
    this.buzz -= dt
    if (this.buzz <= 0) {
      this.buzz = 0.06
      const strength = 0.12 + 0.25 * (this.speed / SPEED)
      hand.pulse(strength, 50)
      this.brake?.pulse(strength * 1.3, 50)
    }
    this.whirr -= dt
    if (this.whirr <= 0 && this.speed > 0.8) {
      this.whirr = 0.3
      this.audio.play('zip', hand.worldPos(this.v2), 0.4 + 0.4 * (this.speed / SPEED))
    }

    const arrived = this.dir > 0 ? this.t >= 1 : this.t <= 0
    if (arrived) {
      // Bumped into the knot: let go and drop to the deck, or climb into the nest at that end.
      hand.pulse(0.9, 90)
      this.audio.play('thud', hand.worldPos(this.v2), 0.6)
      const land = this.dir > 0 ? this.landing.stop : this.landing.top
      this.forceRelease()
      land?.()
    }
  }

  private letGo(): void {
    if (!this.rider) return
    this.rider = null
    this.speed = 0
    this.player.riding = false
  }

  /** The rope's slide part in world space (the ship may be shaking). */
  private ends(): void {
    this.ship.shake.updateWorldMatrix(true, false)
    this.line.set(this.ship.shake.localToWorld(this.top.copy(this.route.top)), this.ship.shake.localToWorld(this.stop.copy(this.route.stop)))
  }
}

function signLines(to: string): { text: string; size: number; bold?: boolean; color?: string }[] {
  return [
    { text: 'Zipline', size: 40, bold: true, color: '#f2b64a' },
    { text: `to ${to}`, size: 26, color: '#ffe0a0' },
    { text: 'Grip the rope, face the way to go', size: 26 },
    { text: 'Both hands: slow down · Stick back: turn round', size: 22 },
    { text: 'Let go and you drop!', size: 22, color: '#b9c7cf' },
  ]
}

function ropeBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const length = a.distanceTo(b)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 6, 1).rotateX(Math.PI / 2), material)
  mesh.position.lerpVectors(a, b, 0.5)
  mesh.lookAt(b)
  return mesh
}
