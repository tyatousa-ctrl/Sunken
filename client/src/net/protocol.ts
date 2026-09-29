// Messages and constants shared by the game client and the crew server.

export const ROOM_NAME = 'crew'
export const MAX_PLAYERS = 4
/** Seconds a dropped player's slot is held for them. */
export const RECONNECT_SECONDS = 120
/** Pose updates per second each way. */
export const POSE_RATE = 20
export const SLOT_COLORS = ['#e8b930', '#3fa7ff', '#ff6b6b', '#7dde6b']
export const SLOT_NAMES = ['Gold', 'Blue', 'Red', 'Green']

/**
 * A diver's pose, flattened: head position + quaternion, then left and right hand the same way
 * (21 numbers, metres and unit quaternions, world space).
 */
export type PoseArray = number[]

export interface PoseMessage {
  /** Which stage the player is in ("intro", "level1", "sandbox"). */
  stage: string
  pose: PoseArray
  /** Speaking underwater (voice gets muffled). */
  water: boolean
}

export interface PosesBroadcast {
  /** Server clock (ms). */
  t: number
  players: Record<string, PoseMessage>
}

export interface ClayLaunch {
  id: number
  /** Deterministic launch parameters for every client. */
  seed: number
}

export interface ObjectPose {
  id: string
  /** Position + quaternion, world space. */
  pose: number[]
}

export interface RtcSignal {
  to?: string
  from?: string
  data: unknown
}
