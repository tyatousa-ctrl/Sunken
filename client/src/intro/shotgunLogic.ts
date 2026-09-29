export const SHELLS = 2

export type PullResult = 'fired' | 'empty' | 'open'

// Break-action blunderbuss: two shots, then flick the wrist down to break it open and back up to
// close it loaded. A/X is a one-button reload fallback.
export class ShotgunAction {
  shells = SHELLS
  open = false

  pull(): PullResult {
    if (this.open) return 'open'
    if (this.shells <= 0) return 'empty'
    this.shells--
    return 'fired'
  }

  /** Returns true if the gun broke open. Only a fired gun opens, so aiming swings can't. */
  flickDown(): boolean {
    if (this.open || this.shells >= SHELLS) return false
    this.open = true
    return true
  }

  /** Returns true if the gun closed (and is now loaded). */
  flickUp(): boolean {
    if (!this.open) return false
    this.open = false
    this.shells = SHELLS
    return true
  }

  quickReload(): boolean {
    if (this.shells >= SHELLS && !this.open) return false
    this.open = false
    this.shells = SHELLS
    return true
  }
}

export type Flick = 'down' | 'up'

// Spots a fast wrist flick from the gun's pitch rate (rad/s). A short cooldown stops the
// bounce-back of one flick counting as the opposite flick.
export class FlickDetector {
  private cooldown = 0

  constructor(
    private readonly threshold = 6,
    private readonly cooldownTime = 0.2,
  ) {}

  feed(pitchRate: number, dt: number): Flick | null {
    this.cooldown = Math.max(0, this.cooldown - dt)
    if (this.cooldown > 0) return null
    if (pitchRate < -this.threshold) {
      this.cooldown = this.cooldownTime
      return 'down'
    }
    if (pitchRate > this.threshold) {
      this.cooldown = this.cooldownTime
      return 'up'
    }
    return null
  }
}
