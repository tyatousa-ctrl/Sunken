import type { CharacterClass } from '../systems/crew'

// A bot's decision each moment: a small priority list (the brief's behaviour tree).
// Pure, so it's easy to test: positions are reduced to distances and flags by the caller.

export type Command = { kind: 'follow'; until: number } | { kind: 'goTo'; until: number } | { kind: 'useSkill' }

export interface BrainInput {
  now: number
  character: CharacterClass
  /** 0–1. */
  air: number
  canRefill: boolean
  command: Command | null
  /** A job the puzzle needs, which class can do it, and whether a human is there to see it. */
  task: { skill: CharacterClass; ready: boolean } | null
  skillReady: boolean
  /** Distance to the nearest collectible (Infinity if none). */
  nearestCollectible: number
  /** Distance to the nearest human (Infinity if none in this stage). */
  nearestHuman: number
  /** A human teammate is nearly out of air (for the Deep Diver). */
  teammateLowOnAir: boolean
}

export type Goal = 'refill' | 'command' | 'shareAir' | 'task' | 'collect' | 'follow' | 'idle'

const LOW_AIR = 0.3
const COLLECT_RANGE = 6
const HUMAN_RANGE_FOR_COLLECTING = 12

export function chooseGoal(i: BrainInput): Goal {
  if (i.air < LOW_AIR && i.canRefill) return 'refill'
  if (i.command && (i.command.kind === 'useSkill' || i.command.until > i.now)) return 'command'
  if (i.character === 'deepDiver' && i.teammateLowOnAir && i.skillReady) return 'shareAir'
  // Bots help with the puzzle, but never solve it alone: only once a human has got there.
  if (i.task && i.task.skill === i.character && i.task.ready && i.skillReady) return 'task'
  if (i.nearestCollectible < COLLECT_RANGE && i.nearestHuman < HUMAN_RANGE_FOR_COLLECTING) return 'collect'
  if (Number.isFinite(i.nearestHuman)) return 'follow'
  return 'idle'
}

/** Where around a human each bot waits (spread out by slot, 2–4 m away). */
export function followOffset(slot: number): { angle: number; distance: number } {
  return { angle: Math.PI * 0.75 + slot * ((Math.PI * 2) / 4.5), distance: 2.4 + (slot % 2) * 0.9 }
}
