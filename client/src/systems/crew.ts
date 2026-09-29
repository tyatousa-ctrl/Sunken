import { MAX_PLAYERS, SLOT_COLORS } from '../net/protocol'

export type CharacterClass = 'navigator' | 'strongman' | 'deepDiver' | 'fishWhisperer'

export const CLASSES: CharacterClass[] = ['navigator', 'strongman', 'deepDiver', 'fishWhisperer']

export const CLASS_NAMES: Record<CharacterClass, string> = {
  navigator: 'Navigator',
  strongman: 'Strongman',
  deepDiver: 'Deep Diver',
  fishWhisperer: 'Fish Whisperer',
}

export interface HumanSeat {
  id: string
  slot: number
  name: string
  character: CharacterClass
  connected: boolean
}

export interface CrewMember {
  /** Session id for humans; "bot-<slot>" for bots. */
  id: string
  slot: number
  name: string
  color: string
  character: CharacterClass
  bot: boolean
  /** For a bot standing in for a dropped player: whose slot it's keeping. */
  standingInFor?: string
}

export const botId = (slot: number) => `bot-${slot}`

/**
 * Who's in each of the four slots: connected humans, and bots everywhere else. A dropped player's
 * bot keeps their class until they come back. Bots take the classes nobody else has, so every
 * skill is in the crew.
 */
export function crewMembers(humans: HumanSeat[]): CrewMember[] {
  const members: CrewMember[] = []
  const used = new Set<CharacterClass>(humans.filter((h) => h.connected).map((h) => h.character))
  for (let slot = 0; slot < MAX_PLAYERS; slot++) {
    const human = humans.find((h) => h.slot === slot)
    if (human?.connected) {
      members.push({ id: human.id, slot, name: human.name, color: SLOT_COLORS[slot], character: human.character, bot: false })
      continue
    }
    let character = human?.character
    if (!character || used.has(character)) character = CLASSES.find((c) => !used.has(c)) ?? CLASSES[slot]
    used.add(character)
    members.push({
      id: botId(slot),
      slot,
      name: human ? `${human.name}'s bot` : `${CLASS_NAMES[character]} bot`,
      color: SLOT_COLORS[slot],
      character,
      bot: true,
      standingInFor: human?.id,
    })
  }
  return members
}

/** The connected human in the lowest slot runs the bots for everyone. */
export function hostOf(humans: HumanSeat[]): string | null {
  const connected = humans.filter((h) => h.connected).sort((a, b) => a.slot - b.slot)
  return connected[0]?.id ?? null
}

/** A class nobody in the crew has picked yet (for a new arrival). */
export function freeClass(humans: HumanSeat[], preferred?: CharacterClass): CharacterClass {
  const taken = new Set(humans.filter((h) => h.connected).map((h) => h.character))
  if (preferred && !taken.has(preferred)) return preferred
  return CLASSES.find((c) => !taken.has(c)) ?? preferred ?? 'strongman'
}
