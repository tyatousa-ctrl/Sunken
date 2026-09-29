import * as THREE from 'three'
import type { Hand } from '../input/Hand'
import type { RockCollider } from '../world/SeabedScene'

/** Reach beyond an object's surface that still counts as a grab (brief: ~10 cm). */
export const GRAB_REACH = 0.1
const LEDGE_REACH = 0.15
/** The desktop stand-in hand can't be placed precisely, so it reaches further. */
const VIRTUAL_REACH = 0.6
/** Point at something up to 5 ft away and grip: it flies to your hand. */
export const PULL_REACH = 1.52
/** Aim tolerance: a cone around the pointer, a bit wider than the object itself. */
const PULL_SLACK = 0.06
const PULL_CONE = 0.09
/** Flight time: quick, but long enough to see it come. */
const PULL_BASE_SECONDS = 0.12
const PULL_SECONDS_PER_METRE = 0.14
const POINTER_IDLE = 0x9fe8ff
const POINTER_TARGET = 0xffd27a

/** Anything a hand can pick up: loose props, guns, gear. */
export interface Interactable {
  /** Gap (m) between the hand point and the object's grab surface for this hand; Infinity if it can't be grabbed now. */
  grabGap(point: THREE.Vector3, hand: Hand): number
  grab(hand: Hand): void
  /** `throwVelocity` is the hand's world velocity at release. */
  release(hand: Hand, throwVelocity: THREE.Vector3): void
  setHighlight(on: boolean): void
  update?(dt: number): void
  /** The thing that moves; with it, the item can be pulled from a distance. */
  readonly object?: THREE.Object3D
  /** Set false for things that must not fly to the hand. */
  readonly pullable?: boolean
}

/** An item flying from where it was to the hand that pulled it. */
interface Pull {
  item: Interactable
  object: THREE.Object3D
  /** Where it was (parent-local), to put it back if the grip lets go mid-flight. */
  homeLocal: THREE.Vector3
  from: THREE.Vector3
  t: number
  duration: number
}

export interface Handholds {
  rocks: RockCollider[]
  floor?: (x: number, z: number) => number
}

// Grip to grab: the nearest interactable in reach; else whatever the pointer is on, up to 5 ft away,
// which flies to the hand; else a rock / the seabed as a handhold the diver can pull along (Player
// applies the pull). Things the pointer can pull light up, and the pointer stretches to them.
export class GrabSystem {
  readonly items: Interactable[] = []
  private readonly handPos = new THREE.Vector3()
  private readonly throwVel = new THREE.Vector3()
  private readonly lit = new Set<Interactable>()
  private readonly pulls = new Map<Hand, Pull>()
  private hands: Hand[] = []
  /** What each hand's pointer is on right now. */
  private readonly aimed = new Map<Hand, Interactable>()
  private readonly v = new THREE.Vector3()
  private readonly origin = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()

  constructor(private readonly handholds: Handholds | null = null) {}

  add<T extends Interactable>(item: T): T {
    this.items.push(item)
    return item
  }

