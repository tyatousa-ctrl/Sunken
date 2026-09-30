import type { ButtonGuide } from '../ui/ControllerGuide'
import * as THREE from 'three'
import { disposeTree, type GameContext, type Stage } from '../core/Stage'
import type { Hand } from '../input/Hand'
import { GrabSystem } from '../interaction/GrabSystem'
import { LooseItem } from '../interaction/LooseItem'
import { ExitGate } from '../level1/ExitGate'
import type { BoxCollider, RefillZone, SwimEnvironment } from '../movement/environment'
import { LevelProgress, type LevelData, type ProgressEvent } from '../systems/LevelProgress'
import { SCORE, type ItemKind } from '../systems/Inventory'
import { makeItem } from '../systems/items'
import { saveCheckpoint } from '../systems/save'
import { SKILLS, SkillCooldown } from '../systems/skills'
import type { CharacterClass } from '../systems/crew'
import type { SpellShape } from '../systems/gesture'
import { Magic } from '../magic/Magic'
import { FishSchool } from '../skills/effects'
import { Particles } from '../fx/Particles'
import { TUNING } from '../movement/tuning'
import type { BotTask, BotWorld } from '../bots/world'
import { Backpack } from '../ui/Backpack'
import { MapView } from '../ui/MapView'
import { Bubbles } from '../world/Bubbles'
import { SURFACE_Y, type RockCollider } from '../world/SeabedScene'

/** Swimming this close to a coin or gem picks it up. */
const COLLECT_RADIUS = 0.45
const SKILL_TAGS: Record<string, string> = { navigator: 'NAVI', strongman: 'STRONG', deepDiver: 'DIVER', fishWhisperer: 'FISH' }
const FISH_RANGE = 12
const SHARE_RANGE = 2.5

export interface Collectible {
  item: LooseItem
  kind: ItemKind
  id: string
}

/** What a level tells the shared machinery about its world. */
export interface DiveLevelSetup {
  floorHeight: (x: number, z: number) => number
  /** How far from the centre divers may roam. */
  radius: number
  refillZones: RefillZone[]
  /** Where divers come back to after running out of air. */
  checkpoint: THREE.Vector3
  /** The stone arch that opens when the riddle is solved: where, and which way it faces. */
  gate: { position: THREE.Vector3; yaw: number }
  /** Where bots go to refill (the level's air vent), if anywhere. */
  botRefill: THREE.Vector3 | null
  /** Walls for oddly shaped water (caves, tunnels); see SwimEnvironment.contain. */
  contain?: SwimEnvironment['contain']
}

// Everything a dive level shares: swimming, the backpack and treasure map, coins, gems and runes,
// class skills and magic, the riddle's steps (checked by the server in a crew), the exit arch, bots,
// crew sync and the level summary. A level adds its world, its riddle's puzzle pieces and where the
// compass points (see Level1Stage and Level2Stage).
export abstract class DiveLevel implements Stage {
  abstract readonly id: string
  readonly root = new THREE.Group()
  readonly progress: LevelProgress
  protected readonly bubbles = new Bubbles(SURFACE_Y)
  protected readonly rocks: RockCollider[] = []
  protected readonly boxes: BoxCollider[] = []
  protected readonly glow = new Particles({ max: 500, gravity: 0, drag: 0.5, blending: THREE.AdditiveBlending })
  protected readonly collectibles: Collectible[] = []
  protected readonly unsubscribe: (() => void)[] = []
  protected skill!: SkillCooldown
  protected env!: SwimEnvironment
  protected magic!: Magic
  protected fish!: FishSchool
  protected grab!: GrabSystem
  protected gate!: ExitGate
  protected backpack!: Backpack
  protected map!: MapView
  protected setup!: DiveLevelSetup
  /** Applying steps that already happened before we joined: no announcements. */
  protected catchingUp = false
  protected time = 0
  protected complete = false
  /** The last level: no arch and no next riddle once it's solved. */
  protected readonly finale: boolean = false
  protected readonly taught = new Set<string>()
  protected readonly v = new THREE.Vector3()
  protected readonly head = new THREE.Vector3()
  private botWorld: BotWorld | null = null

