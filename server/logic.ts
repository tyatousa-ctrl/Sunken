// Pure room rules for the crew server (tested without networking).

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I or O: easy to read out and type

/** A 4-letter room code. */
export function generateCode(random: () => number = Math.random): string {
  let code = ''
  for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)]
  return code
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)
}

/** Lowest free slot 0–3, or -1 if the crew is full. */
export function lowestFreeSlot(taken: number[], max = 4): number {
  for (let slot = 0; slot < max; slot++) if (!taken.includes(slot)) return slot
  return -1
}

/** Shared objects (guns, the key...): the first grab wins until the holder lets go. */
export class ClaimTable {
  private readonly owners = new Map<string, string>()

  owner(id: string): string | undefined {
    return this.owners.get(id)
  }

  claim(id: string, sessionId: string): boolean {
    const current = this.owners.get(id)
    if (current && current !== sessionId) return false
    this.owners.set(id, sessionId)
    return true
  }

  release(id: string, sessionId: string): boolean {
    if (this.owners.get(id) !== sessionId) return false
    this.owners.delete(id)
    return true
  }

  /** Let go of everything a player holds (they left for good). Returns the ids. */
  releaseAll(sessionId: string): string[] {
    const ids = [...this.owners].filter(([, owner]) => owner === sessionId).map(([id]) => id)
    for (const id of ids) this.owners.delete(id)
    return ids
  }
}

/** Things that only happen once for the whole crew (a coin collected, a clay broken, the first shot). */
export class FirstWins {
  private readonly seen = new Set<string>()

  tryTake(id: string): boolean {
    if (this.seen.has(id)) return false
    this.seen.add(id)
    return true
  }

  has(id: string): boolean {
    return this.seen.has(id)
  }

  get all(): string[] {
    return [...this.seen]
  }
}

/** Keep a display name short and printable. */
export function cleanName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') return fallback
  const cleaned = name.replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 16)
  return cleaned || fallback
}
