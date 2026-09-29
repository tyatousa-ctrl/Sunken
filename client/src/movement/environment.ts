import type * as THREE from 'three'
import type { RockCollider } from '../world/SeabedScene'

/** An oriented box the diver can't swim through (hull, cabin walls). */
export interface BoxCollider {
  /** World → box-local transform. */
  inverse: THREE.Matrix4
  /** Box-local → world transform. */
  matrix: THREE.Matrix4
  half: THREE.Vector3
}

export interface RefillZone {
  center: THREE.Vector3
  /** Horizontal radius (m); a full 3D radius when `sphere` (an air-bubble dome). */
  radius: number
  sphere?: boolean
}

/** Underwater: free 3D swimming between a floor and the surface. */
export interface SwimEnvironment {
  kind: 'swim'
  floorHeight(x: number, z: number): number
  surfaceY: number
  rocks: RockCollider[]
  boxes: BoxCollider[]
  /** Horizontal distance from the origin the diver may roam. */
  radius: number
  refillZones: RefillZone[]
}

/** On foot: gravity, a walkable surface, and water to fall into. */
export interface WalkEnvironment {
  kind: 'walk'
  /**
   * Height of the walkable surface under a world point, or null where there's none (over the side).
   * `below`: only surfaces at or under this height count (so you're on the deck under the crow's
   * nest, and on the nest floor when you're up in it). Omitted: the lowest walkable surface.
   */
  groundHeight(x: number, z: number, below?: number): number | null
  /** Keep a head position inside walkable space by moving it horizontally (rails, walls). */
  constrain(head: THREE.Vector3): void
  waterY: number
  /** Something to climb (a rigging net): is this world point within `reach` of it? */
  climbable?(point: THREE.Vector3, reach: number): boolean
  /** While climbing: how far to move the head (world) to stay close to the climbable surface. */
  climbHold?(head: THREE.Vector3, target: THREE.Vector3): THREE.Vector3
  /** Straight up the climbable surface (world, unit), for keyboard climbing. */
  climbUp?(target: THREE.Vector3): THREE.Vector3
}

export type PlayerEnvironment = SwimEnvironment | WalkEnvironment