  constructor(
    protected readonly game: GameContext,
    protected readonly level: LevelData,
  ) {
    this.progress = new LevelProgress(level)
  }

  // ---- What each level provides ------------------------------------------------------------------

  /** Build the scenery (seabed, reef, wreck...) under `root`; add rocks and boxes to collide with. */
  protected abstract buildWorld(): DiveLevelSetup
  /** The riddle's puzzle pieces, and the level's coins, gems and runes. */
  protected abstract buildPuzzle(): void
  /** Put the diver in the level and say hello. Called last in `enter`. */
  protected abstract arrive(env: SwimEnvironment): void
  /** Per-frame level logic (animals, puzzle checks...). */
  protected abstract updateLevel(dt: number, elapsed: number): void
  /** A riddle step happened (`who`: a crewmate's name if they did it). Update the world to match. */
  protected abstract applyLevelStep(id: string, who: string | null, byOther: boolean): void
  /** Where the compass points: whatever the next step needs. */
  protected abstract objective(): THREE.Vector3
  /** What comes after this level (null: not built yet). */
  protected abstract nextStage(): (() => Stage) | null
  /** Advance the scenery's animation. */
  protected abstract updateWorld(dt: number, elapsed: number): void

  /** Level-specific uses of a class skill (the Strongman's heave, a turtle ride...). True if handled. */
  protected levelSkill(_cls: CharacterClass, _hand: Hand): boolean {
    return false
  }
  /** Hidden ink only the Navigator reads on the map. */
  protected levelInk(): string[] {
    return []
  }
  /** Waypoints for bots (default: straight there). */
  protected route(_from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    return [to]
  }
  /** Can a bot swim to this point right now (not behind a closed door, not up a current)? */
  protected botCanReach(_position: THREE.Vector3): boolean {
    return true
  }
  /** Something a bot with the right skill should do now. */
  protected botTask(): BotTask | null {
    return null
  }

  // ---- Stage ------------------------------------------------------------------------------------

  enter(): void {
    const { game } = this
    game.scene.add(this.root)
    this.root.add(this.bubbles.points)
    this.root.add(this.glow.points)
    const cls = game.party.character
    this.skill = new SkillCooldown(SKILLS[cls].cooldown)
    game.player.setAirCapacity(cls === 'deepDiver' ? TUNING.airCapacity * 2 : TUNING.airCapacity)
    this.fish = new FishSchool(this.root)

    const setup = (this.setup = this.buildWorld())
    this.grab = new GrabSystem({ rocks: this.rocks, floor: setup.floorHeight })
    this.backpack = this.grab.add(
      new Backpack(this.root, {
        inventory: game.party.inventory,
        audio: game.audio,
        camera: game.camera,
        itemParent: this.root,
        makeLoose: (object, kind) => this.makeLoose(object, kind),
        register: (item) => this.grab.add(item),
        onChange: () => {},
      }),
    )
    this.map = new MapView(this.root, game.audio)
    this.buildPuzzle()
    this.refreshMap()

    this.gate = new ExitGate(setup.gate.position, setup.gate.yaw, game.audio, setup.floorHeight)
    this.root.add(this.gate.group)
    this.boxes.push(this.gate.collider)

    const env: SwimEnvironment = (this.env = {
      kind: 'swim',
      floorHeight: setup.floorHeight,
      surfaceY: SURFACE_Y,
      rocks: this.rocks,
      boxes: this.boxes,
      radius: setup.radius,
      refillZones: setup.refillZones,
      contain: setup.contain,
    })
    this.magic = new Magic({
      root: this.root,
      camera: game.camera,
      audio: game.audio,
      hud: game.hud,
      glow: this.glow,
      refillZones: env.refillZones,
      spendRune: () => this.backpack.consume('rune'),
      broadcast: (kind, at, dir) => game.net?.send('spell', { kind, at: at.toArray(), dir: dir.toArray() }),
      menu: () => game.settings.spellMenu,
    })
    game.audio.setEnvironment('water')
    game.wrist.setVisible(true)
    game.vignette.setMask(true)
    game.player.air.fill()
    game.party.hasMap = true
    this.arrive(env)
    game.player.checkpoint.copy(setup.checkpoint)
    this.connectNet()
  }

