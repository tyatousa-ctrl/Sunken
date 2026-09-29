import type { ButtonGuide } from '../ui/ControllerGuide'
import * as THREE from 'three'
import { disposeTree, type GameContext, type Stage } from '../core/Stage'
import type { Hand } from '../input/Hand'
import { GrabSystem } from '../interaction/GrabSystem'
import { LooseItem } from '../interaction/LooseItem'
import { CABIN, CaptainsCabin, TooHeavy } from '../level1/CaptainsCabin'
import { ExitGate } from '../level1/ExitGate'
import type { BoxCollider, SwimEnvironment } from '../movement/environment'
import levelData from '../data/levels/level1.json'
import { LevelProgress, type LevelData, type ProgressEvent } from '../systems/LevelProgress'
import { SCORE, type ItemKind } from '../systems/Inventory'
import { makeItem } from '../systems/items'
import { saveCheckpoint } from '../systems/save'
import { SKILLS, SkillCooldown } from '../systems/skills'
import { CLASS_NAMES } from '../systems/crew'
import type { SpellShape } from '../systems/gesture'
import { Magic } from '../magic/Magic'
import { FishSchool, NavigatorTrail } from '../skills/effects'
import { Particles } from '../fx/Particles'
import { TUNING } from '../movement/tuning'
import type { BotWorld } from '../bots/world'
import { Backpack } from '../ui/Backpack'
import { MapView } from '../ui/MapView'
import { Bubbles } from '../world/Bubbles'
import { SANDBOX_RADIUS, SeabedScene, SURFACE_Y, VENT_POSITION, VENT_RADIUS, sandHeight, type RockCollider } from '../world/SeabedScene'
import { CABIN_FRONT_Z, CABIN_INTERIOR, DECK_Y, Galleon, wreckColliders } from '../world/ship/Galleon'

const LEVEL = levelData as LevelData
const WRECK_REST = new THREE.Vector3(7, 1.2, -13)
const WRECK_YAW = 0.5
const WRECK_ROLL = 0.22
const WRECK_PITCH = -0.06
const WRECK_START_Y = SURFACE_Y - 1.5
const SINK_SECONDS = 22
const GATE_POSITION = new THREE.Vector3(-20, 0, -24)
/** Swimming this close to a coin or gem picks it up. */
const COLLECT_RADIUS = 0.45
const HEAVE_REACH = 0.9

/** Coins and gems: 9 on and in the wreck (plus 3 in the chest), 8 on the seabed, 3 hidden gems. */
const WRECK_COINS: [number, number, number][] = [
  [0, DECK_Y + 0.1, -11], [1.5, DECK_Y + 0.1, -7], [-1.2, DECK_Y + 0.1, -3], [0.8, DECK_Y + 0.1, 2],
  [-2, DECK_Y + 0.1, 5], [2.4, DECK_Y + 0.1, 7.5],
  [0.9, DECK_Y + 0.95, 11.6], [-2.4, DECK_Y + 0.7, 12.4], [1.2, DECK_Y + 0.1, 10.3],
]
const SEABED_COINS: [number, number][] = [[2, -4], [-3, -8], [-8, -14], [-12, -18], [-16, -21], [10, -2], [14, -9], [3, -20]]
const WRECK_GEMS: [number, number, number][] = [
  // In the main mast's crow's nest.
  [0, DECK_Y + 16 * 0.65 + 0.3, 0],
  // Tucked in the cabin corner, at the figurehead's feet.
  [-3.1, DECK_Y + 0.1, 10.1],
]
const SEABED_GEMS: [number, number][] = [[-26, 8]]
/** Tide runes: mana for spells (one on deck, two on the seabed). */
const WRECK_RUNES: [number, number, number][] = [[1.2, DECK_Y + 0.12, -1]]
const SEABED_RUNES: [number, number][] = [[6, -3.5], [-8, 4]]
const SKILL_TAGS: Record<string, string> = { navigator: 'NAVI', strongman: 'STRONG', deepDiver: 'DIVER', fishWhisperer: 'FISH' }
const FISH_RANGE = 12
const SHARE_RANGE = 2.5

