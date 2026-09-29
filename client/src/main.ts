import * as THREE from 'three'
import './style.css'
import { Game } from './core/Game'
import { loadSettings, saveSettings } from './core/settings'
import type { VignetteStrength } from './movement/ComfortVignette'
import type { TurnMode } from './movement/Player'
import { DiveStage } from './stages/DiveStage'
import { IntroStage } from './stages/IntroStage'
import { Level1Stage } from './stages/Level1Stage'
import { Level2Stage } from './stages/Level2Stage'
import { Level3Stage } from './stages/Level3Stage'
import { NetClient, type JoinMode } from './net/NetClient'
import { ATTACK_SECONDS } from './intro/attackTimeline'

const settings = loadSettings()
const game = new Game(document.getElementById('app')!, settings)
// `?stage=level1` / `?stage=sandbox` skip the intro (also offered by the "Start at" menu).
const params = new URLSearchParams(location.search)
const startAt = params.get('stage') ?? 'intro'
/** A fresh stage by its id ('intro' for the deck). */
function makeStage(id: string) {
  return id === 'sandbox' ? new DiveStage(game) : id === 'level1' ? new Level1Stage(game, false) : id === 'level2' ? new Level2Stage(game) : id === 'level3' ? new Level3Stage(game) : new IntroStage(game)
}
game.start(makeStage(startAt))
// Testing: jump to any level from inside the game (both thumbsticks, or L on desktop).
game.levelHop.setTargets([
  { label: 'Deck', make: () => makeStage('intro') },
  { label: 'Level 1', make: () => makeStage('level1') },
  { label: 'Level 2', make: () => makeStage('level2') },
  { label: 'Level 3', make: () => makeStage('level3') },
  { label: 'Sandbox', make: () => makeStage('sandbox') },
])

const startSelect = document.getElementById('opt-start') as HTMLSelectElement
startSelect.value = ['intro', 'level1', 'level2', 'level3', 'sandbox'].includes(startAt) ? startAt : 'intro'
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

// ---- Crew ----------------------------------------------------------------------------------------

const nameInput = document.getElementById('crew-name') as HTMLInputElement
const codeInput = document.getElementById('crew-code') as HTMLInputElement
const muteToggle = document.getElementById('opt-mute') as HTMLInputElement
const classSelect = document.getElementById('opt-class') as HTMLSelectElement
const spellMenuToggle = document.getElementById('opt-spellmenu') as HTMLInputElement
declare const __BUILD_ID__: string
document.getElementById('build-id')!.textContent = `Build ${__BUILD_ID__}`
console.info(`Sunken Sicily build ${__BUILD_ID__}`)
const ambienceSlider = document.getElementById('opt-ambience') as HTMLInputElement
const hintsToggle = document.getElementById('opt-hints') as HTMLInputElement
ambienceSlider.value = String(Math.round(settings.ambience * 100))
hintsToggle.checked = settings.buttonHints
ambienceSlider.addEventListener('input', () => {
  settings.ambience = Number(ambienceSlider.value) / 100
  game.audio.setAmbience(settings.ambience)
  saveSettings(settings)
})
hintsToggle.addEventListener('change', () => {
  settings.buttonHints = hintsToggle.checked
  saveSettings(settings)
})
classSelect.value = settings.character
spellMenuToggle.checked = settings.spellMenu
classSelect.addEventListener('change', () => {
  settings.character = classSelect.value as typeof settings.character
  saveSettings(settings)
  if (game.net) game.net.send('profile', { character: settings.character })
  else game.party.character = settings.character
})
spellMenuToggle.addEventListener('change', () => {
  settings.spellMenu = spellMenuToggle.checked
  saveSettings(settings)
})
// Keep the menu in step with the crew board on deck.
setInterval(() => {
  if (classSelect.value !== game.party.character) classSelect.value = game.party.character
}, 1000)
const status = document.getElementById('crew-status') as HTMLElement
const crewButtons = ['crew-create', 'crew-quick', 'crew-join'].map((id) => document.getElementById(id) as HTMLButtonElement)
const rejoinButton = document.getElementById('crew-rejoin') as HTMLButtonElement
const leaveButton = document.getElementById('crew-leave') as HTMLButtonElement
nameInput.value = settings.name
muteToggle.checked = settings.muted

nameInput.addEventListener('change', () => {
  settings.name = nameInput.value.trim().slice(0, 16)
  saveSettings(settings)
  game.net?.send('profile', { name: settings.name })
})
muteToggle.addEventListener('change', () => {
  settings.muted = muteToggle.checked
  game.voice?.setMuted(settings.muted)
  saveSettings(settings)
})

async function joinCrew(mode: JoinMode): Promise<void> {
  crewButtons.forEach((b) => (b.disabled = true))
  rejoinButton.hidden = true
  status.textContent = 'Connecting...'
  try {
    const net = await NetClient.connect(mode, settings.name || 'Diver', settings.character)
    await game.connect(net)
    // Everyone restarts where the crew is: on deck, or in Level 1 once the ship has gone down.
    // (Testing: a "Start at" level other than the deck takes you straight there instead.)
    const state = net.state
    const shipGone = state?.attackAt && (net.serverNow() - state.attackAt) / 1000 > ATTACK_SECONDS
    const chosen = startSelect.value
    game.goTo(() => (chosen !== 'intro' ? makeStage(chosen) : shipGone ? new Level1Stage(game, false) : new IntroStage(game)))
    leaveButton.hidden = false
    showCrew()
  } catch (err) {
    crewButtons.forEach((b) => (b.disabled = false))
    status.textContent = mode.kind === 'join' ? `Couldn't join crew ${mode.code}. Check the code (it may be full or closed).` : "Couldn't reach the crew server. Try again in a moment."
    console.warn('crew', err)
  }
}

function showCrew(): void {
  const net = game.net
  if (!net) return
  const names = net.roster().map((p) => `${p.name}${p.sessionId === net.sessionId ? ' (you)' : ''}${p.connected ? '' : ' (reconnecting)'}`)
  status.innerHTML = `Crew <b>${net.code}</b> · ${names.join(', ')}`
}
setInterval(showCrew, 1000)

document.getElementById('crew-create')!.addEventListener('click', () => void joinCrew({ kind: 'create' }))
document.getElementById('crew-quick')!.addEventListener('click', () => void joinCrew({ kind: 'quick' }))
document.getElementById('crew-join')!.addEventListener('click', () => {
  const code = codeInput.value.trim().toUpperCase().replace(/[^A-Z]/g, '')
  if (code.length === 4) void joinCrew({ kind: 'join', code })
  else status.textContent = 'Room codes are 4 letters.'
})
leaveButton.addEventListener('click', async () => {
  await game.net?.leave()
  location.reload()
})
// Dropped out or reloaded this tab? Offer the way back into the same slot.
const saved = NetClient.savedRejoin()
if (saved) {
  rejoinButton.hidden = false
  rejoinButton.textContent = `Rejoin crew ${saved.code}`
  rejoinButton.addEventListener('click', () => void joinCrew({ kind: 'rejoin', token: saved.token }))
}

// Test hook: `?debug` exposes the game object for automated browser tests and console poking.
if (params.has('debug')) Object.assign(window, { sunken: game, THREE })