  guide(): ButtonGuide {
    return {
      left: ['Grip + pull: swim', 'Trigger: bubble jet', 'X: backpack · put away', 'Y: magic', 'Stick: drift · click: map'],
      right: ['Grip + pull: swim', 'Trigger: bubble jet', 'A: backpack · put away', 'B: class skill', 'Stick: turn · rise / sink'],
      desktop: [
        '<b>Diving</b>',
        'WASD: swim · Space / Q: rise / sink · Shift: jets',
        'E: grab / drop · R: backpack · M: map',
        'B: class skill · 1 / 2 / 3: spells',
      ],
    }
  }

  update(dt: number, elapsed: number): void {
    const { game } = this
    this.time += dt
    this.skill.update(dt)

    game.player.update(dt, game.inXr, game.desktop)
    this.handleButtons()
    this.backpack.tick(game.hands)
    this.grab.update(dt, game.hands, game.player.physics.velocity, game.rig)
    this.map.update(game.hands)
    this.updateWorld(dt, elapsed)
    this.gate.update(dt)
    this.bubbles.update(dt)
    this.updateCollectibles(dt)
    this.updateLevel(dt, elapsed)
    this.updateProgress(dt)
    this.updateMagicAndSkills(dt)
    this.glow.update(dt, game.halfHeight)

    if (game.net) game.party.score = game.net.state?.teamScore ?? game.party.score
    game.wrist.update(dt, {
      air: game.player.air.fraction,
      depth: game.player.depth,
      speed: game.player.speed,
      refilling: game.player.refilling,
      skill: `${SKILL_TAGS[game.party.character]} ${this.skill.ready ? 'READY' : `${Math.ceil(this.skill.remaining)}s`}`,
      score: game.party.score,
      mana: Math.min(3, game.party.inventory.count('rune')),
    })
  }

  exit(): void {
    for (const off of this.unsubscribe) off()
    this.game.scene.remove(this.root)
    disposeTree(this.root)
  }

  // ---- Input ------------------------------------------------------------------------------------

  private handleButtons(): void {
    for (const hand of this.game.hands) {
      if (!hand.connected) continue
      // A/X: put away what's in this hand (or close the map); otherwise the backpack. Reaching over
      // the shoulder and gripping (empty-handed) also opens it.
      if (hand.primaryPressed && this.map.isOpen) this.map.close()
      else if (hand.primaryPressed && this.backpack.holds(hand.held)) {
        this.backpack.stow(hand.held)
        this.grab.drop(hand)
      } else if (hand.primaryPressed) this.openBackpack(hand)
      else if (hand.squeezePressed && !hand.held && !this.backpack.isOpen && this.backpack.overShoulder(hand)) {
        hand.squeezePressed = false
        this.openBackpack(hand)
      }
      // Left thumbstick click: the treasure map.
      if (hand.stickPressed && (hand.handedness === 'left' || hand.virtual)) this.toggleMap(hand)
      // B (right controller): your class skill. Y (left controller): ready a spell.
      if (hand.secondaryPressed && (hand.handedness === 'right' || hand.virtual)) this.useSkill(hand)
      if (hand.secondaryPressed && hand.handedness === 'left') this.magic.arm(hand)
    }
    const spell = this.game.inXr ? null : this.game.desktop.spell
    if (spell) this.magic.castNow(spell)
  }

