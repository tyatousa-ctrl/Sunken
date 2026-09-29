// Per-device settings, persisted in localStorage. Storage can throw (private mode), so every access is guarded.
export interface Settings {
  showFps: boolean
}

const KEY = 'sunken-sicily.settings'
const DEFAULTS: Settings = { showFps: true }

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
