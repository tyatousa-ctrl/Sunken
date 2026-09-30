// Liar's Dice rules, kept free of Three.js so they can be tested: bids, who's right when someone
// calls "Liar!", how the sailors play, and packing a table's dice into a few numbers for the crew.

export const SEATS = 4
export const START_DICE = 5

export interface Bid {
  /** How many dice... */
  q: number
  /** ...showing this face (1-6). */
  f: number
}

/** A bid beats the last one: more dice, or as many dice of a higher face. */
export function isRaise(prev: Bid | null, next: Bid): boolean {
  if (next.q < 1 || next.f < 1 || next.f > 6 || !Number.isInteger(next.q) || !Number.isInteger(next.f)) return false
  if (!prev) return true
  return next.q > prev.q || (next.q === prev.q && next.f > prev.f)
}

/** The smallest bid on this face that beats the last one. */
export function minRaise(prev: Bid | null, f: number): Bid {
  if (!prev) return { q: 1, f }
  return { q: f > prev.f ? prev.q : prev.q + 1, f }
}

/** How many dice on the whole table show this face. */
export function countFace(hands: number[][], f: number): number {
  let n = 0
  for (const hand of hands) for (const d of hand) if (d === f) n++
  return n
}

/** Someone called "Liar!" on a bid: was the bid good (the caller loses a die) or not (the bidder does)? */
export function bidStands(hands: number[][], bid: Bid): boolean {
  return countFace(hands, bid.f) >= bid.q
}

/** A sailor's move: a bid, or null to call "Liar!". `random` in [0, 1). */
export function sailorMove(mine: number[], totalDice: number, prev: Bid | null, random: () => number): Bid | null {
  const others = totalDice - mine.length
  const expected = (f: number) => countFace([mine], f) + others / 6
  // A bold sailor bluffs a little over the odds; a timid one sticks close to them.
  const nerve = 0.3 + random() * 0.9
  if (prev && prev.q > expected(prev.f) + nerve) return null
  // The cheapest raise on the face we hold most of (ties: the higher face), then the others.
  const faces = [1, 2, 3, 4, 5, 6].sort((a, b) => expected(b) - expected(a) || b - a)
  for (const f of faces) {
    const bid = minRaise(prev, f)
    if (!prev) bid.q = Math.max(1, Math.floor(expected(f) - 0.5 + random()))
    if (bid.q <= expected(f) + nerve - 0.3) return bid
  }
  // Nothing sensible left to bid: call it (or, now and then, bluff one more).
  if (!prev || random() < 0.2) return minRaise(prev, faces[0])
  return null
}

/** The dice seat to play next after `seat` (clockwise, skipping anyone with none left). */
export function nextSeat(counts: number[], seat: number): number {
  for (let i = 1; i <= SEATS; i++) {
    const s = (seat + i) % SEATS
    if (counts[s] > 0) return s
  }
  return seat
}

/** One number for a hand of up to 5 dice (each 1-6), and back. */
export function packDice(dice: number[]): number {
  let n = 0
  for (let i = dice.length - 1; i >= 0; i--) n = n * 7 + dice[i]
  return n
}

export function unpackDice(n: number): number[] {
  const out: number[] = []
  while (n > 0 && out.length < START_DICE) {
    const d = n % 7
    if (d === 0) break
    out.push(d)
    n = Math.floor(n / 7)
  }
  return out
}

export function rollDice(count: number, random: () => number): number[] {
  return Array.from({ length: count }, () => 1 + Math.floor(random() * 6))
}