  /** B: whatever your class does (the level gets first say). */
  private useSkill(hand: Hand): void {
    const { game } = this
    const cls = game.party.character
    if (this.levelSkill(cls, hand)) return
    switch (cls) {
      case 'strongman':
        game.hud.now('Nothing heavy to lift here.', 2)
        return
      case 'navigator': {
        // Reading the map's hidden ink: the next hint now, instead of waiting. Hints nudge; they
        // never give the answer away.
        if (this.progress.solved || this.progress.hintsUnlocked >= this.level.hints.length) {
          return void game.hud.now('No more hidden ink to read. Work it out with your crew!', 3)
        }
        if (!this.skill.trigger()) return this.spent()
        const hint = this.progress.revealHint()
        if (hint) this.onProgress([hint])
        return
      }
      case 'deepDiver': {
        const head = game.camera.getWorldPosition(new THREE.Vector3())
        const bot = [...game.bots.bots.values()].find((b) => b.head.distanceTo(head) < SHARE_RANGE)
        const mate = game.net?.roster().find((p) => p.sessionId !== game.net!.sessionId && p.connected && game.remote?.head(p.sessionId)?.getWorldPosition(new THREE.Vector3()).distanceTo(head)! < SHARE_RANGE)
        if (!bot && !mate) return void game.hud.now('No diver close enough to share air with.', 2)
        if (!this.skill.trigger()) return this.spent()
        if (bot) bot.air.fill()
        if (mate) game.net!.send('shareAir', { to: mate.sessionId })
        game.hud.now(`You share your air with ${bot?.name ?? mate!.name}.`, 3)
        return
      }
      case 'fishWhisperer': {
        const head = game.camera.getWorldPosition(new THREE.Vector3())
        const target = this.collectibles
          .filter((c) => c.item.enabled && c.item.object.visible)
          .map((c) => ({ c, d: c.item.object.getWorldPosition(new THREE.Vector3()).distanceTo(head) }))
          .filter((x) => x.d < FISH_RANGE)
          .sort((a, b) => a.d - b.d)[0]
        if (!target) return void game.hud.now('The fish find nothing worth fetching nearby.', 2)
        if (this.fish.busy || !this.skill.trigger()) return this.spent()
        target.c.item.enabled = false
        this.root.attach(target.c.item.object)
        this.fish.fetch(head, target.c.item.object, () => {
          target.c.item.enabled = true
          this.collect(target.c.item, target.c.kind, null)
        })
        game.hud.now('A school of bream darts off to fetch something shiny.', 3)
        return
      }
    }
  }

  protected spent(): void {
    this.game.hud.now(`${SKILLS[this.game.party.character].name} skill recovering: ${Math.ceil(this.skill.remaining)} s.`, 2)
  }

  private updateMagicAndSkills(dt: number): void {
    const { game } = this
    this.magic.update(dt, game.hands)
    const head = game.camera.getWorldPosition(new THREE.Vector3())
    // Currents carry the diver along.
    game.player.physics.velocity.addScaledVector(this.magic.flowAt(head, game.player.physics.velocity), dt)
    this.fish.update(dt, head)
  }

  private openBackpack(hand: Hand): void {
    this.backpack.toggle(hand)
    if (this.backpack.isOpen) this.teach('backpack', 'To stow something, let go of it over the open backpack, or over your shoulder. Grip a slot to take it out.')
  }

  private toggleMap(hand: Hand): void {
    this.map.toggle(hand)
    if (this.map.isOpen && !this.taught.has('map')) {
      this.teach('map', `The riddle on your map: "${this.level.riddle}"`, 8)
      this.game.hud.say('Turn the map over for notes. Grip it with your other hand and pull to zoom. A or X puts it away.', 5)
    }
  }

  // ---- Riddle -------------------------------------------------------------------------------------

  private updateProgress(dt: number): void {
    const event = this.progress.update(dt)
    if (event) this.onProgress([event])
    this.map.setCompass(this.progress.compassVisible, this.objective())
    const head = this.game.camera.getWorldPosition(this.head)
    if (this.progress.solved && !this.complete && !this.finale && this.gate.passedThrough(head)) this.finishLevel()
  }

