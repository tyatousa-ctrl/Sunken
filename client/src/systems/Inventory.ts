// A diver's backpack: 12 slots. Coins, gems, shells and runes stack in one slot; everything else
// takes a slot each.

export type ItemKind = 'coin' | 'gem' | 'key' | 'mapPiece' | 'rune' | 'lantern' | 'airCanister' | 'shell' | 'pearl'

export const SLOTS = 12

const STACK_LIMIT: Partial<Record<ItemKind, number>> = { coin: 99, gem: 9, shell: 9, rune: 9 }

/** Points each collectible adds to the team score. */
export const SCORE: Partial<Record<ItemKind, number>> = { coin: 10, gem: 50, pearl: 25 }

export interface Slot {
  kind: ItemKind
  count: number
}

export class Inventory {
  readonly slots: (Slot | null)[] = Array.from({ length: SLOTS }, () => null)

  /** Put one item in. Returns the slot used, or -1 if the backpack is full. */
  add(kind: ItemKind): number {
    const limit = STACK_LIMIT[kind] ?? 1
    if (limit > 1) {
      const stack = this.slots.findIndex((s) => s?.kind === kind && s.count < limit)
      if (stack >= 0) {
        this.slots[stack]!.count++
        return stack
      }
    }
    const empty = this.slots.indexOf(null)
    if (empty < 0) return -1
    this.slots[empty] = { kind, count: 1 }
    return empty
  }

  /** Take one item out of a slot. */
  take(index: number): ItemKind | null {
    const slot = this.slots[index]
    if (!slot) return null
    slot.count--
    if (slot.count <= 0) this.slots[index] = null
    return slot.kind
  }

  /** Remove one item of a kind (e.g. a key used on a lock). */
  use(kind: ItemKind): boolean {
    const index = this.slots.findIndex((s) => s?.kind === kind)
    if (index < 0) return false
    this.take(index)
    return true
  }

  count(kind: ItemKind): number {
    return this.slots.reduce((n, s) => n + (s?.kind === kind ? s.count : 0), 0)
  }

  has(kind: ItemKind): boolean {
    return this.count(kind) > 0
  }

  get full(): boolean {
    return !this.slots.includes(null)
  }
}
