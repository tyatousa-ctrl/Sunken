import './style.css'
import { Game } from './core/Game'
import { loadSettings, saveSettings } from './core/settings'
import type { VignetteStrength } from './movement/ComfortVignette'
import type { TurnMode } from './movement/Player'
import { DiveStage } from './stages/DiveStage'
import { IntroStage } from './stages/IntroStage'

const settings = loadSettings()
const game = new Game(document.getElementById('app')!, settings)
// `?stage=sandbox` skips the intro and drops straight into the underwater movement sandbox.
const params = new URLSearchParams(location.search)
game.start(params.get('stage') === 'sandbox' ? new DiveStage(game, 'sandbox') : new IntroStage(game))

const fpsToggle = document.getElementById('opt-fps') as HTMLInputElement
const seatedToggle = document.getElementById('opt-seated') as HTMLInputElement
const vignetteSelect = document.getElementById('opt-vignette') as HTMLSelectElement
const turnSelect = document.getElementById('opt-turn') as HTMLSelectElement
fpsToggle.checked = settings.showFps
seatedToggle.checked = settings.seated
vignetteSelect.value = settings.vignette
turnSelect.value = settings.turn

fpsToggle.addEventListener('change', () => {
  settings.showFps = fpsToggle.checked
  game.fps.setVisible(settings.showFps)
  saveSettings(settings)
})
seatedToggle.addEventListener('change', () => {
  settings.seated = seatedToggle.checked
  game.player.setSeated(settings.seated)
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
if (params.has('debug')) Object.assign(window, { sunken: game })
