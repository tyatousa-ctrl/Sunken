import * as THREE from 'three'
import type { Hand } from '../input/Hand'
import { sandHeight, type RockCollider } from '../world/SeabedScene'

/** Reach beyond an object's surface that still counts as a grab (brief: ~10 cm). */
export const GRAB_REACH = 0.1
const LEDGE_REACH = 0.15
const HIGHLIGHT = new THREE.Color(0x2e7896)
const TANK_RESPAWN_SECONDS = 30

export type GrabKind = 'item' | 'airTank'

export interface Grabbable {
  object: THREE.Object3D
  /** Rough bounding radius (m). */
  radius: number
  kind: GrabKind
  materials: THREE.MeshStandardMaterial[]
  velocity: THREE.Vector3
  heldBy: Hand | null
  resting: boolean
  respawnAt: number
}

// Grip to grab: loose items attach to the hand, rocks and the seabed become handholds
// the diver can pull along, and spare air tanks refill on touch.
export class GrabSystem {
  readonly items: Grabbable[] = []
  private readonly handPos = new THREE.Vector3()
  private readonly itemPos = new THREE.Vector3()
  private readonly tmp = new THREE.Vector3()
  private elapsed = 0

  constructor(
    private readonly scene: THREE.Scene,
    private readonly rocks: RockCollider[],
    private readonly onAirTank: () => void,
  ) {}

  add(object: THREE.Object3D, radius: number, kind: GrabKind = 'item'): void {
    const materials: THREE.MeshStandardMaterial[] = []
    object.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) materials.push(child.material)
    })
    this.scene.add(object)
    this.items.push({ object, radius, kind, materials, velocity: new THREE.Vector3(), heldBy: null, resting: false, respawnAt: 0 })
  }

  /** `bodyVelocity` is the diver's world velocity; `rig` orients hand velocities into world space. */
  update(dt: number, hands: Hand[], bodyVelocity: THREE.Vector3, rig: THREE.Object3D): void {
    this.elapsed += dt
    for (const hand of hands) {
      if (!hand.connected) continue
      if (hand.squeezePressed) this.tryGrab(hand)
      if (hand.squeezeReleased) this.release(hand, bodyVelocity, rig)
    }
    for (const item of this.items) this.simulate(item, dt)
    this.updateHighlights(hands)
  }

  private tryGrab(hand: Hand): void {
    hand.worldPos(this.handPos)
    const item = this.nearestItem(this.handPos)
    if (item) {
      if (item.kind === 'airTank') {
        this.onAirTank()
        item.object.visible = false
        item.respawnAt = this.elapsed + TANK_RESPAWN_SECONDS
        hand.pulse(0.8, 120)
        return
      }
      item.heldBy = hand
      item.resting = false
      hand.held = item
      hand.grip.attach(item.object)
      hand.pulse(0.35, 30)
      return
    }
    // No item in reach: hold on to a rock or the seabed instead.
    const onRock = this.rocks.some((r) => this.handPos.distanceTo(r.center) - r.radius < LEDGE_REACH)
    const onSand = this.handPos.y - sandHeight(this.handPos.x, this.handPos.z) < LEDGE_REACH
    if (onRock || onSand) {
      hand.anchor = this.handPos.clone()
      hand.pulse(0.25, 25)
    }
  }

  private release(hand: Hand, bodyVelocity: THREE.Vector3, rig: THREE.Object3D): void {
    hand.anchor = null
    const item = hand.held
    if (!item) return
    hand.held = null
    item.heldBy = null
    this.scene.attach(item.object)
    // Thrown items keep the hand's world velocity.
    item.velocity.copy(hand.localVel).applyQuaternion(rig.quaternion).add(bodyVelocity)
  }

  private nearestItem(point: THREE.Vector3): Grabbable | null {
    let best: Grabbable | null = null
    let bestGap = GRAB_REACH
    for (const item of this.items) {
      if (!item.object.visible || item.heldBy) continue
      const gap = point.distanceTo(item.object.getWorldPosition(this.itemPos)) - item.radius
      if (gap < bestGap) {
        bestGap = gap
        best = item
      }
    }
    return best
  }

  private simulate(item: Grabbable, dt: number): void {
    if (!item.object.visible) {
      if (item.respawnAt && this.elapsed >= item.respawnAt) {
        item.object.visible = true
        item.respawnAt = 0
      }
      return
    }
    if (item.heldBy || item.resting) return
    // Slightly heavier than water: drifts, slows, and settles on the sand.
    item.velocity.multiplyScalar(Math.exp(-1.5 * dt))
    item.velocity.y -= 0.5 * dt
    const pos = item.object.position
    pos.addScaledVector(item.velocity, dt)
    for (const rock of this.rocks) {
      this.tmp.subVectors(pos, rock.center)
      const minDist = rock.radius + item.radius * 0.6
      if (this.tmp.lengthSq() < minDist * minDist) pos.copy(rock.center).addScaledVector(this.tmp.normalize(), minDist)
    }
    const floor = sandHeight(pos.x, pos.z) + item.radius * 0.5
    if (pos.y <= floor) {
      pos.y = floor
      item.velocity.set(0, 0, 0)
      item.resting = true
    }
  }

  private updateHighlights(hands: Hand[]): void {
    const free = hands.filter((h) => h.connected && !h.held)
    for (const item of this.items) {
      let lit = false
      if (item.object.visible && !item.heldBy) {
        item.object.getWorldPosition(this.itemPos)
        lit = free.some((h) => h.worldPos(this.handPos).distanceTo(this.itemPos) - item.radius < GRAB_REACH)
      }
      for (const material of item.materials) material.emissive.copy(lit ? HIGHLIGHT : BLACK)
    }
  }
}

const BLACK = new THREE.Color(0x000000)
