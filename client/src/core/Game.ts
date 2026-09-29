import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'
import { AudioSystem } from '../audio/AudioSystem'
import { Controllers } from '../input/Controllers'
import { DesktopControls } from '../input/DesktopControls'
import type { Hand } from '../input/Hand'
import { ComfortVignette } from '../movement/ComfortVignette'
import { Player } from '../movement/Player'
import { FpsOverlay } from '../ui/FpsOverlay'
import { Hud } from '../ui/Hud'
import { WristComputer } from '../ui/WristComputer'
import type { Settings } from './settings'
import { Inventory } from '../systems/Inventory'
import type { NetClient, RosterEntry } from '../net/NetClient'
import { RemotePlayers } from '../net/RemotePlayers'
import { Voice } from '../net/Voice'
import type { PoseArray } from '../net/protocol'
import type { GameContext, PartyState, RunRecord, Stage } from './Stage'

const FADE_SECONDS = 0.6

// Owns the renderer, XR session, player rig, shared services and the single animation loop,
// and runs whichever Stage is active (swapping stages behind a fade).
export class Game implements GameContext {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 5000)
  // Everything that moves with the player (camera + controllers) hangs off the rig.
  readonly rig = new THREE.Group()
  readonly fps: FpsOverlay
  readonly vignette: ComfortVignette
  readonly player: Player
  readonly audio: AudioSystem
  readonly hud: Hud
  readonly wrist: WristComputer
  readonly desktop: DesktopControls
  readonly record: RunRecord = { whoShotFirst: null, clayHits: 0, clayShots: 0, bullseyeBeforeBattle: false }
  // Single player plays the Strongman until character selection arrives with the lobby.
  readonly party: PartyState = { character: 'strongman', inventory: new Inventory(), score: 0, hasMap: false, mapPieces: [1], checkpoint: 'intro' }
  stage: Stage | null = null
  net: NetClient | null = null
  remote: RemotePlayers | null = null
  voice: Voice | null = null

  private readonly timer = new THREE.Timer()
  private readonly controllers: Controllers
  private readonly size = new THREE.Vector2()
  private pending: (() => Stage) | null = null
  private fadeDir = 0
  private readonly pose: PoseArray = new Array(21).fill(0)
  private readonly pv = new THREE.Vector3()
  private readonly pq = new THREE.Quaternion()
  private lastRoster = new Map<string, RosterEntry>()
  private micTouchCooldown = 0

  constructor(
    container: HTMLElement,
    readonly settings: Settings,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.xr.enabled = true
    this.renderer.xr.setReferenceSpaceType('local-floor')
    // Fixed foveated rendering: full strength is cheap on Quest and hard to notice in fog.
    this.renderer.xr.setFoveation(1)
    container.appendChild(this.renderer.domElement)
    document.body.appendChild(VRButton.createButton(this.renderer, { optionalFeatures: ['hand-tracking'] }))

    this.rig.add(this.camera)
    this.scene.add(this.rig)
    this.camera.position.set(0, 1.6, 0)

    this.controllers = new Controllers(this.renderer, this.rig)
    this.desktop = new DesktopControls(this.renderer.domElement, this.camera)
    this.vignette = new ComfortVignette(this.camera, settings.vignette)
    this.player = new Player(this.rig, this.camera, this.controllers.hands, this.vignette, settings.turn, settings.seated)
    this.fps = new FpsOverlay(this.renderer, this.controllers.leftGrip, settings.showFps)
    this.wrist = new WristComputer(this.controllers.leftGrip)
    this.audio = new AudioSystem(this.camera, this.scene, this.controllers.hands)
    this.hud = new Hud(this.scene, this.camera)

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

  get inXr(): boolean {
    return this.renderer.xr.isPresenting
  }

  get hands(): Hand[] {
    return this.inXr ? this.controllers.hands : [this.desktop.hand]
  }

  get halfHeight(): number {
    if (this.inXr) {
      const layer = this.renderer.xr.getBaseLayer() as (XRWebGLLayer & { textureHeight?: number }) | null
      const height = layer?.framebufferHeight ?? layer?.textureHeight
      if (height) return height / 2
    }
    return this.renderer.getDrawingBufferSize(this.size).y / 2
  }

  start(first: Stage): void {
    this.stage = first
    first.enter()
    this.renderer.setAnimationLoop((time) => this.tick(time))
  }

  /** Join a crew: start sending our pose, draw the others, open voice chat. */
  async connect(net: NetClient): Promise<void> {
    this.net = net
    this.remote = new RemotePlayers(this.scene, net)
    this.voice = new Voice(net, this.audio, this.remote)
    this.audio.start()
    await this.voice.start()
    this.voice.setMuted(this.settings.muted)
    this.hud.now(`You're in crew ${net.code}. Share the code so friends can join.`, 6)
  }

  goTo(next: () => Stage): void {
    if (this.pending) return
    this.pending = next
    this.fadeDir = 1
  }

  private tick(time: number): void {
    this.timer.update(time)
    const dt = Math.min(this.timer.getDelta(), 0.1)
    const inXr = this.inXr

    this.controllers.update(dt)
    this.desktop.setActive(!inXr)
    if (!inXr) {
      this.desktop.update()
      this.desktop.hand.update(dt)
    }
    this.stage?.update(dt, time / 1000)
    this.updateNet(dt)
    this.updateTransition(dt)
    this.hud.update(dt, inXr)
    this.audio.update(dt, this.player.lastResult.thrust)
    this.vignette.update(dt, this.player.speed, this.player.physics.yawRate)
    this.fps.update(time)
    this.renderer.render(this.scene, this.camera)
  }

  private updateNet(dt: number): void {
    const net = this.net
    if (!net || !this.stage) return
    const underwater = this.player.env?.kind === 'swim'
    net.update(dt, this.stage.id, this.buildPose(), underwater)
    this.remote?.update(this.stage.id)
    this.voice?.update(underwater)
    this.announceRoster(net)
    this.checkMicTouch(dt)
  }

  /** Head and both hands, world space: [head pos, head quat, left pos, left quat, right pos, right quat]. */
  private buildPose(): PoseArray {
    const pose = this.pose
    const write = (object: THREE.Object3D, at: number) => {
      object.getWorldPosition(this.pv).toArray(pose, at)
      object.getWorldQuaternion(this.pq).toArray(pose, at + 3)
    }
    write(this.camera, 0)
    if (this.inXr) {
      const left = this.controllers.left
      const right = this.controllers.right
      if (left) write(left.grip, 7)
      else this.restingHand(-1, 7)
      if (right) write(right.grip, 14)
      else this.restingHand(1, 14)
    } else {
      this.restingHand(-1, 7)
      write(this.desktop.hand.grip, 14)
    }
    return pose
  }

  /** A hand at the hip when it isn't tracked. */
  private restingHand(side: number, at: number): void {
    this.pv.set(side * 0.25, -0.55, -0.1)
    this.camera.localToWorld(this.pv).toArray(this.pose, at)
    this.camera.getWorldQuaternion(this.pq).toArray(this.pose, at + 3)
  }

  private announceRoster(net: NetClient): void {
    const now = new Map(net.roster().filter((p) => p.sessionId !== net.sessionId).map((p) => [p.sessionId, p]))
    for (const [id, p] of now) {
      const before = this.lastRoster.get(id)
      if (!before) this.hud.now(`${p.name} joined the crew.`, 3)
      else if (before.connected && !p.connected) this.hud.now(`${p.name} dropped out. Their slot is kept for 2 minutes.`, 4)
      else if (!before.connected && p.connected) this.hud.now(`${p.name} is back.`, 3)
    }
    for (const [id, p] of this.lastRoster) if (!now.has(id)) this.hud.now(`${p.name} left the crew.`, 3)
    this.lastRoster = now
  }

  /** Touch the dive computer on your left wrist with your other hand to mute or unmute. */
  private checkMicTouch(dt: number): void {
    this.micTouchCooldown = Math.max(0, this.micTouchCooldown - dt)
    const voice = this.voice
    const right = this.controllers.right
    const left = this.controllers.left
    if (!voice || !this.inXr || !right || !left || this.micTouchCooldown > 0) return
    if (right.worldPos(this.pv).distanceTo(left.grip.localToWorld(new THREE.Vector3(0, 0.015, 0.075))) > 0.06) return
    this.micTouchCooldown = 1.2
    voice.setMuted(!voice.muted)
    this.settings.muted = voice.muted
    right.pulse(0.4, 40)
    this.hud.now(voice.muted ? 'Microphone off.' : 'Microphone on.', 2)
  }

  private updateTransition(dt: number): void {
    if (this.fadeDir === 0) return
    this.vignette.transition = THREE.MathUtils.clamp(this.vignette.transition + (this.fadeDir * dt) / FADE_SECONDS, 0, 1)
    if (this.fadeDir > 0 && this.vignette.transition >= 1 && this.pending) {
      this.stage?.exit()
      this.stage = this.pending()
      this.pending = null
      this.stage.enter()
      this.fadeDir = -1
    } else if (this.fadeDir < 0 && this.vignette.transition <= 0) {
      this.fadeDir = 0
    }
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
