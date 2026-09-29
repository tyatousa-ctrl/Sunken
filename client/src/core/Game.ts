import { ControllerGuide } from '../ui/ControllerGuide'
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
import { Avatar, RemotePlayers } from '../net/RemotePlayers'
import { Voice } from '../net/Voice'
import type { PoseArray } from '../net/protocol'
import { BotCrew } from '../bots/BotCrew'
import { BotCommands } from '../bots/BotCommands'
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
  readonly party: PartyState
  stage: Stage | null = null
  net: NetClient | null = null
  remote: RemotePlayers | null = null
  voice: Voice | null = null
  readonly bots: BotCrew
  private readonly botCommands: BotCommands

  private readonly timer = new THREE.Timer()
  private readonly controllers: Controllers
  private readonly guide: ControllerGuide
  /** Your own diver body, under the camera. */
  private readonly selfBody = new Avatar('#e8b930')
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
    this.party = { character: settings.character, inventory: new Inventory(), score: 0, hasMap: false, mapPieces: [1], checkpoint: 'intro' }
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
    this.audio.setAmbience(settings.ambience)
    this.hud = new Hud(this.scene, this.camera)
    this.guide = new ControllerGuide(this.controllers.leftGrip, this.controllers.rightGrip)
    this.selfBody.makeSelf()
    this.scene.add(this.selfBody.group)
    this.bots = new BotCrew(this)
    this.botCommands = new BotCommands(this, this.bots)

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
    // Orders for bots from other players arrive here when this device runs the bots.
    net.on<{ botId: string; command: import('../bots/brain').Command; target?: number[]; from: string }>('botCommand', (msg) =>
      this.bots.command(msg.botId, msg.command, msg.target ? new THREE.Vector3().fromArray(msg.target) : null, msg.from),
    )
    net.on<{ character: string }>('characterDenied', () => this.hud.now('Someone in the crew already has that class.', 3))
    net.on<{ from: string }>('shareAir', (msg) => {
      this.player.refillFull()
      const who = net.roster().find((p) => p.sessionId === msg.from)?.name ?? 'A bot'
      this.hud.now(`${who} shares their air with you.`, 3)
    })
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
    this.bots.update(dt, this.stage)
    this.botCommands.update(dt)
    this.updateNet(dt)
    this.updateTransition(dt)
    this.controllers.setGlove(this.player.env?.kind === 'swim' ? 'neoprene' : 'skin')
    this.updateSelfBody()
    this.hud.update(dt, inXr)
    this.guide.enabled = this.settings.buttonHints
    const busy: [boolean, boolean] = [!!this.controllers.left?.held, !!this.controllers.right?.held]
    this.guide.update(this.pending ? null : (this.stage?.guide?.() ?? null), this.camera, inXr, busy)
    this.audio.update(dt, this.player.lastResult.thrust)
    this.vignette.update(dt, this.player.speed, this.player.physics.yawRate)
    this.fps.update(time)
    this.renderer.render(this.scene, this.camera)
  }

  private updateNet(dt: number): void {
    const net = this.net
    if (!net || !this.stage) return
    const underwater = this.player.env?.kind === 'swim'
    // The server has the final say on your class (one of each in a crew).
    const me = net.me()
    if (me && me.character !== this.party.character) this.party.character = me.character as PartyState['character']
    net.update(dt, this.stage.id, this.buildPose(), underwater)
    const others = net.roster().filter((p) => p.sessionId !== net.sessionId)
    this.remote?.update(this.stage.id, [...others, ...this.bots.remoteBotInfo()])
    this.voice?.update(underwater)
    this.announceRoster(net)
    this.checkMicTouch(dt)
  }

  /** Head and both hands, world space: [head pos, head quat, left pos, left quat, right pos, right quat]. */
  private updateSelfBody(): void {
    const body = this.selfBody
    body.group.visible = this.stage !== null && this.player.env !== null
    if (!body.group.visible) return
    const me = this.net?.sessionId ?? 'me'
    const color = this.bots.members().find((m) => m.id === me)?.color
    if (color) body.setColor(color)
    this.camera.getWorldPosition(body.head.position)
    this.camera.getWorldQuaternion(body.head.quaternion)
    body.water = this.player.env?.kind === 'swim' || this.player.inWater
    body.poseBody()
  }

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
