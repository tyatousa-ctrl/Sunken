import './style.css'
import { Game } from './core/Game'
import { loadSettings, saveSettings } from './core/settings'

const settings = loadSettings()
const game = new Game(document.getElementById('app')!, settings)
game.start()

const fpsToggle = document.getElementById('opt-fps') as HTMLInputElement
fpsToggle.checked = settings.showFps
fpsToggle.addEventListener('change', () => {
  settings.showFps = fpsToggle.checked
  saveSettings(settings)
  game.fps.setVisible(settings.showFps)
})