  update(dt: number, hands: Hand[], bodyVelocity: THREE.Vector3, rig: THREE.Object3D): void {
    this.hands = hands
    for (const hand of hands) {
      if (!hand.connected) continue
      if (hand.squeezePressed) this.tryGrab(hand)
      if (hand.squeezeReleased) {
        this.cancelPull(hand)
        this.release(hand, bodyVelocity, rig)
      }
    }
    for (const item of this.items) item.update?.(dt)
    this.updatePulls(dt)
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
    const far = this.aimed.get(hand) ?? this.aim(hand)
    if (far && far.object) {
      this.startPull(hand, far, far.object)
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

  /** The pullable thing this hand's pointer is on (within 5 ft), if any. */
  private aim(hand: Hand): Interactable | null {
    hand.ray.getWorldPosition(this.origin)
    hand.pointDir(this.dir)
    let best: Interactable | null = null
    let bestScore = 1
    for (const item of this.items) {
      const object = item.object
      if (!object || item.pullable === false || !object.visible || this.isBusy(item)) continue
      object.getWorldPosition(this.v)
      const along = this.v.sub(this.origin).dot(this.dir)
      if (along < 0 || along > PULL_REACH) continue
      const off = this.v.addScaledVector(this.dir, -along).length()
      const score = off / (PULL_SLACK + along * PULL_CONE)
      if (score >= bestScore) continue
      // Only things that could be grabbed right now (not held, not claimed, not hidden).
      if (!Number.isFinite(item.grabGap(object.getWorldPosition(this.v), hand))) continue
      bestScore = score
      best = item
    }
    return best
  }

  private isBusy(item: Interactable): boolean {
    for (const pull of this.pulls.values()) if (pull.item === item) return true
    // Already in one of your hands (the gun's barrel can be gripped, but it shouldn't fly).
    return this.hands.some((h) => h.held === item)
  }

  private startPull(hand: Hand, item: Interactable, object: THREE.Object3D): void {
    const from = object.getWorldPosition(new THREE.Vector3())
    const distance = from.distanceTo(hand.worldPos(this.v))
    this.pulls.set(hand, {
      item,
      object,
      homeLocal: object.position.clone(),
      from,
      t: 0,
      duration: PULL_BASE_SECONDS + distance * PULL_SECONDS_PER_METRE,
    })
    hand.pulse(0.3, 30)
  }

  /** Let go mid-flight: it goes back where it was. */
  private cancelPull(hand: Hand): void {
    const pull = this.pulls.get(hand)
    if (!pull) return
    this.pulls.delete(hand)
    pull.object.position.copy(pull.homeLocal)
  }

  private updatePulls(dt: number): void {
    for (const [hand, pull] of this.pulls) {
      // Someone else got it (or it vanished) on the way: give up.
      if (!hand.connected || !pull.object.visible || !Number.isFinite(pull.item.grabGap(pull.object.getWorldPosition(this.v), hand))) {
        this.cancelPull(hand)
        continue
      }
      pull.t = Math.min(1, pull.t + dt / pull.duration)
      const u = 1 - Math.pow(1 - pull.t, 3)
      const to = hand.worldPos(this.handPos)
      this.v.lerpVectors(pull.from, to, u)
      pull.object.parent?.worldToLocal(this.v)
      pull.object.position.copy(this.v)
      if (pull.t >= 1) {
        // It's in the hand now: grab it from here.
        this.pulls.delete(hand)
        hand.held = pull.item
        pull.item.grab(hand)
      }
    }
  }

  private updateHighlights(hands: Hand[]): void {
    const now = new Set<Interactable>()
    for (const hand of hands) {
      const before = this.aimed.get(hand)
      this.aimed.delete(hand)
      if (!hand.connected || hand.held || this.pulls.has(hand)) {
        this.setPointer(hand, null)
        continue
      }
      hand.worldPos(this.handPos)
      const item = this.nearest(hand)
      if (item) {
        now.add(item)
        this.setPointer(hand, null)
        continue
      }
      const far = this.aim(hand)
      this.setPointer(hand, far)
      if (far) {
        now.add(far)
        this.aimed.set(hand, far)
        // A light tick when the pointer lands on something new.
        if (far !== before) hand.pulse(0.1, 12)
      }
    }
    for (const item of this.lit) if (!now.has(item)) item.setHighlight(false)
    for (const item of now) if (!this.lit.has(item)) item.setHighlight(true)
    this.lit.clear()
    for (const item of now) this.lit.add(item)
  }

  /** Stretch the pointer to what it's on and tint it; back to short and blue otherwise. */
  private setPointer(hand: Hand, target: Interactable | null): void {
    const line = hand.pointer
    if (!line) return
    const material = line.material as THREE.LineBasicMaterial
    if (target?.object) {
      hand.ray.getWorldPosition(this.origin)
      line.scale.z = Math.max(0.1, target.object.getWorldPosition(this.v).distanceTo(this.origin))
      material.color.setHex(POINTER_TARGET)
      material.opacity = 0.9
    } else {
      line.scale.z = 0.6
      material.color.setHex(POINTER_IDLE)
      material.opacity = 0.5
    }
  }
}
