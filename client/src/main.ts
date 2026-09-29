import './style.css'
import { Game } from './core/Game'
import { loadSettings, saveSettings } from './core/settings'
import type { VignetteStrength } from './movement/ComfortVignette'
import type { TurnMode } from './movement/Player'

const settings = loadSettings()
const game = new Game(document.getElementById('app')!, settings)
game.start()

const fpsToggle = document.getElementById('opt-fps') as HTMLInputElement
const vignetteSelect = document.getElementById('opt-vignette') as HTMLSelectElement
const turnSelect = document.getElementById('opt-turn') as HTMLSelectElement
fpsToggle.checked = settings.showFps
vignetteSelect.value = settings.vignette
turnSelect.value = settings.turn

fpsToggle.addEventListener('change', () => {
  settings.showFps = fpsToggle.checked
  game.fps.setVisible(settings.showFps)
  saveSettings(settings)
})
vignetteSelect.addEventListener('change', () => {
  settings.vignette = vignetteSelect.value as VignetteStrength
  game.vignette.setStrength(settings.vignette)
  saveSettings(settings)
})
turnSelect.addEventListener('change', () => {
  settings.turn = turnSelect.value as TurnMode
  game.player.setTurnMode(settings.turn)
  saveSettings(settings)
})

// Test hook: `?debug` exposes the game object for automated browser tests and console poking.
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { sunken: game })