  /**
   * Ask for a riddle step. Solo, it happens at once; in a crew the server checks the order and
   * everyone applies it together. Returns whether it counted locally (always false in a crew).
   */
  protected step(id: string): boolean {
    if (this.game.net) {
      if (this.progress.nextStep?.id === id) this.game.net.send('act', { level: this.level.id, step: id })
      return false
    }
    return this.applyStep(id)
  }

  /** A step happened (here, or anywhere in the crew): update the world. */
  protected applyStep(id: string, by?: string): boolean {
    const events = this.progress.complete(id)
    if (events.length === 0) return false
    const net = this.game.net
    const byOther = !!(by && net && by !== net.sessionId)
    const who = byOther ? (net!.roster().find((p) => p.sessionId === by)?.name ?? null) : null
    this.applyLevelStep(id, this.catchingUp ? null : who, byOther)
    if (this.progress.solved && !this.game.party.mapPieces.includes(this.level.reward.mapPiece)) this.game.party.mapPieces.push(this.level.reward.mapPiece)
    if (!this.catchingUp) this.onProgress(events)
    else if (this.progress.solved) this.openGate()
    return true
  }

  private openGate(): void {
    if (this.gate.opened) return
    this.gate.open()
    const i = this.boxes.indexOf(this.gate.collider)
    if (i >= 0) this.boxes.splice(i, 1)
    this.refreshMap()
  }

  private onProgress(events: ProgressEvent[]): void {
    const { game } = this
    for (const e of events) {
      if (e.type === 'hint') {
        game.hud.say(`A note appears on the back of your map: ${e.text}`, 7)
        this.refreshMap()
      } else if (e.type === 'solved') {
        this.openGate()
        game.party.checkpoint = `${this.level.id}-solved`
        game.player.checkpoint.copy(this.gate.group.localToWorld(new THREE.Vector3(0, 2, 3)))
        game.hud.now(this.level.reward.message, 5)
        if (!this.finale) game.hud.say('A new riddle is written on your map. Swim through the stone arch to go on.', 6)
      }
    }
  }

  protected refreshMap(): void {
    const party = this.game.party
    const ink = party.character === 'navigator' ? this.levelInk() : []
    this.map.setState(
      { pieces: party.mapPieces, riddle: this.progress.solved ? this.level.reward.nextRiddle : this.level.riddle },
      [...this.progress.unlockedHints, ...ink],
    )
  }

  private finishLevel(): void {
    this.complete = true
    const { game } = this
    const next = this.nextStage()
    // After Level 4 comes the vault (the finale saves nothing further).
    const nextId = this.level.id === 'level4' ? 'vault' : `level${Number(this.level.id.replace('level', '')) + 1}`
    game.party.checkpoint = nextId
    saveCheckpoint(game.party, game.record)
    const coins = this.collectibles.filter((c) => c.kind === 'coin' && !c.item.enabled).length
    const gems = this.collectibles.filter((c) => c.kind === 'gem' && !c.item.enabled).length
    const minutes = Math.floor(this.time / 60)
    const seconds = Math.floor(this.time % 60).toString().padStart(2, '0')
    game.hud.now(`${this.level.name} complete! Coins ${coins}/${this.level.collectibles.coins} · Gems ${gems}/${this.level.collectibles.gems} · Score ${game.party.score} · ${minutes}:${seconds}`, 8)
    if (next) game.goTo(next)
    else game.hud.say('Checkpoint saved. The next level arrives in a coming update.', 8)
  }

  // ---- Crew play ---------------------------------------------------------------------------------

  /** Tell the crew a puzzle piece moved (a shell turned), so it moves on every screen. */
  protected shareProp(key: string, v: number[]): void {
    this.game.net?.send('prop', { key: `${this.level.id}/${key}`, v })
  }

  /** A crewmate moved a puzzle piece (or we joined and are catching up). */
  protected onProp(_key: string, _v: number[]): void {}