// Level 1, The Sinking Galleon (the tutorial level). The galleon settles on the seabed; the map's
// first riddle leads into the captain's cabin, where the Strongman heaves the stone figurehead aside,
// the key underneath opens the captain's chest, and map piece II opens the way on.
export class Level1Stage implements Stage {
  readonly id = 'level1'
  readonly root = new THREE.Group()
  readonly progress = new LevelProgress(LEVEL)
  private readonly bubbles = new Bubbles(SURFACE_Y)
  private readonly rocks: RockCollider[] = []
  private readonly boxes: BoxCollider[] = []
  private readonly wreck = new Galleon({ hollowCabin: true })
  private skill!: SkillCooldown
  private env!: SwimEnvironment
  private magic!: Magic
  private trail!: NavigatorTrail
  private fish!: FishSchool
  private botWorld: BotWorld | null = null
  private readonly glow = new Particles({ max: 500, gravity: 0, drag: 0.5, blending: THREE.AdditiveBlending })
  private readonly collectibles: { item: LooseItem; kind: ItemKind; id: string }[] = []
  private readonly unsubscribe: (() => void)[] = []
  /** Applying steps that already happened before we joined: no announcements. */
  private catchingUp = false
  private world!: SeabedScene
  private grab!: GrabSystem
  private cabin!: CaptainsCabin
  private gate!: ExitGate
  private backpack!: Backpack
  private map!: MapView
  private keyItem!: LooseItem
  private sinkTime = 0
  private settled = false
  private time = 0
  private complete = false
  private lockNagCooldown = 0
  private readonly taught = new Set<string>()
  private readonly v = new THREE.Vector3()
  private readonly head = new THREE.Vector3()

  constructor(
    private readonly game: GameContext,
    private readonly arrivedFromShip: boolean,
  ) {}

