import type { VignetteStrength } from '../movement/ComfortVignette'
import type { TurnMode } from '../movement/Player'

// Per-device settings, persisted in localStorage. Storage can throw (private mode), so every access is guarded.
export interface Settings {
  showFps: boolean
  vignette: VignetteStrength
  turn: TurnMode
  /** Raises the view for players sitting down. */
  seated: boolean
  /** Drunk visual effects (fog, haze); the gameplay wobble stays. */
  drunkFx: boolean
  /** Voice chat: your microphone is muted. */
  muted: boolean
  /** Name shown to your crew. */
  name: string
  /** Accessibility: pick spells from cards instead of drawing them. */
  spellMenu: boolean
  /** Background sound (sea, wind, underwater hum), 0–1. */
  ambience: number
  /** Button guide on the right controller. */
  buttonHints: boolean
  /** Floating notes, signs and pop-ups (the menu can switch them all off). */
  notes: boolean
  /** Preferred class (the crew board on deck can change it). */
  character: 'navigator' | 'strongman' | 'deepDiver' | 'fishWhisperer'
}

const KEY = 'sunken-sicily.settings'
const DEFAULTS: Settings = { showFps: true, vignette: 'low', turn: 'snap', seated: false, drunkFx: true, muted: false, name: '', spellMenu: false, character: 'strongman', ambience: 0.3, buttonHints: true, notes: true }

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // ignore: settings just won't persist
  }
}