  private connectNet(): void {
    const net = this.game.net
    if (!net) return
    const on = <T,>(type: string, cb: (msg: T) => void) => this.unsubscribe.push(net.on<T>(type, cb))
    on<{ level?: string; step: string; by: string }>('step', (msg) => {
      if (msg.level && msg.level !== this.level.id) return
      this.applyStep(msg.step, msg.by)
    })
    on<{ kind: SpellShape; at?: number[]; dir?: number[]; by: string }>('spell', (msg) => {
      if (!msg.at || !msg.dir) return
      this.magic.castRemote(msg.kind, new THREE.Vector3().fromArray(msg.at), new THREE.Vector3().fromArray(msg.dir), () => this.game.remote?.head(msg.by)?.getWorldPosition(new THREE.Vector3()) ?? null)
    })
    on<{ id: string; by: string }>('collected', (msg) => {
      const c = this.collectibles.find((x) => x.id === msg.id)
      if (!c) return
      c.item.enabled = false
      c.item.object.visible = false
      if (msg.by === net.sessionId) this.gain(c.kind, c.item)
    })
    // Puzzle pieces a crewmate moved; then ask where everything already is.
    const propPrefix = `${this.level.id}/`
    on<{ key: string; v: number[] }>('prop', (msg) => {
      if (msg.key.startsWith(propPrefix)) this.onProp(msg.key.slice(propPrefix.length), msg.v)
    })
    net.send('props', { prefix: propPrefix })
    // Catch up on everything the crew already did here before we arrived.
    this.catchingUp = true
    const prefix = `${this.level.id}:`
    for (const entry of net.state?.steps ?? []) if (entry.startsWith(prefix)) this.applyStep(entry.slice(prefix.length))
    this.catchingUp = false
    for (const id of net.state?.collected ?? []) {
      const c = this.collectibles.find((x) => x.id === id)
      if (c) {
        c.item.enabled = false
        c.item.object.visible = false
      }
    }
  }

  protected crewName(sessionId: string): string | null {
    return this.game.net?.roster().find((p) => p.sessionId === sessionId)?.name ?? null
  }

  /** Every diver's head in this level: yours and your crewmates'. */
  protected humanHeads(): THREE.Vector3[] {
    const heads = [this.game.camera.getWorldPosition(new THREE.Vector3())]
    const net = this.game.net
    if (net) for (const p of net.roster()) if (p.sessionId !== net.sessionId && p.connected) {
      const h = this.game.remote?.head(p.sessionId)
      if (h) heads.push(h.getWorldPosition(new THREE.Vector3()))
    }
    return heads
  }

  // ---- Bots ---------------------------------------------------------------------------------------

  /** What the crew's bots need to know about this level. */
  bots(): BotWorld | null {
    if (!this.env) return null
    this.botWorld ??= {
      env: this.env,
      spawn: (slot) => {
        const head = this.game.camera.getWorldPosition(new THREE.Vector3())
        const a = slot * 2.1
        return head.add(new THREE.Vector3(Math.cos(a) * 2.5, -0.3, Math.sin(a) * 2.5))
      },
      task: () => this.botTask(),
      collectibles: () =>
        // Runes are mana for the humans' spells: bots leave them be.
        this.collectibles
          .filter((c) => c.kind !== 'rune' && c.item.enabled && c.item.object.visible)
          .map((c) => ({ id: c.id, position: c.item.object.getWorldPosition(new THREE.Vector3()), take: (botId: string) => this.botCollect(c, botId) }))
          .filter((c) => this.botCanReach(c.position)),
      route: (from, to) => this.route(from, to),
      refill: this.setup.botRefill,
      bubbles: this.bubbles,
    }
    return this.botWorld
  }

  private botCollect(c: Collectible, botId: string): void {
    if (!c.item.enabled) return
    c.item.enabled = false
    c.item.object.visible = false
    const points = SCORE[c.kind] ?? 0
    // Bots add to the team score; their finds don't go into your backpack.
    if (this.game.net) this.game.net.send('collect', { id: c.id, points, as: botId })
    else this.game.party.score += points
  }