  enter(): void {
    const { game } = this
    game.scene.add(this.root)
    this.root.add(this.bubbles.points)
    this.world = new SeabedScene(game.scene, this.root, this.bubbles)
    this.rocks.push(...this.world.rocks)
    this.root.add(this.glow.points)
    const cls = game.party.character
    this.skill = new SkillCooldown(SKILLS[cls].cooldown)
    game.player.setAirCapacity(cls === 'deepDiver' ? TUNING.airCapacity * 2 : TUNING.airCapacity)
    this.trail = new NavigatorTrail(this.glow)
    this.fish = new FishSchool(this.root)

    // The wreck: foremast shot away in the attack, everything static merged, cabin contents on top.
    this.wreck.foremast.rotation.z = 1.35
    this.wreck.foremast.position.y = DECK_Y - 0.8
    this.wreck.mergeAll()
    this.wreck.group.position.set(WRECK_REST.x, this.arrivedFromShip ? WRECK_START_Y : WRECK_REST.y, WRECK_REST.z)
    this.wreck.group.rotation.set(this.arrivedFromShip ? 0 : WRECK_PITCH, WRECK_YAW, this.arrivedFromShip ? 0.05 : WRECK_ROLL)
    this.root.add(this.wreck.group)
    this.clearRocksUnderWreck()
    this.cabin = new CaptainsCabin(this.wreck.shake, game.audio)

    this.grab = new GrabSystem({ rocks: this.rocks, floor: sandHeight })
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
    this.refreshMap()
    this.buildPuzzle()
    this.placeCollectibles()

    this.gate = new ExitGate(GATE_POSITION, Math.atan2(-GATE_POSITION.x, -GATE_POSITION.z), game.audio)
    this.root.add(this.gate.group)
    this.boxes.push(this.gate.collider)

    const env: SwimEnvironment = (this.env = {
      kind: 'swim',
      floorHeight: sandHeight,
      surfaceY: SURFACE_Y,
      rocks: this.rocks,
      boxes: this.boxes,
      radius: SANDBOX_RADIUS,
      refillZones: [{ center: VENT_POSITION, radius: VENT_RADIUS }],
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

    if (this.arrivedFromShip) {
      game.player.enter(env, new THREE.Vector3(0, SURFACE_Y - 3.2, 3), 0.35, this.bubbles)
      game.hud.say('Splash! The galleon is going down past you...', 5)
      game.hud.say('Swim clear and watch her settle on the seabed.', 5)
      game.camera.getWorldPosition(this.v)
      this.bubbles.emit(this.v, new THREE.Vector3(0, 1, 0), 160, 1.4, 2.5)
    } else {
      game.player.enter(env, new THREE.Vector3(0, 0.8, 2), 0.35, this.bubbles)
      this.onSettled()
    }
    game.player.checkpoint.copy(new THREE.Vector3(0, 0.8, 2))
    game.hud.say(
      game.inXr
        ? 'Your backpack: press A or X (or reach over your shoulder and grip) to open it. Look at a controller to see what its buttons do.'
        : 'Your backpack: press R to open it. The keys are listed in the corner.',
      7,
    )
    this.connectNet()
  }

  guide(): ButtonGuide {
    return {
      left: ['Grip + pull: swim', 'Trigger: bubble jet', 'X: backpack', 'Y: magic', 'Stick: drift · click: map'],
      right: ['Grip + pull: swim', 'Trigger: bubble jet', 'A: backpack', 'B: class skill', 'Stick: turn · rise / sink'],
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
    this.lockNagCooldown = Math.max(0, this.lockNagCooldown - dt)

    game.player.update(dt, game.inXr, game.desktop)
    this.handleButtons()
    this.backpack.tick(game.hands)
    this.grab.update(dt, game.hands, game.player.physics.velocity, game.rig)
    this.map.update(game.hands)
    this.world.update(dt, elapsed)
    this.cabin.update(dt)
    this.gate.update(dt)
    this.updateWreck(dt)
    this.bubbles.update(dt)
    this.updateCollectibles(dt)
    this.updatePuzzle(dt)
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
      // A/X: backpack. Reaching over the shoulder and gripping (empty-handed) also opens it.
      if (hand.primaryPressed) this.openBackpack(hand)
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

  /** B: whatever your class does. */
  private useSkill(hand: Hand): void {
    const { game } = this
    switch (game.party.character) {
      case 'strongman':
        return this.heave(hand)
      case 'navigator': {
        if (!this.skill.trigger()) return this.spent()
        this.trail.show(this.route(game.camera.getWorldPosition(new THREE.Vector3()), this.objective()))
        this.refreshMap()
        game.hud.now('Hidden ink glows on your map, and a trail lights the way to the next clue.', 4)
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

  private spent(): void {
    this.game.hud.now(`${SKILLS[this.game.party.character].name} skill recovering: ${Math.ceil(this.skill.remaining)} s.`, 2)
  }

  private updateMagicAndSkills(dt: number): void {
    const { game } = this
    this.magic.update(dt, game.hands)
    const head = game.camera.getWorldPosition(new THREE.Vector3())
    // Currents carry the diver along.
    game.player.physics.velocity.addScaledVector(this.magic.flowAt(head, game.player.physics.velocity), dt)
    this.trail.update(dt, head, () => this.route(head, this.objective()))
    this.fish.update(dt, head)
  }

  private openBackpack(hand: Hand): void {
    this.backpack.toggle(hand)
    if (this.backpack.isOpen) this.teach('backpack', 'To stow something, let go of it over the open backpack, or over your shoulder. Grip a slot to take it out.')
  }

  private toggleMap(hand: Hand): void {
    this.map.toggle(hand)
    if (this.map.isOpen && !this.taught.has('map')) {
      this.teach('map', `The riddle, in the captain's hand: "${LEVEL.riddle}"`, 8)
      this.game.hud.say('Turn the map over for notes. Grip it with your other hand and pull to zoom.', 5)
    }
  }

  private heave(hand: Hand): void {
    const { game } = this
    const target = this.cabin.figurehead.getWorldPosition(this.v)
    const near = hand.worldPos(new THREE.Vector3()).distanceTo(target) < HEAVE_REACH || game.camera.getWorldPosition(this.head).distanceTo(target) < 1.5
    if (!near || this.cabin.lifted) {
      game.hud.now('Nothing heavy to lift here.', 2)
      return
    }
    if (!this.skill.trigger()) {
      game.hud.now(`Your strength is spent. Ready again in ${Math.ceil(this.skill.remaining)} s.`, 3)
      return
    }
    for (const h of game.hands) h.pulse(1, 300)
    this.step('enterCabin')
    this.step('liftFigurehead')
    game.hud.now('You heave the stone maiden aside... something glints where she lay.', 4)
  }

  // ---- Puzzle -----------------------------------------------------------------------------------

  private buildPuzzle(): void {
    const { game } = this
    const heavy = this.grab.add(new TooHeavy(this.cabin.figurehead, 0.45, () => !this.cabin.lifted))
    heavy.onTry = () =>
      game.hud.now(
        game.party.character !== 'strongman'
          ? "She won't budge. Only the Strongman can lift her: point at the Strongman bot and pull the trigger to call it."
          : this.skill.ready
            ? "She won't budge. You're the Strongman: press B beside her to heave her aside."
            : "She won't budge. Too heavy to lift by hand.",
        4,
      )

    this.keyItem = this.makeLoose(this.cabin.key, 'key', 'home')
    this.keyItem.options.onGrab = () => {
      if (this.step('takeKey')) this.teach('key', 'The key! Keep hold of it, or stow it in your backpack by letting go over your shoulder.')
      return false
    }
    this.grab.add(this.keyItem)

    const piece = new LooseItem(this.cabin.mapPiece, {
      radius: 0.12,
      settle: 'home',
      onGrab: (hand) => {
        hand.pulse(0.8, 150)
        this.game.audio.play('pop')
        this.step('takeMapPiece')
        return true
      },
    })
    this.grab.add(piece)
    for (const coin of this.cabin.chestCoins) this.addCollectible(coin, 'coin')
  }

  private updatePuzzle(dt: number): void {
    const { game } = this
    const head = game.camera.getWorldPosition(this.head)

    // Found where the captain slept.
    if (!this.progress.done.has('enterCabin')) {
      const local = this.wreck.group.worldToLocal(this.v.copy(head)).sub(CABIN_INTERIOR.center)
      const h = CABIN_INTERIOR.half
      if (Math.abs(local.x) < h.x && Math.abs(local.y) < h.y && Math.abs(local.z) < h.z) {
        this.step('enterCabin')
        game.hud.now('The captain\'s cabin. His bunk is still here...', 4)
      }
    }

    // The chest lock: the key in hand, or an empty hand with the key in the backpack.
    if (this.cabin.lifted && !this.cabin.unlocked) {
      const lock = this.cabin.lock.getWorldPosition(this.v)
      for (const hand of game.hands) {
        if (!hand.connected) continue
        const d = hand.worldPos(new THREE.Vector3()).distanceTo(lock)
        if (hand.held === this.keyItem && d < 0.18) {
          this.grab.drop(hand)
          this.keyItem.enabled = false
          this.keyItem.object.visible = false
          this.unlockChest(hand)
        } else if (!hand.held && d < 0.14) {
          if (this.backpack.consume('key')) {
            game.hud.now('You take the key from your backpack.', 2.5)
            this.unlockChest(hand)
          } else if (this.lockNagCooldown === 0) {
            this.lockNagCooldown = 4
            game.hud.now('Locked tight. It needs a key.', 2.5)
          }
        }
      }
    }

    const event = this.progress.update(dt)
    if (event) this.onProgress([event])
    this.map.setCompass(this.progress.compassVisible, this.objective())

    if (this.progress.solved && !this.complete && this.gate.passedThrough(head)) this.finishLevel()
  }

  private unlockChest(hand: Hand): void {
    hand.pulse(0.6, 80)
    this.step('openChest')
    this.game.hud.now('The lock gives with a clunk. The lid creaks open.', 3)
  }

  /**
   * Ask for a riddle step. Solo, it happens at once; in a crew the server checks the order and
   * everyone applies it together. Returns whether it counted locally (always false in a crew).
   */
  private step(id: string): boolean {
    if (this.game.net) {
      if (this.progress.nextStep?.id === id) this.game.net.send('act', { level: LEVEL.id, step: id })
      return false
    }
    return this.applyStep(id)
  }

  /** A step happened (here, or anywhere in the crew): update the world. */
  private applyStep(id: string, by?: string): boolean {
    const events = this.progress.complete(id)
    if (events.length === 0) return false
    const who = by && this.game.net && by !== this.game.net.sessionId ? this.game.net.roster().find((p) => p.sessionId === by)?.name : null
    if (id === 'liftFigurehead') {
      this.cabin.lift()
      if (who && !this.catchingUp) this.game.hud.now(`${who} heaved the figurehead aside!`, 3)
    }
    if (id === 'takeKey' && by && this.game.net && by !== this.game.net.sessionId) {
      // Someone else has the key now; ours disappears so there's only ever one.
      this.cabin.keyTaken = true
      if (this.keyItem.heldBy) this.grab.drop(this.keyItem.heldBy)
      this.keyItem.goHome()
      this.keyItem.enabled = false
      this.keyItem.object.visible = false
      if (who && !this.catchingUp) this.game.hud.now(`${who} took the key.`, 3)
    }
    if (id === 'openChest') {
      this.cabin.unlock()
      if (who && !this.catchingUp) this.game.hud.now(`${who} opened the captain's chest.`, 3)
    }
    if (id === 'takeMapPiece') {
      this.cabin.mapPiece.visible = false
      if (!this.game.party.mapPieces.includes(LEVEL.reward.mapPiece)) this.game.party.mapPieces.push(LEVEL.reward.mapPiece)
    }
    if (!this.catchingUp) this.onProgress(events)
    else if (this.progress.solved) this.onSolvedQuietly()
    return true
  }

  private onSolvedQuietly(): void {
    this.gate.open()
    const i = this.boxes.indexOf(this.gate.collider)
    if (i >= 0) this.boxes.splice(i, 1)
    this.refreshMap()
  }

  // ---- Crew play ---------------------------------------------------------------------------------

  private connectNet(): void {
    const net = this.game.net
    if (!net) return
    const on = <T,>(type: string, cb: (msg: T) => void) => this.unsubscribe.push(net.on<T>(type, cb))
    on<{ step: string; by: string }>('step', (msg) => {
      const wasKey = this.progress.nextStep?.id === 'takeKey' && msg.step === 'takeKey'
      if (this.applyStep(msg.step, msg.by) && wasKey && msg.by === net.sessionId) {
        this.teach('key', 'The key! Keep hold of it, or stow it in your backpack by letting go over your shoulder.')
      }
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
    // Catch up on everything the crew already did before we arrived.
    this.catchingUp = true
    for (const step of net.state?.steps ?? []) this.applyStep(step)
    this.catchingUp = false
    for (const id of net.state?.collected ?? []) {
      const c = this.collectibles.find((x) => x.id === id)
      if (c) {
        c.item.enabled = false
        c.item.object.visible = false
      }
    }
  }

  private onProgress(events: ProgressEvent[]): void {
    const { game } = this
    for (const e of events) {
      if (e.type === 'hint') {
        game.hud.say(`A note appears on the back of your map: ${e.text}`, 7)
        this.refreshMap()
      } else if (e.type === 'solved') {
        this.gate.open()
        this.boxes.splice(this.boxes.indexOf(this.gate.collider), 1)
        this.refreshMap()
        game.party.checkpoint = 'level1-solved'
        game.player.checkpoint.copy(this.gate.group.localToWorld(new THREE.Vector3(0, 2, 3)))
        game.hud.now(LEVEL.reward.message, 5)
        game.hud.say('A new riddle is written on your map. Swim through the stone arch in the reef to go on.', 6)
      }
    }
  }

  /** Where the compass points: whatever the next step needs. */
  private objective(): THREE.Vector3 {
    switch (this.progress.nextStep?.id) {
      case 'enterCabin':
        return this.wreck.group.localToWorld(new THREE.Vector3(0, DECK_Y + 1, CABIN_FRONT_Z - 1))
      case 'liftFigurehead':
        return this.wreck.group.localToWorld(CABIN.figurehead.clone())
      case 'takeKey':
        return this.cabin.key.getWorldPosition(new THREE.Vector3())
      case 'openChest':
        return this.cabin.lock.getWorldPosition(new THREE.Vector3())
      case 'takeMapPiece':
        return this.cabin.mapPiece.getWorldPosition(new THREE.Vector3())
      default:
        return this.gate.center
    }
  }

  private refreshMap(): void {
    const party = this.game.party
    // The Navigator reads hidden ink: where this level's secret gems are.
    const ink = party.character === 'navigator' ? ['Hidden ink: gems glint in the crow\'s nest, in the cabin corner by the door, and far out to the west.'] : []
    this.map.setState(
      { pieces: party.mapPieces, riddle: this.progress.solved ? LEVEL.reward.nextRiddle : LEVEL.riddle },
      [...this.progress.unlockedHints, ...ink],
    )
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
          .map((c) => ({ id: c.id, position: c.item.object.getWorldPosition(new THREE.Vector3()), take: (botId: string) => this.botCollect(c, botId) })),
      route: (from, to) => this.route(from, to),
      refill: VENT_POSITION.clone().setY(sandHeight(VENT_POSITION.x, VENT_POSITION.z)),
      bubbles: this.bubbles,
    }
    return this.botWorld
  }

  /** The Strongman bot heaves the figurehead, once a human has found the cabin. */
  private botTask() {
    if (!this.settled || this.cabin.lifted || this.progress.nextStep?.id !== 'liftFigurehead') return null
    return {
      position: this.wreck.group.localToWorld(CABIN.figurehead.clone().add(new THREE.Vector3(0.9, 0.7, -0.1))),
      skill: 'strongman' as const,
      ready: this.humanInCabin(),
      act: (name: string) => {
        this.step('liftFigurehead')
        this.game.hud.now(`${name} heaves the stone maiden aside!`, 4)
      },
    }
  }

  private humanInCabin(): boolean {
    const heads = [this.game.camera.getWorldPosition(new THREE.Vector3())]
    const net = this.game.net
    if (net) for (const p of net.roster()) if (p.sessionId !== net.sessionId && p.connected) {
      const h = this.game.remote?.head(p.sessionId)
      if (h) heads.push(h.getWorldPosition(new THREE.Vector3()))
    }
    return heads.some((h) => this.inCabin(h))
  }

  private inCabin(p: THREE.Vector3): boolean {
    const local = this.wreck.group.worldToLocal(p.clone()).sub(CABIN_INTERIOR.center)
    const h = CABIN_INTERIOR.half
    return Math.abs(local.x) < h.x && Math.abs(local.y) < h.y && Math.abs(local.z) < h.z
  }

  /** Waypoints that go through the cabin doorway rather than its walls. */
  private route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    if (!this.settled) return [to]
    const g = this.wreck.group
    const outside = g.localToWorld(new THREE.Vector3(0, DECK_Y + 1.0, CABIN_FRONT_Z - 1.4))
    const inside = g.localToWorld(new THREE.Vector3(0, DECK_Y + 1.0, CABIN_FRONT_Z + 0.9))
    const aboveDeck = g.localToWorld(new THREE.Vector3(0, DECK_Y + 2.2, CABIN_FRONT_Z - 3.5))
    const toIn = this.inCabin(to)
    const fromIn = this.inCabin(from)
    if (toIn && !fromIn) return [aboveDeck, outside, inside, to]
    if (fromIn && !toIn) return [inside, outside, to]
    return [to]
  }

  private botCollect(c: { item: LooseItem; kind: ItemKind; id: string }, botId: string): void {
    if (!c.item.enabled) return
    c.item.enabled = false
    c.item.object.visible = false
    const points = SCORE[c.kind] ?? 0
    // Bots add to the team score; their finds don't go into your backpack.
    if (this.game.net) this.game.net.send('collect', { id: c.id, points, as: botId })
    else this.game.party.score += points
  }

  private finishLevel(): void {
    this.complete = true
    const { game } = this
    game.party.checkpoint = 'level2'
    saveCheckpoint(game.party, game.record)
    const coins = this.collectibles.filter((c) => c.kind === 'coin' && !c.item.enabled).length
    const gems = this.collectibles.filter((c) => c.kind === 'gem' && !c.item.enabled).length
    const minutes = Math.floor(this.time / 60)
    const seconds = Math.floor(this.time % 60).toString().padStart(2, '0')
    game.hud.now(`Level 1 complete! Coins ${coins}/${LEVEL.collectibles.coins} · Gems ${gems}/${LEVEL.collectibles.gems} · Score ${game.party.score} · ${minutes}:${seconds}`, 8)
    game.hud.say('Checkpoint saved. Level 2, the Seagrass Meadows, arrives in the next milestone.', 8)
  }

  // ---- Collectibles -----------------------------------------------------------------------------

  private makeLoose(object: THREE.Object3D, kind: ItemKind, settle: 'water' | 'home' = 'water'): LooseItem {
    const item = new LooseItem(object, {
      radius: kind === 'key' ? 0.1 : 0.08,
      settle,
      floor: sandHeight,
      rocks: this.rocks,
      onRelease: (hand, it) => this.backpack.tryStore(it, hand),
    })
    this.backpack.track(item, kind)
    return item
  }

  private placeCollectibles(): void {
    for (const [x, y, z] of WRECK_COINS) this.addCollectible(this.at(this.wreck.shake, makeItem('coin'), x, y, z), 'coin')
    for (const [x, z] of SEABED_COINS) this.addCollectible(this.at(this.root, makeItem('coin'), x, sandHeight(x, z) + 0.12, z), 'coin')
    for (const [x, y, z] of WRECK_GEMS) this.addCollectible(this.at(this.wreck.shake, makeItem('gem'), x, y, z), 'gem')
    for (const [x, z] of SEABED_GEMS) this.addCollectible(this.at(this.root, makeItem('gem'), x, sandHeight(x, z) + 0.12, z), 'gem')
    for (const [x, y, z] of WRECK_RUNES) this.addCollectible(this.at(this.wreck.shake, makeItem('rune'), x, y, z), 'rune')
    for (const [x, z] of SEABED_RUNES) this.addCollectible(this.at(this.root, makeItem('rune'), x, sandHeight(x, z) + 0.15, z), 'rune')
  }

  private at(parent: THREE.Object3D, object: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
    object.position.set(x, y, z)
    parent.add(object)
    return object
  }

  private addCollectible(object: THREE.Object3D, kind: ItemKind): void {
    const id = `${kind}-${this.collectibles.filter((c) => c.kind === kind).length}`
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

  private collect(item: LooseItem, kind: ItemKind, hand: Hand | null): void {
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
  private gain(kind: ItemKind, item: LooseItem): void {
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

  // ---- Wreck ------------------------------------------------------------------------------------

  private updateWreck(dt: number): void {
    if (this.settled) return
    this.sinkTime = Math.min(SINK_SECONDS, this.sinkTime + dt)
    const t = this.sinkTime / SINK_SECONDS
    // Sinks fast at first, then slows as it nears the bottom, rolling onto its side a little.
    const ease = 1 - Math.pow(1 - t, 2.2)
    const g = this.wreck.group
    g.position.y = THREE.MathUtils.lerp(WRECK_START_Y, WRECK_REST.y, ease)
    g.rotation.z = THREE.MathUtils.lerp(0.05, WRECK_ROLL, ease)
    g.rotation.x = THREE.MathUtils.lerp(0, WRECK_PITCH, ease)
    if (Math.random() < dt * 30) {
      this.v.set((Math.random() - 0.5) * 5, 2.5, (Math.random() - 0.5) * 20)
      g.localToWorld(this.v)
      this.bubbles.emit(this.v, new THREE.Vector3(0, 1, 0), 8, 1.2, 0.8)
    }
    if (this.sinkTime >= SINK_SECONDS) {
      this.game.hud.say('The galleon has settled on the seabed.', 4)
      this.onSettled()
    }
  }

  /** The wreck is at rest: its hull and cabin walls become solid, and the riddle begins. */
  private onSettled(): void {
    this.settled = true
    const g = this.wreck.group
    g.updateMatrixWorld(true)
    for (const box of wreckColliders()) {
      const matrix = new THREE.Matrix4().makeTranslation(box.center.x, box.center.y, box.center.z).premultiply(g.matrixWorld)
      this.boxes.push({ matrix, inverse: matrix.clone().invert(), half: box.half.clone() })
    }
    for (let y = 1; y <= 14; y += 1.5) this.rocks.push({ center: g.localToWorld(new THREE.Vector3(0, DECK_Y + y, 0)), radius: 0.3 })
    this.game.hud.say('Your first riddle is on the treasure map. Click the left thumbstick (M on desktop) to read it.', 6)
    this.game.hud.say('Swim: hold grip and pull. Bubble jets: trigger. Your left wrist shows air, depth, skill and score.', 6)
  }

  private clearRocksUnderWreck(): void {
    const rest = new THREE.Object3D()
    rest.position.copy(WRECK_REST)
    rest.rotation.set(WRECK_PITCH, WRECK_YAW, WRECK_ROLL)
    rest.updateMatrixWorld(true)
    this.world.removeRocks((center, radius) => {
      const local = rest.worldToLocal(center.clone())
      return Math.abs(local.x) < 4.5 + radius && local.z > -15.5 - radius && local.z < 14 + radius
    })
    for (let i = this.rocks.length - 1; i >= 0; i--) if (this.rocks[i].radius === 0) this.rocks.splice(i, 1)
  }

  private teach(key: string, text: string, seconds = 5): void {
    if (this.taught.has(key)) return
    this.taught.add(key)
    this.game.hud.say(text, seconds)
  }
}
