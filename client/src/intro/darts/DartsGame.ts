import type { DartScore } from './scoring'

export type DartsMode = '301' | '501' | 'clock'

export const MODE_NAMES: Record<DartsMode, string> = { '301': '301', '501': '501', clock: 'Around the Clock' }

export interface DartsPlayer {
  name: string
  color: string
  /** x01: points left. */
  remaining: number
  /** Around the Clock: next number to hit (1–20, then 25 for the bull). */
  target: number
  /** Labels of the darts thrown this turn (last three shown on the board). */
  lastDarts: string[]
}

export interface ThrowResult {
  bust: boolean
  won: boolean
  turnOver: boolean
}

// Turn-based pub darts: 301 (default) or 501 counting down, or Around the Clock.
// Double-out (finish on a double or the bull) is on by default and can be switched off.
export class DartsGame {
  readonly players: DartsPlayer[]
  current = 0
  dartsThisTurn = 0
  winner: DartsPlayer | null = null
  message = ''
  private turnStart = 0

  constructor(
    players: { name: string; color: string }[],
    public mode: DartsMode = '301',
    public doubleOut = true,
  ) {
    this.players = players.map((p) => ({ ...p, remaining: 0, target: 1, lastDarts: [] }))
    this.reset()
  }

  get player(): DartsPlayer {
    return this.players[this.current]
  }

  reset(mode = this.mode, doubleOut = this.doubleOut): void {
    this.mode = mode
    this.doubleOut = doubleOut
    const start = mode === '501' ? 501 : 301
    for (const p of this.players) {
      p.remaining = start
      p.target = 1
      p.lastDarts = []
    }
    this.current = 0
    this.dartsThisTurn = 0
    this.winner = null
    this.message = ''
    this.turnStart = this.player.remaining
  }

  throw(score: DartScore): ThrowResult {
    if (this.winner) return { bust: false, won: false, turnOver: true }
    const p = this.player
    if (this.dartsThisTurn === 0) p.lastDarts = []
    p.lastDarts.push(score.label)
    this.dartsThisTurn++
    this.message = ''

    if (this.mode === 'clock') {
      const hit = p.target === 25 ? score.segment === 25 : score.segment === p.target
      if (hit) p.target = p.target === 20 ? 25 : p.target === 25 ? 26 : p.target + 1
      if (p.target > 25) return this.win(p)
    } else {
      const left = p.remaining - score.points
      const finishedOnDouble = score.multiplier === 2
      const bust = left < 0 || (this.doubleOut && left === 1) || (left === 0 && this.doubleOut && !finishedOnDouble)
      if (bust) {
        p.remaining = this.turnStart
        this.message = `${p.name}: bust!`
        this.nextTurn()
        return { bust: true, won: false, turnOver: true }
      }
      p.remaining = left
      if (left === 0) return this.win(p)
    }

    if (this.dartsThisTurn >= 3) {
      this.nextTurn()
      return { bust: false, won: false, turnOver: true }
    }
    return { bust: false, won: false, turnOver: false }
  }

  /** The other side steps up to throw: their turn starts now (whatever was left of this one is gone). */
  startTurn(index: number): void {
    if (index < 0 || index >= this.players.length || index === this.current) return
    this.current = index
    this.dartsThisTurn = 0
    this.turnStart = this.player.remaining
  }

  /** A player who passes out loses the rest of their turn. */
  skipTurn(): void {
    this.message = `${this.player.name} is out cold. Turn skipped.`
    this.nextTurn()
  }

  private win(p: DartsPlayer): ThrowResult {
    this.winner = p
    this.message = `${p.name} wins!`
    this.dartsThisTurn = 0
    return { bust: false, won: true, turnOver: true }
  }

  private nextTurn(): void {
    this.dartsThisTurn = 0
    this.current = (this.current + 1) % this.players.length
    this.turnStart = this.player.remaining
  }
}
