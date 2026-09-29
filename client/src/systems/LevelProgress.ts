// Riddle progress for one level: ordered solution steps, three hint tiers that unlock while the
// team is stuck, and a compass hint after two minutes without progress. Level content comes from
// src/data/levels/*.json so riddles can change without code.

export interface LevelStep {
  id: string
  /** Short description shown in the objective line. */
  objective: string
}

export interface LevelData {
  id: string
  name: string
  riddle: string
  steps: LevelStep[]
  hints: [string, string, string]
  reward: { mapPiece: number; nextRiddle: string; message: string }
  collectibles: { coins: number; gems: number }
}

export interface ProgressTiming {
  /** Seconds stuck (no progress, no new hint) before the next hint tier unlocks. */
  hintEvery: number
  /** Seconds without progress before the map's compass points at the objective. */
  compassAfter: number
}

export const NORMAL_TIMING: ProgressTiming = { hintEvery: 60, compassAfter: 120 }

export type ProgressEvent = { type: 'step'; step: LevelStep } | { type: 'solved' } | { type: 'hint'; tier: number; text: string }

export class LevelProgress {
  readonly done = new Set<string>()
  hintsUnlocked = 0
  solved = false
  private sinceHint = 0
  private sinceProgress = 0

  constructor(
    readonly data: LevelData,
    private readonly timing: ProgressTiming = NORMAL_TIMING,
  ) {}

  get nextStep(): LevelStep | null {
    return this.data.steps.find((s) => !this.done.has(s.id)) ?? null
  }

  get compassVisible(): boolean {
    return !this.solved && this.sinceProgress >= this.timing.compassAfter
  }

  get unlockedHints(): string[] {
    return this.data.hints.slice(0, this.hintsUnlocked)
  }

  /** Mark a step done. Steps only count in order (you can't open the chest before finding the key). */
  complete(stepId: string): ProgressEvent[] {
    const next = this.nextStep
    if (this.solved || !next || next.id !== stepId) return []
    this.done.add(stepId)
    this.sinceProgress = 0
    this.sinceHint = 0
    const events: ProgressEvent[] = [{ type: 'step', step: next }]
    if (!this.nextStep) {
      this.solved = true
      events.push({ type: 'solved' })
    }
    return events
  }

  update(dt: number): ProgressEvent | null {
    if (this.solved) return null
    this.sinceProgress += dt
    this.sinceHint += dt
    if (this.hintsUnlocked < this.data.hints.length && this.sinceHint >= this.timing.hintEvery) {
      this.sinceHint = 0
      const tier = this.hintsUnlocked++
      return { type: 'hint', tier: tier + 1, text: this.data.hints[tier] }
    }
    return null
  }
}
