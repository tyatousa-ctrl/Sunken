import type { PartyState, RunRecord } from '../core/Stage'
import type { Slot } from './Inventory'

// Checkpoint save after each level (per device, in localStorage; guarded because storage can throw).

export interface SaveData {
  checkpoint: string
  score: number
  mapPieces: number[]
  slots: (Slot | null)[]
  record: RunRecord
}

const KEY = 'sunken-sicily.save'

export function saveCheckpoint(party: PartyState, record: RunRecord): void {
  const data: SaveData = {
    checkpoint: party.checkpoint,
    score: party.score,
    mapPieces: party.mapPieces,
    slots: party.inventory.slots,
    record,
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // Storage unavailable: the run just won't resume.
  }
}

export function loadCheckpoint(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SaveData) : null
  } catch {
    return null
  }
}
