import * as THREE from 'three'
import type { Hand } from '../input/Hand'
import type { Interactable } from './GrabSystem'
import type { RockCollider } from '../world/SeabedScene'

const HIGHLIGHT = new THREE.Color(0x2e7896)
const BLACK = new THREE.Color(0x000000)

export interface LooseItemOptions {
  /** Rough bounding radius (m). */
  radius: number
  /**
   * After release: `water` drifts, slows and settles on `floor`; `home` glides back to where
   * the item started (gear on a rack, props on a moving ship).
   */
  settle: 'water' | 'home'
  floor?: (x: number, z: number) => number
  rocks?: RockCollider[]
  /** Return true to consume the grab (the item is not held, e.g. an air tank refill). */
  onGrab?: (hand: Hand, item: LooseItem) => boolean
  whileHeld?: (hand: Hand, item: LooseItem) => void
  /** Return true if the release was handled (e.g. the item got equipped). */
  onRelease?: (hand: Hand, item: LooseItem) => boolean
}

// A prop you can pick up, carry and throw.
export class LooseItem implements Interactable {
  readonly velocity = new THREE.Vector3()
  heldBy: Hand | null = null
  /** Hidden items can't be grabbed (consumed, equipped, respawning). */
  enabled = true
  private resting = true
  private readonly materials: THREE.MeshStandardMaterial[] = []
  private readonly homeParent: THREE.Object3D
  private readonly homePos = new THREE.Vector3()
  private readonly homeQuat = new THREE.Quaternion()
  private returning = 0
  private readonly tmp = new THREE.Vector3()
  private readonly world = new THREE.Vector3()

  constructor(
    readonly object: THREE.Object3D,
    readonly options: LooseItemOptions,
  ) {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) this.materials.push(child.material)
    })
    this.homeParent = object.parent!
    this.homePos.copy(object.position)
    this.homeQuat.copy(object.quaternion)
  }

  grabGap(point: THREE.Vector3): number {
    if (!this.enabled || !this.object.visible || this.heldBy) return Infinity
    return point.distanceTo(this.object.getWorldPosition(this.world)) - this.options.radius
  }

  grab(hand: Hand): void {
    hand.pulse(0.35, 30)
    if (this.options.onGrab?.(hand, this)) {
      hand.held = null
      return
    }
    this.heldBy = hand
    this.resting = false
    this.returning = 0
    hand.grip.attach(this.object)
  }

  release(hand: Hand, throwVelocity: THREE.Vector3): void {
    if (this.heldBy !== hand) return
    this.heldBy = null
    if (this.options.onRelease?.(hand, this)) return
    if (this.options.settle === 'home') {
      this.homeParent.attach(this.object)
      this.returning = 0.35
      return
    }
    this.homeParent.attach(this.object)
    this.velocity.copy(throwVelocity)
  }

  /** Put the item straight back where it started (after equipping, a failed throw, a respawn). */
  goHome(): void {
    if (this.heldBy) this.heldBy.held = null
    this.heldBy = null
    this.homeParent.add(this.object)
    this.object.position.copy(this.homePos)
    this.object.quaternion.copy(this.homeQuat)
    this.velocity.set(0, 0, 0)
    this.resting = true
    this.returning = 0
  }

  setHighlight(on: boolean): void {
    for (const m of this.materials) m.emissive.copy(on ? HIGHLIGHT : BLACK)
  }

  update(dt: number): void {
    if (this.heldBy) {
      this.options.whileHeld?.(this.heldBy, this)
      return
    }
    if (this.returning > 0) {
      this.returning = Math.max(0, this.returning - dt)
      const k = 1 - Math.exp(-14 * dt)
      this.object.position.lerp(this.homePos, k)
      this.object.quaternion.slerp(this.homeQuat, k)
      if (this.returning === 0) this.goHome()
      return
    }
    if (this.options.settle !== 'water' || this.resting || !this.object.visible) return
    // Slightly heavier than water: drifts, slows, and settles on the floor.
    this.velocity.multiplyScalar(Math.exp(-1.5 * dt))
    this.velocity.y -= 0.5 * dt
    const pos = this.object.position
    pos.addScaledVector(this.velocity, dt)
    const r = this.options.radius
    for (const rock of this.options.rocks ?? []) {
      this.tmp.subVectors(pos, rock.center)
      const minDist = rock.radius + r * 0.6
      if (this.tmp.lengthSq() < minDist * minDist) pos.copy(rock.center).addScaledVector(this.tmp.normalize(), minDist)
    }
    const floor = (this.options.floor?.(pos.x, pos.z) ?? -Infinity) + r * 0.5
    if (pos.y <= floor) {
      pos.y = floor
      this.velocity.set(0, 0, 0)
      this.resting = true
    }
  }
}
