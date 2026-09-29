import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Controllers } from '../input/Controllers'
import { FpsOverlay } from '../ui/FpsOverlay'
import { SeabedScene } from '../world/SeabedScene'
import type { Settings } from './settings'

// Owns the renderer, XR session, player rig and the single animation loop.
export class Game {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 500)
  // Everything that moves with the player (camera + controllers) hangs off the rig.
  readonly rig = new THREE.Group()
  readonly fps: FpsOverlay

  private readonly timer = new THREE.Timer()
  private readonly controllers: Controllers
  private readonly world: SeabedScene
  private readonly orbit: OrbitControls

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

    this.world = new SeabedScene(this.scene)
    this.controllers = new Controllers(this.renderer, this.rig)
    this.fps = new FpsOverlay(this.renderer, this.controllers.leftGrip, settings.showFps)

    // Desktop-only look-around; XR drives the camera directly while presenting.
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.target.set(0, 1.5, -2)
    this.orbit.enableDamping = true
    this.orbit.update()

    this.renderer.xr.addEventListener('sessionstart', () => this.onSessionChange(true))
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
    if (!this.renderer.xr.isPresenting) this.orbit.update()
    this.world.update(dt, time / 1000)
    this.fps.update(time)
    this.renderer.render(this.scene, this.camera)
  }

  private onSessionChange(inXr: boolean): void {
    document.body.classList.toggle('in-xr', inXr)
    this.orbit.enabled = !inXr
    if (!inXr) {
      this.camera.position.set(0, 1.6, 0)
      this.orbit.update()
    }
  }

  private resize(): void {
    if (this.renderer.xr.isPresenting) return
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }
}
