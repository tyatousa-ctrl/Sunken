import type { CharacterClass } from '../core/Stage'

export interface SkillSpec {
  name: string
  /** Seconds before the skill can be used again. */
  cooldown: number
  /** What pressing B does, for prompts. */
  action: string
}

/** The four classes' special skills (B button), from the brief. */
export const SKILLS: Record<CharacterClass, SkillSpec> = {
  navigator: { name: 'Navigator', cooldown: 45, action: 'read hidden ink' },
  strongman: { name: 'Strongman', cooldown: 20, action: 'lift something heavy' },
  deepDiver: { name: 'Deep Diver', cooldown: 60, action: 'share air' },
  fishWhisperer: { name: 'Fish Whisperer', cooldown: 30, action: 'call a creature' },
}

export class SkillCooldown {
  remaining = 0

  constructor(readonly seconds: number) {}

  get ready(): boolean {
    return this.remaining <= 0
  }

  /** Use the skill if it's ready; returns whether it fired. */
  trigger(): boolean {
    if (!this.ready) return false
    this.remaining = this.seconds
    return true
  }

  update(dt: number): void {
    this.remaining = Math.max(0, this.remaining - dt)
  }
}