  // ---- Collectibles -----------------------------------------------------------------------------

  protected makeLoose(object: THREE.Object3D, kind: ItemKind, settle: 'water' | 'home' = 'water'): LooseItem {
    const item = new LooseItem(object, {
      radius: kind === 'key' ? 0.1 : 0.08,
      settle,
      floor: this.setup.floorHeight,
      rocks: this.rocks,
      onRelease: (hand, it) => this.backpack.tryStore(it, hand),
    })
    this.backpack.track(item, kind)
    return item
  }

  /** Place a new coin, gem or rune at (x, y, z) under `parent`. */
  protected place(parent: THREE.Object3D, kind: ItemKind, x: number, y: number, z: number): void {
    const object = makeItem(kind)
    object.position.set(x, y, z)
    parent.add(object)
    this.addCollectible(object, kind)
  }

  /** Place a coin, gem or rune on the seabed at (x, z). */
  protected placeOnSand(kind: ItemKind, x: number, z: number): void {
    this.place(this.root, kind, x, this.setup.floorHeight(x, z) + (kind === 'rune' ? 0.15 : 0.12), z)
  }

  protected addCollectible(object: THREE.Object3D, kind: ItemKind): void {
    // Level 1 keeps its original ids ("coin-3"); later levels prefix theirs so they never clash.
    const prefix = this.level.id === 'level1' ? '' : `${this.level.id}/`
    const id = `${prefix}${kind}-${this.collectibles.filter((c) => c.kind === kind).length}`
    const item = new LooseItem(object, {
      radius: 0.08,
      settle: 'home',
      onGrab: (hand) => {
        this.collect(item, kind, hand)
        return true
      },
    })
    this.collectibles.push({ item, kind, id })
    this.grab.add(item)
  }

  collect(item: LooseItem, kind: ItemKind, hand: Hand | null): void {
    const { game } = this
    if (!item.enabled) return
    if (game.party.inventory.full && !game.party.inventory.has(kind)) {
      game.hud.now('Your backpack is full.', 2)
      return
    }
    hand?.pulse(0.3, 30)
    if (game.net) {
      // The server decides who got it first; it's hidden now so nobody grabs it twice.
      const c = this.collectibles.find((x) => x.item === item)!
      item.enabled = false
      item.object.visible = false
      game.net.send('collect', { id: c.id, points: SCORE[kind] ?? 0 })
      return
    }
    item.enabled = false
    item.object.visible = false
    game.party.score += SCORE[kind] ?? 0
    this.gain(kind, item)
  }

  /** This player picked it up: into the backpack. */
  private gain(kind: ItemKind, _item: LooseItem): void {
    const { game } = this
    game.party.inventory.add(kind)
    this.backpack.refresh()
    if (kind === 'coin') this.teach('coin', 'Coins and gems go straight into your backpack. Press A or X to look inside.')
    if (kind === 'gem') game.hud.now('A secret gem! +50', 3)
    if (kind === 'rune') {
      this.teach('rune', 'A tide rune! Runes power magic. Press Y, then hold the trigger, draw a circle, triangle or zigzag in the air, and let go.', 7)
      if (this.taught.has('rune2')) game.hud.now(`Rune charges: ${Math.min(3, game.party.inventory.count('rune'))}/3`, 2)
      this.taught.add('rune2')
    }
  }

  private updateCollectibles(dt: number): void {
    const head = this.game.camera.getWorldPosition(this.head)
    for (const { item, kind } of this.collectibles) {
      if (!item.enabled || !item.object.visible) continue
      item.object.rotation.y += dt * 1.5
      if (item.object.getWorldPosition(this.v).distanceTo(head) < COLLECT_RADIUS) this.collect(item, kind, null)
    }
  }

  protected teach(key: string, text: string, seconds = 5): void {
    if (this.taught.has(key)) return
    this.taught.add(key)
    this.game.hud.say(text, seconds)
  }
}
