import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'
import { UnderwaterAudio } from '../audio/UnderwaterAudio'
import { Controllers } from '../input/Controllers'
import { DesktopControls } from '../input/DesktopControls'
import { GrabSystem } from '../interaction/GrabSystem'
import { ComfortVignette } from '../movement/ComfortVignette'
import { Player } from '../movement/Player'
import { FpsOverlay } from '../ui/FpsOverlay'
import { WristComputer } from '../ui/WristComputer'
import { Bubbles } from '../world/Bubbles'
import { addSandboxProps } from '../world/SandboxProps'
import { SeabedScene, SURFACE_Y } from '../world/SeabedScene'
import type { Settings } from './settings'

// Owns the renderer, XR session, player rig and the single animation loop.
export class Game {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 500)
  // Everything that moves with the player (camera + controllers) hangs off the rig.
  readonly rig = new THREE.Group()
  readonly fps: FpsOverlay
  readonly vignette: ComfortVignette
  readonly player: Player

  private readonly timer = new THREE.Timer()
  private readonly controllers: Controllers
  private readonly desktop: DesktopControls
  private readonly bubbles = new Bubbles(SURFACE_Y)
  private readonly world: SeabedScene
  private readonly grab: GrabSystem
  private readonly wrist: WristComputer
  private readonly audio: UnderwaterAudio

  constructor(container: HTMLElement, settings: Settings) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.xr.enabled = true
    this.renderer.xr.setReferenceSpaceType('local-floor')
    // Fixed foveated rendering: full strength is cheap on Quest and hard to notice underwater.
    this.renderer.xr.setFoveation(1)
    container.appendChild(this.renderer.domElement)
    document.body.appendChild(VRButton.createButton(this.renderer, { optionalFeatures: ['hand-tracking'] }))

    this.rig.add(this.camera)
    this.scene.add(this.rig)
    this.camera.position.set(0, 1.6, 0)
    this.scene.add(this.bubbles.points)

    this.world = new SeabedScene(this.scene, this.bubbles)
    this.controllers = new Controllers(this.renderer, this.rig)
    this.desktop = new DesktopControls(this.renderer.domElement, this.camera)
    this.vignette = new ComfortVignette(this.camera, settings.vignette)
    this.player = new Player(this.rig, this.camera, this.controllers.hands, this.world.rocks, this.bubbles, this.vignette, settings.turn)
    this.grab = new GrabSystem(this.scene, this.world.rocks, () => this.player.refillFull())
    addSandboxProps(this.grab)

    this.fps = new FpsOverlay(this.renderer, this.controllers.leftGrip, settings.showFps)
    this.wrist = new WristComputer(this.controllers.leftGrip)
    this.audio = new UnderwaterAudio(this.camera, this.controllers.hands)

    const startAudio = () => this.audio.start()
    window.addEventListener('pointerdown', startAudio)
    window.addEventListener('keydown', startAudio)
    this.renderer.xr.addEventListener('sessionstart', () => {
      startAudio()
      this.onSessionChange(true)
    })
    this.renderer.xr.addEventListener('sessionend', () => this.onSessionChange(false))
    window.addEventListener('resize', () => this.resize())
    this.resize()
  }

  start(): void {
    this.renderer.setAnimationLoop((time) => this.tick(time))
  }

  private tick(time: number): void {
    this.timer.update(time)
    const dt = Math.min(this.timer.getDelta(), 0.1)
    const inXr = this.renderer.xr.isPresenting

    this.controllers.update(dt)
    if (!inXr) this.desktop.update()
    this.player.update(dt, inXr, this.desktop)
    this.grab.update(dt, this.controllers.hands, this.player.physics.velocity, this.rig)
    this.world.update(dt, time / 1000)
    this.bubbles.update(dt)
    this.audio.update(this.player.lastResult.thrust)
    this.vignette.update(dt, this.player.speed, this.player.physics.yawRate)
    this.wrist.update(dt, {
      air: this.player.air.fraction,
      depth: this.player.depth,
      speed: this.player.speed,
      refilling: this.player.refilling,
    })
    this.fps.update(time)
    this.renderer.render(this.scene, this.camera)
  }

  private onSessionChange(inXr: boolean): void {
    document.body.classList.toggle('in-xr', inXr)
    // XR drives the camera pose; restore the desktop eye height afterwards.
    if (!inXr) this.camera.position.set(0, 1.6, 0)
  }

  private resize(): void {
    if (this.renderer.xr.isPresenting) return
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }
}
