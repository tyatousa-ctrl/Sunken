import type * as THREE from 'three'
import type { PlayerEnvironment } from '../movement/environment'
import type { CharacterClass } from '../systems/crew'
import type { Bubbles } from '../world/Bubbles'

/** A job the puzzle needs from one class (e.g. the Strongman heaving the figurehead). */
export interface BotTask {
  /** Where to be to do it. */
  position: THREE.Vector3
  skill: CharacterClass
  /** A human is there to see it (bots never solve a riddle alone). */
  ready: boolean
  /** Do it. */
  act: (botName: string) => void
}

export interface BotCollectible {
  id: string
  position: THREE.Vector3
  take: (botId: string) => void
}

/** What a stage tells its bots about the world. */
export interface BotWorld {
  env: PlayerEnvironment
  /** Where a bot appears when the stage starts. */
  spawn(slot: number): THREE.Vector3
  task(): BotTask | null
  collectibles(): BotCollectible[]
  /** Waypoints from one point to another that don't go through walls (e.g. via the cabin door). */
  route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[]
  /** Where to refill air, if anywhere. */
  refill: THREE.Vector3 | null
  bubbles: Bubbles | null
  /** On deck: when it's time to go over the side, a point beyond the rail to walk to. */
  abandonShip?: (from: THREE.Vector3) => THREE.Vector3 | null
}
