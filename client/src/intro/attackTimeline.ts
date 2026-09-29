// The scripted 90-second attack after someone shoots the ship in the bay. Pure data and maths so
// it's testable and (later) identical for every player: the server will broadcast the start time.

export const ATTACK_SECONDS = 90
/** Music cuts; then a beat of silence before the enemy reacts. */
export const SILENCE_SECONDS = 1
export const FLAG_SWAP_AT = 1
export const TURN_START = 1.2
export const TURN_SECONDS = 5
/** Rails open for everyone this long before the end even if gear isn't finished. */
export const RAILS_FORCE_OPEN_AT = 75
export const MAX_TILT_DEG = 8
export const MAX_PITCH_DEG = 3
export const MAX_SINK_METRES = 2.8

export type ShotTarget = 'scoreboard' | 'deck' | 'foremast' | 'miss'

export interface CannonShot {
  /** Seconds after the attack starts that the enemy fires. */
  fireAt: number
  target: ShotTarget
  /** Ship-local aim point on our deck (x, z); unused for the scoreboard and foremast. */
  x: number
  z: number
}

export const FLIGHT_SECONDS = 1.8

/** Deterministic volley list (seeded), so every client sees the same attack. */
export function planVolleys(seed = 1234): CannonShot[] {
  let s = seed
  const random = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
  const shots: CannonShot[] = [
    // First cannonball smashes the scoreboard.
    { fireAt: 3.5, target: 'scoreboard', x: 0, z: 0.4 },
    { fireAt: 9, target: 'deck', x: 2.2, z: -9 },
    { fireAt: 14, target: 'miss', x: 7, z: -2 },
    { fireAt: 22, target: 'foremast', x: 0, z: -8 },
  ]
  let t = 27
  while (t < ATTACK_SECONDS - 6) {
    const miss = random() < 0.3
    shots.push({
      fireAt: t,
      target: miss ? 'miss' : 'deck',
      x: miss ? 6 + random() * 6 : (random() - 0.5) * 5,
      z: -11 + random() * 19,
    })
    t += 3 + random() * 3
  }
  return shots
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** 0 → 1 over the attack; slow at first, then faster as she fills with water. */
export function sinkProgress(t: number): number {
  return Math.pow(clamp01(t / ATTACK_SECONDS), 1.7)
}

/** How far the enemy has swung broadside, 0 → 1. */
export function turnProgress(t: number): number {
  const u = clamp01((t - TURN_START) / TURN_SECONDS)
  return u * u * (3 - 2 * u)
}

export function railsOpen(t: number, gearComplete: boolean): boolean {
  return gearComplete || t >= RAILS_FORCE_OPEN_AT
}

export function secondsLeft(t: number): number {
  return Math.max(0, Math.ceil(ATTACK_SECONDS - t))
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
