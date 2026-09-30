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
import { GogglesDisplay } from '../ui/GogglesDisplay'
import { MiniMap, type MapDot } from '../ui/MiniMap'
import { GameMenu, type MenuItem, type MenuSection } from '../ui/GameMenu'
import { CLASSES, CLASS_NAMES, type CharacterClass } from '../systems/crew'
import { saveSettings } from './settings'
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
  readonly goggles: GogglesDisplay
  /** Top right of the mask: the level from above, the crew as dots. */
  readonly miniMap: MiniMap
  /** Right thumbstick (Tab on desktop): empty your hands, switch class, hop to a level. */
  readonly menu: GameMenu
  /** Makes a fresh stage by id ('intro', 'level1' … 'vault', 'sandbox'); set by main. */
  stageFactory: ((id: string) => Stage) | null = null
  /** Where the crew is (the server's word): everyone goes where anyone moves on to. */
  private crewStage: string | null = null
  /** Tell the crew when the stage we're fading to is entered (off for following and for joining). */
  private announce = true
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
  /** Seen from above when a diver's head is out of the water. */
  private readonly topWater = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2f7fa3, roughness: 0.25, metalness: 0.1 }),
  )
  private readonly airFog = new THREE.Fog(0xf1c28e, 60, 700)
  private readonly airSky = new THREE.Color(0xe9c79a)
  private underwaterLook: { fog: THREE.Scene['fog']; background: THREE.Scene['background'] } | null = null
  /** Your own diver body, under the camera. */
  readonly selfBody = new Avatar('#e8b930')
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
    this.goggles = new GogglesDisplay(this.camera)
    this.miniMap = new MiniMap(this.camera)
    this.audio = new AudioSystem(this.camera, this.scene, this.controllers.hands)
    this.menu = new GameMenu(this.scene, this.audio, () => this.menuItems())
    this.audio.setAmbience(settings.ambience)
    this.hud = new Hud(this.scene, this.camera)
    this.guide = new ControllerGuide(this.controllers.leftGrip, this.controllers.rightGrip)
    this.selfBody.makeSelf()
    this.topWater.visible = false
    this.scene.add(this.topWater)
    this.player.onBreath = () => this.hud.now('Ahh, fresh air! Your tank is full.', 2.5)
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
    net.on<{ character: string; by: string }>('classSwapped', (msg) => {
      const cls = msg.character as CharacterClass
      this.hud.now(`${msg.by} swapped classes with you: you're the ${CLASS_NAMES[cls] ?? cls} now.`, 5)
    })
    net.on<{ character: string; from?: string }>('classChanged', (msg) => {
      const cls = msg.character as CharacterClass
      this.hud.now(msg.from ? `You and ${msg.from} swapped: you're the ${CLASS_NAMES[cls] ?? cls} now.` : `You're the ${CLASS_NAMES[cls] ?? cls} now.`, 4)
    })
    // One crew, one level: whoever moves on takes everyone with them.
    net.on<{ stage: string; by?: string }>('crewStage', (msg) => {
      if (!msg.stage) return
      const moving = this.crewStage !== null && msg.stage !== this.crewStage && msg.stage !== this.stage?.id && msg.by && msg.by !== net.sessionId
      this.crewStage = msg.stage
      if (moving) {
        const who = net.roster().find((p) => p.sessionId === msg.by)?.name ?? 'A crewmate'
        this.hud.now(`${who} went on ahead. The crew goes together!`, 4)
      }
    })
    net.send('whereIsCrew', {})
    net.on<{ from: string }>('shareAir', (msg) => {
      this.player.refillFull()
      const who = net.roster().find((p) => p.sessionId === msg.from)?.name ?? 'A bot'
      this.hud.now(`${who} shares their air with you.`, 3)
    })
    this.hud.now(`You're in crew ${net.code}. Share the code so friends can join.`, 6)
  }

  /** `announce: false` for a move the crew shouldn't follow (following them, or joining them). */
  goTo(next: () => Stage, options?: { announce?: boolean }): void {
    if (this.pending) return
    this.pending = next
    this.announce = options?.announce ?? true
    this.fadeDir = 1
  }

  /** Put down whatever is in both hands, close the map and backpack, and strip anything left stuck to them. */
  emptyHands(): void {
    const still = new THREE.Vector3()
    for (const hand of [...this.controllers.hands, this.desktop.hand]) {
      const held = hand.held
      hand.held = null
      hand.anchor = null
      if (held) {
        try {
          held.release(hand, still)
        } catch (err) {
          console.warn('emptyHands: release failed', err)
        }
      }
    }
    this.stage?.emptyHands?.()
    this.sweepHands()
    this.player.riding = false
  }

  /** Anything on a controller that isn't part of the hand itself (a stale map, a lost prop) goes. */
  private sweepHands(): void {
    for (const hand of [...this.controllers.hands, this.desktop.hand]) {
      for (const child of [...hand.grip.children]) if (!child.userData.fixture) child.removeFromParent()
    }
  }

  /** Switch class. In a crew, a class another player has is swapped with them. */
  chooseClass(cls: CharacterClass): void {
    if (this.net) this.net.send('profile', { character: cls })
    else this.party.character = cls
    this.settings.character = cls
    saveSettings(this.settings)
    this.hud.now(`You're the ${CLASS_NAMES[cls]} now.`, 3)
  }

  private menuItems(): { sections: MenuSection[]; items: MenuItem[] } {
    const net = this.net
    const holder = (cls: CharacterClass) => net?.roster().find((p) => p.connected && p.sessionId !== net.sessionId && p.character === cls)?.name
    const items: MenuItem[] = [
      { row: 0, key: 'H', label: 'Empty my hands', sub: 'Drop everything, close the map', action: () => {
        this.emptyHands()
        this.hud.now('Hands empty.', 2)
      } },
    ]
    CLASSES.forEach((cls, i) => {
      const mine = this.party.character === cls
      const other = holder(cls)
      items.push({
        row: 1,
        key: String(i + 1),
        label: CLASS_NAMES[cls],
        sub: mine ? 'You' : other ? `Swap with ${other}` : 'Free',
        current: mine,
        action: () => (mine ? undefined : this.chooseClass(cls)),
      })
    })
    const levels: [string, string][] = [['intro', 'Deck'], ['level1', 'Level 1'], ['level2', 'Level 2'], ['level3', 'Level 3'], ['level4', 'Level 4'], ['vault', 'Vault'], ['sandbox', 'Sandbox']]
    const keys = ['5', '6', '7', '8', '9', '0', '-']
    levels.forEach(([id, label], i) => {
      items.push({ row: i < 4 ? 2 : 3, key: keys[i], label, current: this.stage?.id === id, action: () => {
        const make = this.stageFactory
        if (make) this.goTo(() => make(id))
      } })
    })
    items.push({ row: 4, key: 'Tab', label: 'Close', action: () => {} })
    return {
      sections: [
        { row: 1, title: 'Your class' },
        { row: 2, title: net ? 'Go to a level (the whole crew comes)' : 'Go to a level' },
      ],
      items,
    }
  }

  /** Crewmates and bots on the mini map (everyone in this stage but you). */
  private mapDots(): MapDot[] {
    const dots: MapDot[] = []
    for (const [, avatar] of this.remote?.visibleAvatars() ?? []) dots.push({ position: avatar.head.getWorldPosition(new THREE.Vector3()), color: avatar.tint })
    for (const bot of this.bots.bots.values()) if (bot.avatar.group.visible) dots.push({ position: bot.head, color: bot.avatar.tint })
    return dots
  }

  private updateMiniMap(dt: number): void {
    const area = this.pending ? null : (this.stage?.mapArea?.() ?? null)
    if (this.miniMap.update(dt, this.vignette.maskOn, area, this.camera, this.mapDots())) {
      this.miniMap.draw(this.renderer, this.scene, [this.rig, this.hud.panel, this.selfBody.group, this.topWater])
    }
  }

  /** The crew moved on while we weren't looking: go too. */
  private followCrew(): void {
    const target = this.crewStage
    const stage = this.stage
    if (!this.net || !target || !stage || this.pending || stage.id === target || !this.stageFactory) return
    this.menu.close()
    if (stage.followCrew?.(target)) return
    const make = this.stageFactory
    this.goTo(() => make(target), { announce: false })
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
    this.menu.update(dt, this.hands, this.camera)
    this.followCrew()
    this.stage?.update(dt, time / 1000)
    this.bots.update(dt, this.stage)
    this.botCommands.update(dt)
    this.updateNet(dt)
    this.updateTransition(dt)
    this.controllers.setGlove(this.player.env?.kind === 'swim' ? 'neoprene' : 'skin')
    this.updateSelfBody()
    this.updateSurfacing()
    this.hud.update(dt, inXr)
    this.guide.enabled = this.settings.buttonHints
    const busy: [boolean, boolean] = [!!this.controllers.left?.held, !!this.controllers.right?.held]
    this.guide.update(this.pending ? null : (this.stage?.guide?.() ?? null), this.camera, inXr, busy)
    this.audio.update(dt, this.player.lastResult.thrust)
    this.vignette.update(dt, this.player.speed, this.player.physics.yawRate)
    // Mask on (from the deck onwards): the air gauge lives in the goggles, not on the wrist.
    this.wrist.airInMask = this.vignette.maskOn
    this.goggles.update(dt, this.vignette.maskOn, { air: this.player.air.fraction, depth: this.player.depth, refilling: this.player.refilling })
    this.updateMiniMap(dt)
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
  /** A diver's head out of the water sees sky and open sea (and hears waves), not the deep. */
  private updateSurfacing(): void {
    const env = this.player.env
    const above = env?.kind === 'swim' && this.pending === null && !this.stage?.ownsWaterLook && this.camera.getWorldPosition(this.pv).y > env.surfaceY + 0.02
    if (above && !this.underwaterLook) {
      this.underwaterLook = { fog: this.scene.fog, background: this.scene.background }
      this.scene.fog = this.airFog
      this.scene.background = this.airSky
      this.topWater.position.y = env.surfaceY
      this.topWater.visible = true
      this.audio.setEnvironment('air')
    } else if (!above && this.underwaterLook) {
      this.scene.fog = this.underwaterLook.fog
      this.scene.background = this.underwaterLook.background
      this.underwaterLook = null
      this.topWater.visible = false
      if (env?.kind === 'swim') this.audio.setEnvironment('water')
    }
  }

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
    body.stage = this.stage?.id ?? ''
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
      // Nothing from the old stage stays in your hands (or stuck to them).
      this.emptyHands()
      this.menu.close()
      this.stage?.exit()
      this.stage = this.pending()
      this.pending = null
      this.stage.enter()
      this.fadeDir = -1
      if (this.announce && this.net) {
        this.crewStage = this.stage.id
        this.net.send('goStage', { stage: this.stage.id })
      }
      this.announce = true
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
