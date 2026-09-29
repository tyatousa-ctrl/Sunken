import './style.css'
import { Game } from './core/Game'
import { loadSettings, saveSettings } from './core/settings'
import type { VignetteStrength } from './movement/ComfortVignette'
import type { TurnMode } from './movement/Player'
import { DiveStage } from './stages/DiveStage'
import { IntroStage } from './stages/IntroStage'
import { Level1Stage } from './stages/Level1Stage'

const settings = loadSettings()
const game = new Game(document.getElementById('app')!, settings)
// `?stage=level1` / `?stage=sandbox` skip the intro (also offered by the "Start at" menu).
const params = new URLSearchParams(location.search)
const startAt = params.get('stage') ?? 'intro'
game.start(startAt === 'sandbox' ? new DiveStage(game) : startAt === 'level1' ? new Level1Stage(game, false) : new IntroStage(game))

const startSelect = document.getElementById('opt-start') as HTMLSelectElement
startSelect.value = ['intro', 'level1', 'sandbox'].includes(startAt) ? startAt : 'intro'
startSelect.addEventListener('change', () => {
  const next = new URLSearchParams(location.search)
  next.set('stage', startSelect.value)
  location.search = next.toString()
})

const fpsToggle = document.getElementById('opt-fps') as HTMLInputElement
const seatedToggle = document.getElementById('opt-seated') as HTMLInputElement
const drunkToggle = document.getElementById('opt-drunkfx') as HTMLInputElement
const vignetteSelect = document.getElementById('opt-vignette') as HTMLSelectElement
const turnSelect = document.getElementById('opt-turn') as HTMLSelectElement
fpsToggle.checked = settings.showFps
seatedToggle.checked = settings.seated
drunkToggle.checked = settings.drunkFx
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
drunkToggle.addEventListener('change', () => {
  settings.drunkFx = drunkToggle.checked
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

// No WebXR (e.g. iPhone Safari): say where the game can actually be played.
const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr
const showNoXr = () => ((document.getElementById('no-xr') as HTMLElement).hidden = false)
if (!xr) showNoXr()
else xr.isSessionSupported('immersive-vr').then((ok) => ok || showNoXr(), showNoXr)

// Test hook: `?debug` exposes the game object for automated browser tests and console poking.
if (params.has('debug')) Object.assign(window, { sunken: game })
