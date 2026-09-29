import * as THREE from 'three'
import type { Hand } from '../input/Hand'
import type { RockCollider } from '../world/SeabedScene'

/** Reach beyond an object's surface that still counts as a grab (brief: ~10 cm). */
export const GRAB_REACH = 0.1
const LEDGE_REACH = 0.15
/** The desktop stand-in hand can't be placed precisely, so it reaches further. */
const VIRTUAL_REACH = 0.6

/** Anything a hand can pick up: loose props, guns, gear. */
export interface Interactable {
  /** Gap (m) between the hand point and the object's grab surface for this hand; Infinity if it can't be grabbed now. */
  grabGap(point: THREE.Vector3, hand: Hand): number
  grab(hand: Hand): void
  /** `throwVelocity` is the hand's world velocity at release. */
  release(hand: Hand, throwVelocity: THREE.Vector3): void
  setHighlight(on: boolean): void
  update?(dt: number): void
}

export interface Handholds {
  rocks: RockCollider[]
  floor?: (x: number, z: number) => number
}

// Grip to grab: the nearest interactable in reach, or else a rock / the seabed as a handhold
// the diver can pull along (Player applies the pull).
export class GrabSystem {
  readonly items: Interactable[] = []
  private readonly handPos = new THREE.Vector3()
  private readonly throwVel = new THREE.Vector3()
  private readonly lit = new Set<Interactable>()

  constructor(private readonly handholds: Handholds | null = null) {}

  add<T extends Interactable>(item: T): T {
    this.items.push(item)
    return item
  }

  update(dt: number, hands: Hand[], bodyVelocity: THREE.Vector3, rig: THREE.Object3D): void {
    for (const hand of hands) {
      if (!hand.connected) continue
      if (hand.squeezePressed) this.tryGrab(hand)
      if (hand.squeezeReleased) this.release(hand, bodyVelocity, rig)
    }
    for (const item of this.items) item.update?.(dt)
    this.updateHighlights(hands)
  }

  /** Let go of whatever this hand holds (e.g. gear that just got equipped). */
  drop(hand: Hand): void {
    hand.held = null
    hand.anchor = null
  }

  private tryGrab(hand: Hand): void {
    hand.worldPos(this.handPos)
    const item = this.nearest(hand)
    if (item) {
      hand.held = item
      item.grab(hand)
      return
    }
    if (!this.handholds) return
    const onRock = this.handholds.rocks.some((r) => this.handPos.distanceTo(r.center) - r.radius < LEDGE_REACH)
    const floor = this.handholds.floor
    const onFloor = floor ? this.handPos.y - floor(this.handPos.x, this.handPos.z) < LEDGE_REACH : false
    if (onRock || onFloor) {
      hand.anchor = this.handPos.clone()
      hand.pulse(0.25, 25)
    }
  }

  private release(hand: Hand, bodyVelocity: THREE.Vector3, rig: THREE.Object3D): void {
    hand.anchor = null
    const item = hand.held
    if (!item) return
    hand.held = null
    const v = hand.virtual ? this.throwVel.copy(hand.localVel) : this.throwVel.copy(hand.localVel).applyQuaternion(rig.quaternion)
    item.release(hand, v.add(bodyVelocity))
  }

  private nearest(hand: Hand): Interactable | null {
    let best: Interactable | null = null
    let bestGap = hand.virtual ? VIRTUAL_REACH : GRAB_REACH
    for (const item of this.items) {
      const gap = item.grabGap(this.handPos, hand)
      if (gap < bestGap) {
        bestGap = gap
        best = item
      }
    }
    return best
  }

  private updateHighlights(hands: Hand[]): void {
    const now = new Set<Interactable>()
    for (const hand of hands) {
      if (!hand.connected || hand.held) continue
      hand.worldPos(this.handPos)
      const item = this.nearest(hand)
      if (item) now.add(item)
    }
    for (const item of this.lit) if (!now.has(item)) item.setHighlight(false)
    for (const item of now) if (!this.lit.has(item)) item.setHighlight(true)
    this.lit.clear()
    for (const item of now) this.lit.add(item)
  }
}
