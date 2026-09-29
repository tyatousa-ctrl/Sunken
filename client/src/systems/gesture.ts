// The $1 Unistroke Recognizer (Wobbrock, Wilson & Li, 2007), trimmed to what the spells need:
// resample the stroke, rotate to its indicative angle, scale to a square, centre it, then compare
// with each template, searching ±45° of rotation for the best fit.

export type Point = { x: number; y: number }
export type SpellShape = 'circle' | 'triangle' | 'zigzag'

const N = 64
const SQUARE = 250
const HALF_DIAGONAL = 0.5 * Math.hypot(SQUARE, SQUARE)
const ANGLE_RANGE = Math.PI / 4
const ANGLE_STEP = Math.PI / 90
const PHI = 0.5 * (-1 + Math.sqrt(5))
/** Below this score (0–1) the stroke isn't any known spell. */
export const MIN_SCORE = 0.72

function pathLength(points: Point[]): number {
  let d = 0
  for (let i = 1; i < points.length; i++) d += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return d
}

function resample(input: Point[], n: number): Point[] {
  const points = input.map((p) => ({ ...p }))
  const interval = pathLength(points) / (n - 1)
  let acc = 0
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    if (acc + d >= interval && d > 0) {
      const t = (interval - acc) / d
      const q = { x: points[i - 1].x + t * (points[i].x - points[i - 1].x), y: points[i - 1].y + t * (points[i].y - points[i - 1].y) }
      out.push(q)
      points.splice(i, 0, q)
      acc = 0
    } else acc += d
  }
  while (out.length < n) out.push(points[points.length - 1])
  return out.slice(0, n)
}

function centroid(points: Point[]): Point {
  const c = { x: 0, y: 0 }
  for (const p of points) {
    c.x += p.x
    c.y += p.y
  }
  return { x: c.x / points.length, y: c.y / points.length }
}

function rotateBy(points: Point[], angle: number): Point[] {
  const c = centroid(points)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return points.map((p) => ({ x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x, y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y }))
}

function normalize(stroke: Point[]): Point[] {
  let points = resample(stroke, N)
  const c = centroid(points)
  points = rotateBy(points, -Math.atan2(c.y - points[0].y, c.x - points[0].x))
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const w = Math.max(maxX - minX, 1e-6)
  const h = Math.max(maxY - minY, 1e-6)
  points = points.map((p) => ({ x: (p.x * SQUARE) / w, y: (p.y * SQUARE) / h }))
  const c2 = centroid(points)
  return points.map((p) => ({ x: p.x - c2.x, y: p.y - c2.y }))
}

function pathDistance(a: Point[], b: Point[]): number {
  let d = 0
  for (let i = 0; i < a.length; i++) d += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y)
  return d / a.length
}

function distanceAtBestAngle(points: Point[], template: Point[]): number {
  let a = -ANGLE_RANGE
  let b = ANGLE_RANGE
  let x1 = PHI * a + (1 - PHI) * b
  let f1 = pathDistance(rotateBy(points, x1), template)
  let x2 = (1 - PHI) * a + PHI * b
  let f2 = pathDistance(rotateBy(points, x2), template)
  while (Math.abs(b - a) > ANGLE_STEP) {
    if (f1 < f2) {
      b = x2
      x2 = x1
      f2 = f1
      x1 = PHI * a + (1 - PHI) * b
      f1 = pathDistance(rotateBy(points, x1), template)
    } else {
      a = x1
      x1 = x2
      f1 = f2
      x2 = (1 - PHI) * a + PHI * b
      f2 = pathDistance(rotateBy(points, x2), template)
    }
  }
  return Math.min(f1, f2)
}

function circlePoints(): Point[] {
  return Array.from({ length: 40 }, (_, i) => {
    const a = (i / 39) * Math.PI * 2
    return { x: Math.cos(a), y: Math.sin(a) }
  })
}

function polyline(vertices: Point[]): Point[] {
  const out: Point[] = []
  for (let i = 0; i < vertices.length - 1; i++) {
    for (let k = 0; k < 10; k++) {
      const t = k / 10
      out.push({ x: vertices[i].x + (vertices[i + 1].x - vertices[i].x) * t, y: vertices[i].y + (vertices[i + 1].y - vertices[i].y) * t })
    }
  }
  out.push(vertices[vertices.length - 1])
  return out
}

/** Each shape is drawn a couple of ways (direction, start point), as $1 recommends. */
const RAW_TEMPLATES: [SpellShape, Point[]][] = [
  ['circle', circlePoints()],
  ['circle', circlePoints().reverse()],
  ['triangle', polyline([{ x: 0, y: 1 }, { x: 0.9, y: -0.6 }, { x: -0.9, y: -0.6 }, { x: 0, y: 1 }])],
  ['triangle', polyline([{ x: 0, y: 1 }, { x: -0.9, y: -0.6 }, { x: 0.9, y: -0.6 }, { x: 0, y: 1 }])],
  ['triangle', polyline([{ x: -0.9, y: -0.6 }, { x: 0, y: 1 }, { x: 0.9, y: -0.6 }, { x: -0.9, y: -0.6 }])],
  ['zigzag', polyline([{ x: -1, y: 0.5 }, { x: -0.5, y: -0.5 }, { x: 0, y: 0.5 }, { x: 0.5, y: -0.5 }, { x: 1, y: 0.5 }])],
  ['zigzag', polyline([{ x: 1, y: 0.5 }, { x: 0.5, y: -0.5 }, { x: 0, y: 0.5 }, { x: -0.5, y: -0.5 }, { x: -1, y: 0.5 }])],
  ['zigzag', polyline([{ x: -1, y: -0.5 }, { x: -0.5, y: 0.5 }, { x: 0, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: -0.5 }])],
]
const TEMPLATES = RAW_TEMPLATES.map(([name, points]) => ({ name, points: normalize(points) }))

export interface Recognition {
  shape: SpellShape | null
  /** 0–1, higher is closer. */
  score: number
}

export function recognize(stroke: Point[]): Recognition {
  if (stroke.length < 8 || pathLength(stroke) < 1e-3) return { shape: null, score: 0 }
  const points = normalize(stroke)
  let best: SpellShape | null = null
  let bestDistance = Infinity
  for (const t of TEMPLATES) {
    const d = distanceAtBestAngle(points, t.points)
    if (d < bestDistance) {
      bestDistance = d
      best = t.name
    }
  }
  const score = 1 - bestDistance / HALF_DIAGONAL
  return score >= MIN_SCORE ? { shape: best, score } : { shape: null, score }
}
