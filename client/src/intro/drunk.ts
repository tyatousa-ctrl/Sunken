// Beer on deck: a hidden drink counter per player, effects that grow with it, and a blackout at 10.
// Pure state and numbers; the stage turns them into fog, tint, input wobble and so on.

export const BLACKOUT_DRINKS = 10
export const BLACKOUT_SECONDS = 3
/** Effects wear off by about one drink every 90 s. */
export const SOBER_SECONDS_PER_DRINK = 90

export interface DrunkEffects {
  /** Multiplies the fog distance (1 = clear, smaller = foggier). */
  fogScale: number
  /** Warm haze over the view, 0–1. */
  tint: number
  /** Random drift added to thumbstick walking (stick units). */
  walkDrift: number
  /** Walking speed multiplier. */
  walkSpeed: number
  /** Aim sway on a held gun (radians). */
  aimSway: number
  /** Extra random spread on dart throws (degrees). */
  dartScatter: number
}

type Curve = [drinks: number, value: number][]

// Noticeable from the first mug (haze and a swimmy glow), wobbly legs from the third, unsteady aim
// and slow feet after that. None of it ever moves the camera.
const FOG: Curve = [[0, 1], [0.5, 0.45], [1, 0.25], [3, 0.1], [5, 0.05], [7, 0.03], [9, 0.02]]
const TINT: Curve = [[0, 0], [0.5, 0.22], [1, 0.34], [3, 0.46], [5, 0.56], [7, 0.64], [9, 0.72]]
const DRIFT: Curve = [[0, 0], [2, 0], [3, 0.18], [5, 0.3], [7, 0.45], [9, 0.6]]
const SPEED: Curve = [[0, 1], [5.99, 1], [7, 0.75], [9, 0.65]]
const SWAY: Curve = [[0, 0], [2.99, 0], [3, 0.015], [5, 0.03], [7, 0.045], [9, 0.06]]

function sample(curve: Curve, x: number): number {
  if (x <= curve[0][0]) return curve[0][1]
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i]
    if (x <= x1) {
      const [x0, y0] = curve[i - 1]
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return curve[curve.length - 1][1]
}

export type DrunkEvent = 'blackout' | 'wake' | null

export class DrunkState {
  /** Drinks in the system (fractional: half a mug is half a drink). */
  drinks = 0
  /** Seconds of blackout left; 0 when awake. */
  blackout = 0

  get passedOut(): boolean {
    return this.blackout > 0
  }

  /** 0 sober, 1 = 1–3 drinks, 2 = 4–6, 3 = 7–9. */
  get tier(): 0 | 1 | 2 | 3 {
    const d = Math.floor(this.drinks)
    return d < 1 ? 0 : d < 4 ? 1 : d < 7 ? 2 : 3
  }

  drink(amount: number): DrunkEvent {
    if (this.passedOut) return null
    this.drinks += amount
    if (this.drinks >= BLACKOUT_DRINKS) {
      this.blackout = BLACKOUT_SECONDS
      return 'blackout'
    }
    return null
  }

  update(dt: number): DrunkEvent {
    if (this.passedOut) {
      this.blackout = Math.max(0, this.blackout - dt)
      if (this.blackout === 0) {
        // Wakes up stone-cold sober.
        this.drinks = 0
        return 'wake'
      }
      return null
    }
    this.drinks = Math.max(0, this.drinks - dt / SOBER_SECONDS_PER_DRINK)
    return null
  }

  /** Hitting the sea sobers you up instantly. */
  sober(): void {
    this.drinks = 0
    this.blackout = 0
  }

  effects(): DrunkEffects {
    const d = this.drinks
    return {
      fogScale: sample(FOG, d),
      tint: sample(TINT, d),
      walkDrift: sample(DRIFT, d),
      walkSpeed: sample(SPEED, d),
      aimSway: sample(SWAY, d),
      dartScatter: d * 0.7,
    }
  }
}
