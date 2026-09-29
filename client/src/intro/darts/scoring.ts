// Standard dart board geometry (metres) and scoring for a point on the board face.

/** Segment numbers clockwise from the top. */
export const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]

export const RADII = {
  bull: 0.00635,
  outerBull: 0.0159,
  trebleIn: 0.099,
  trebleOut: 0.107,
  doubleIn: 0.162,
  doubleOut: 0.17,
  /** Edge of the board including the number ring. */
  board: 0.225,
}

export interface DartScore {
  points: number
  /** 0 miss, 1 single, 2 double, 3 treble. The bull (50) counts as a double. */
  multiplier: 0 | 1 | 2 | 3
  /** 1–20, 25 for either bull, 0 for a miss. */
  segment: number
  label: string
}

export const MISS: DartScore = { points: 0, multiplier: 0, segment: 0, label: 'Miss' }

/** Score for a dart at (x, y) on the board face: x right, y up, origin at the bull. */
export function scoreAt(x: number, y: number): DartScore {
  const r = Math.hypot(x, y)
  if (r <= RADII.bull) return { points: 50, multiplier: 2, segment: 25, label: 'BULL' }
  if (r <= RADII.outerBull) return { points: 25, multiplier: 1, segment: 25, label: '25' }
  if (r > RADII.doubleOut) return MISS
  // Angle clockwise from straight up; each segment spans 18°, centred on its number.
  const degrees = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  const segment = SEGMENTS[Math.floor(((degrees + 9) % 360) / 18)]
  if (r >= RADII.doubleIn) return { points: segment * 2, multiplier: 2, segment, label: `D${segment}` }
  if (r >= RADII.trebleIn && r <= RADII.trebleOut) return { points: segment * 3, multiplier: 3, segment, label: `T${segment}` }
  return { points: segment, multiplier: 1, segment, label: String(segment) }
}
