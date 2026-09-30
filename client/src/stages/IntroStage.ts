import type { ButtonGuide } from '../ui/ControllerGuide'
import * as THREE from 'three'
import { HeldSync, syncAll } from '../net/HeldSync'
import type { MapArea } from '../ui/MiniMap'
import { disposeTree, type GameContext, type Stage } from '../core/Stage'
import { Particles } from '../fx/Particles'
import { GrabSystem } from '../interaction/GrabSystem'
import type { WalkEnvironment } from '../movement/environment'
import { AttackSequence } from '../intro/AttackSequence'
import { ATTACK_SECONDS, formatClock, railsOpen, secondsLeft } from '../intro/attackTimeline'
import { CLAY_Z, ClayRange } from '../intro/ClayRange'
import { Crew } from '../intro/Crew'
import { BARREL_POSITION, BeerBarrel } from '../intro/BeerBarrel'
import { BOARD_POSITION, DART_TEAMS, DartBoardArea, THROW_DISTANCE } from '../intro/DartBoard'
import type { DartsMode } from '../intro/darts/DartsGame'
import { DrunkState } from '../intro/drunk'
import { GEAR_SETS, GearRack, TABLE_POSITION, gearObstacles, type GearPiece } from '../intro/GearRack'
import { Shotgun } from '../intro/Shotgun'
import { AboveWater } from '../world/above/Coast'
import { CREW_BOARD_SPOT, CrewBoard } from '../intro/CrewBoard'
import type { BotWorld } from '../bots/world'
import type { CharacterClass } from '../systems/crew'
import { CABIN_FRONT_Z, DECK_Y, Galleon, STERN_Z } from '../world/ship/Galleon'
import { NET_OBSTACLES, Rigging, netObstacles, type RigSpec } from '../intro/Rigging'
import { DeckCannons, MATCH_CRATE } from '../intro/DeckCannons'
import { PERCH_SPOT, Quarterdeck, STAIRS } from '../intro/Quarterdeck'
import { Sailing, type SailState } from '../intro/Sailing'
import { CrackerPack, Parrot, type PollyState } from '../intro/Parrot'
import { Swords, type SwordTarget } from '../intro/Swords'
import { LooseItem } from '../interaction/LooseItem'
import { makeItem } from '../systems/items'
import { DECK_ROUTE, POLLY_ROUTE, Zipline, type ZiplineRoute } from '../intro/Zipline'
import { TitanicBow } from '../intro/TitanicBow'
import { RAT_GAME_AT, WhackARat } from '../intro/WhackARat'
import { FIRE_AT, RatRoast, SKEWERS_AT } from '../intro/RatRoast'
import { CART_AT, CannoliCart } from '../intro/CannoliCart'
import { TUG_CENTRE_Z, TUG_X, TugOfWar } from '../intro/TugOfWar'
import { Level1Stage } from './Level1Stage'
import { deckHalfWidth, DECK_BOW_Z, FOREMAST_Z, STRETCH } from '../intro/deck'

/** The "harmless merchant" anchored in the bay, ~150 m off the starboard bow. */
const ENEMY_POSITION = new THREE.Vector3(110, 0, -100)
const RAIL_MARGIN = 0.35
/** How far off the other ship lies once the fight starts (m). */
const ENEMY_BATTLE_RANGE = 50
const PULL_COOLDOWN = 2.5
/** AUTO clays: seconds between launches once the sky is clear. */
const AUTO_GAP = 2.5

type Phase = 'fakeout' | 'attack' | 'overboard'

interface Obstacle {
  x: number
  z: number
  r: number
}

/** Deck obstacles (ship-local circles): masts, table, gear rack, thrower, beer table, dart rack. */
/** The foremast's net, down its forward side (the foremast is 13 m tall). */
const FORE_RIG: RigSpec = { mastZ: FOREMAST_Z, height: 13, side: -1 }

/** The blunderbuss rack: free-standing near the bow, by the clay thrower (ship-local, deck level). */
const GUN_RACK = new THREE.Vector3(1.4, DECK_Y, CLAY_Z + 4)

const OBSTACLES: Obstacle[] = [
  { x: 0, z: 0, r: 0.45 },
  { x: 0, z: FOREMAST_Z, r: 0.45 },
  { x: TABLE_POSITION.x, z: TABLE_POSITION.z, r: 0.75 },
  ...gearObstacles(),
  // Tug-of-war: the end posts and the score board's post (the rope itself you can step over).
  { x: TUG_X + 0.9, z: TUG_CENTRE_Z - 3.1, r: 0.15 },
  { x: TUG_X + 0.9, z: TUG_CENTRE_Z + 3.1, r: 0.15 },
  { x: TUG_X + 1.9, z: TUG_CENTRE_Z, r: 0.15 },
  // The cannoli cart.
  ...[-0.45, 0, 0.45].map((dz) => ({ x: CART_AT.x, z: CART_AT.z + dz, r: 0.5 })),
  // The rat roast's fire barrel and bucket of skewers.
  { x: FIRE_AT.x, z: FIRE_AT.z, r: 0.45 },
  { x: SKEWERS_AT.x, z: SKEWERS_AT.z, r: 0.2 },
  // The Whack-a-Rat box amidships.
  ...[-0.55, 0, 0.55].map((dz) => ({ x: RAT_GAME_AT.x, z: RAT_GAME_AT.z + dz, r: 0.45 })),
  { x: deckHalfWidth(CLAY_Z) - 0.5, z: CLAY_Z, r: 0.45 },
  { x: GUN_RACK.x, z: GUN_RACK.z, r: 0.6 },
  { x: BARREL_POSITION.x, z: BARREL_POSITION.z, r: 0.6 },
  { x: -2.35, z: BOARD_POSITION.z - THROW_DISTANCE - 0.1, r: 0.15 },
  // The Blue darts' rack, the other side of the line.
  { x: 2 * BOARD_POSITION.x + 2.35, z: BOARD_POSITION.z - THROW_DISTANCE - 0.1, r: 0.15 },
  { x: CREW_BOARD_SPOT.x, z: CREW_BOARD_SPOT.z, r: 0.35 },
  { x: MATCH_CRATE.x, z: MATCH_CRATE.z, r: 0.35 },
  ...NET_OBSTACLES,
  ...netObstacles(FORE_RIG),
  // Rose, at the tip of the bow.
  { x: 0, z: DECK_BOW_Z + 0.95, r: 0.28 },
  // The high end of the stairs, from the side (you can't walk in under them).
  { x: (STAIRS.x0 + STAIRS.x1) / 2, z: STAIRS.zTop - 1.3, r: 0.4 },
  { x: (STAIRS.x0 + STAIRS.x1) / 2, z: STAIRS.zTop - 0.5, r: 0.4 },
]

// Milestone 3: golden hour on the galleon's deck. Clay shooting is the fake-out; a stray pellet into
// the ship in the bay starts the real game: she runs up a black flag and opens fire, our ship sinks,
// and the crew has to gear up and go over the side.
export class IntroStage implements Stage {
  readonly id = 'intro'
  readonly root = new THREE.Group()
  private readonly ship = new Galleon({ flag: 'crew', stretch: STRETCH })
  private readonly enemy = new Galleon({ hullColor: 0x2e2620, sailColor: 0xcfc6b2, flag: 'merchant', stretch: STRETCH })
  private readonly smoke = new Particles({ max: 500, gravity: 0.3, drag: 0.6 })
  private readonly fire = new Particles({ max: 400, gravity: 1.5, drag: 1, blending: THREE.AdditiveBlending })
  private readonly debris = new Particles({ max: 400, gravity: -9.8, drag: 0.3 })
  private readonly splash = new Particles({ max: 400, gravity: -9.8, drag: 0.4 })
  // The rigging net is a handhold: grip it to climb.
  /** Held things shown in crewmates' hands. */
  private heldSync: HeldSync | null = null
  private readonly grab = new GrabSystem({ rocks: [], climb: (p) => this.rigs?.some((r) => r.onNet(p, 0.12)) ?? false })
  /** The main mast's net and nest (aft of it); `rigs` also has the foremast's (forward of it). */
  private rigging!: Rigging
  private rigs!: Rigging[]
  private ziplines!: Zipline[]
  private cannons!: DeckCannons
  /** The prompt the rigging put up (so we only clear our own). */
  private riggingPrompt = ''
  private sawTheView = false
  private quarterdeck!: Quarterdeck
  private sailing!: Sailing
  private polly!: Parrot
  private sailTimer = 0
  private warnedShoals = false
  private readonly guns: Shotgun[] = []
  private readonly raycaster = new THREE.Raycaster()
  private above!: AboveWater
  private range!: ClayRange
  private crew!: Crew
  private swords!: Swords
  /** Whack-a-Rat, amidships, and roasting your catch over the fire barrel beside it. */
  private rats!: WhackARat
  private roast!: RatRoast
  /** Tug-of-war, amidships. */
  private tug!: TugOfWar
  /** The cannoli cart, forward of the main mast. */
  private cannoli!: CannoliCart
  /** The bow: bowsprit, and Rose to fly with. */
  private bow!: TitanicBow
  private swivelKey!: LooseItem
  /** Which hand (0 left, 1 right) each crewmate holds their sword in, by sword id. */
  private readonly swordHands = new Map<string, 0 | 1>()
  private gear!: GearRack
  private barrel!: BeerBarrel
  private crewBoard!: CrewBoard
  private walkEnv!: WalkEnvironment
  private botWorld: BotWorld | null = null
  private darts!: DartBoardArea
  private readonly drunk = new DrunkState()
  private baseFog = { near: 0, far: 0 }
  private attack: AttackSequence | null = null
  private phase: Phase = 'fakeout'
  private fakeoutTime = 0
  private pullCooldown = 0
  private leverUsed = false
  /** Seconds until the AUTO switch launches the next clays. */
  private autoTimer = 0
  private firstGunHeld = false
  private nudges = 0
  private broadsideYaw = 0
  private railsWereOpen = false
  private readonly unsubscribe: (() => void)[] = []
  private boardTimer = 0
  private readonly v = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()

  constructor(private readonly game: GameContext) {}

  enter(): void {
    const { game } = this
    game.scene.add(this.root)
    // The ship sails: the sea, the coast and the ship in the bay move around her.
    this.sailing = new Sailing(this.root, this.ship, this.splash, () => [this.enemy.group.getWorldPosition(new THREE.Vector3())])
    this.above = new AboveWater(game.scene, this.root, this.sailing.scenery)
    this.root.add(this.ship.group)

    const toUs = ENEMY_POSITION.clone().negate().setY(0).normalize()
    // Broadside = the enemy's port side (local -x) facing us.
    this.broadsideYaw = Math.atan2(toUs.z, -toUs.x)
    // Her yards braced round to the wind, so her sails show from the side (square sails edge-on
    // look like bare masts from broadside).
    this.enemy.mainmast.rotation.y = 0.75
    this.enemy.foremast.rotation.y = 0.75
    this.enemy.mergeAll()
    this.enemy.group.scale.setScalar(0.85)
    this.enemy.group.position.copy(ENEMY_POSITION)
    this.enemy.group.rotation.y = this.broadsideYaw + 1.25
    this.sailing.scenery.add(this.enemy.group)

    for (const p of [this.smoke, this.fire, this.debris, this.splash]) this.root.add(p.points)

    this.buildGunRack()
    this.range = new ClayRange(this.root, this.ship, {
      audio: game.audio,
      debris: this.debris,
      splash: this.splash,
      onThrow: (at, vel, local) => game.net?.send('throwClay', { at: at.toArray(), vel: vel.toArray(), local }),
    })
    this.grab.add(this.range.stack)
    this.grab.add(this.range.lever)
    this.grab.add(this.range.countSwitch)
    this.grab.add(this.range.autoSwitch)
    this.range.onLever = (count) => {
      if (this.phase !== 'fakeout') return
      // Someone's working the thrower: Salvo stops calling "Pull!" on his own.
      this.leverUsed = true
      this.pull(count)
    }
    this.rigging = new Rigging(this.ship)
    const foreRig = new Rigging(this.ship, FORE_RIG)
    this.rigs = [this.rigging, foreRig]
    this.bow = new TitanicBow(this.ship, game.audio)
    // Ziplines: from the main nest down to the deck and to Polly, overhead from nest to nest, and from
    // the front nest down to the bow. Every one goes both ways; the nest ends land you in the nest.
    const mainFloor = this.rigging.nestFloorY
    const foreFloor = foreRig.nestFloorY
    const intoNest = (rig: Rigging) => () => {
      game.player.placeFeet(rig.nestSpot(this.v2))
      game.audio.play('thud', this.v2, 0.4)
    }
    const MAST_ROUTE: ZiplineRoute = {
      top: new THREE.Vector3(0, mainFloor + 2.0, -0.95),
      stop: new THREE.Vector3(0, foreFloor + 2.0, FOREMAST_Z + 0.8),
      mastTie: new THREE.Vector3(0, mainFloor + 2.6, -0.12),
      railTie: new THREE.Vector3(0, foreFloor + 2.6, FOREMAST_Z + 0.12),
      to: 'the front crow\'s nest',
      from: 'the main crow\'s nest',
    }
    const BOW_ROUTE: ZiplineRoute = {
      top: new THREE.Vector3(0.45, foreFloor + 1.85, FOREMAST_Z - 0.6),
      stop: new THREE.Vector3(0, DECK_Y + 2.1, DECK_BOW_Z + 5),
      mastTie: new THREE.Vector3(0.1, foreFloor + 2.4, FOREMAST_Z - 0.1),
      railTie: this.bow.ropeTie.clone(),
      to: 'the bow',
      from: 'the front crow\'s nest',
    }
    const toMain = { top: intoNest(this.rigging) }
    this.ziplines = [
      new Zipline(this.ship, game.rig, game.player, game.audio, DECK_ROUTE, toMain, game.camera),
      new Zipline(this.ship, game.rig, game.player, game.audio, POLLY_ROUTE, toMain, game.camera),
      new Zipline(this.ship, game.rig, game.player, game.audio, MAST_ROUTE, { top: intoNest(this.rigging), stop: intoNest(foreRig) }, game.camera),
      new Zipline(this.ship, game.rig, game.player, game.audio, BOW_ROUTE, { top: intoNest(foreRig) }, game.camera),
    ].map((z) => this.grab.add(z))
    this.cannons = new DeckCannons(this.root, this.ship, this.grab, {
      audio: game.audio,
      smoke: this.smoke,
      fire: this.fire,
      splash: this.splash,
      debris: this.debris,
      hitTest: (a, b, swivel) => this.cannonHit(a, b, swivel),
      onFire: (i) => game.net?.send('cannon', { i }),
      // Aim for the middle of her hull.
      swivelTarget: () => this.enemy.group.localToWorld(new THREE.Vector3(0, 1.4, 0)),
    })
    this.buildSwivelKey()
    this.crew = new Crew(this.ship, this.root)
    this.swords = new Swords(this.ship.shake, this.root, {
      audio: game.audio,
      targets: () => this.swordTargets(),
      floor: (x, z) => this.walkEnv.groundHeight(x, z, DECK_Y + 3),
    })
    for (const sword of this.swords.swords) this.grab.add(sword)
    this.quarterdeck = new Quarterdeck(this.ship, this.grab, game.audio)
    // Polly perches on her stand by the helm, facing the wheel.
    const perch = new THREE.Object3D()
    perch.position.copy(PERCH_SPOT).add(new THREE.Vector3(0, 1.32, 0))
    perch.rotation.y = -Math.PI / 2
    this.ship.shake.add(perch)
    this.polly = new Parrot(perch, this.root, {
      audio: game.audio,
      crumbs: this.debris,
      ground: (x, z, below) => this.walkEnv.groundHeight(x, z, below),
      heads: () => [game.camera.getWorldPosition(new THREE.Vector3()), ...(game.remote?.headPositions() ?? [])],
      otherHands: () => game.remote?.handPositions() ?? [],
      onThrow: (at, vel, local) => game.net?.send('cracker', { at: at.toArray(), vel: vel.toArray(), local }),
      onCatch: (id) => game.net?.send('pollyCatch', { id }),
    })
    this.grab.add(new CrackerPack(this.quarterdeck.table, this.polly, game.audio))
    this.gear = new GearRack(this.ship, this.grab, game.camera, game.audio, (hand) => this.grab.drop(hand))
    this.gear.onChange = (piece) => this.onGear(piece)
    this.rats = new WhackARat(this.ship, this.grab, { audio: game.audio, sparks: this.fire, now: () => game.net?.serverNow() ?? performance.now() })
    this.roast = new RatRoast(this.ship, this.grab, {
      audio: game.audio,
      smoke: this.smoke,
      sparks: this.fire,
      now: () => game.net?.serverNow() ?? performance.now(),
      camera: game.camera,
      say: (text, seconds) => game.hud.now(text, seconds),
      hands: () => game.hands,
      setBurn: (amount) => (game.vignette.burn = amount),
    })
    this.cannoli = new CannoliCart(this.ship, this.grab, { audio: game.audio, cream: this.debris, camera: game.camera, say: (text, seconds) => game.hud.now(text, seconds) })
    this.tug = new TugOfWar(this.ship, this.grab, {
      audio: game.audio,
      confetti: this.fire,
      water: this.splash,
      camera: game.camera,
      say: (text, seconds) => game.hud.now(text, seconds),
      isHost: () => game.isHost(),
      now: () => performance.now() / 1000,
      head: (id) => game.remote?.head(id)?.getWorldPosition(new THREE.Vector3()) ?? null,
    })
    this.rats.onRoundStart = (round) => this.roast.roundStarted(round)
    this.rats.onRoundEnd = (score, round) => {
      this.roast.roundEnded(score, round)
      // The only hint of what the fire's for.
      if (score > 0) game.hud.now(`${score} rat${score === 1 ? '' : 's'}! Hit the red button to play again... or grab one of those rats.`, 6)
    }
    this.gear.onLocked = (hand) => {
      hand.pulse(0.2, 40)
      game.hud.now('The scuba gear is chained up. No need for it on a fine day like this… yet.', 3)
    }
    this.barrel = new BeerBarrel(this.ship, this.grab, {
      audio: game.audio,
      beer: this.splash,
      camera: game.camera,
      onDrink: (amount) => this.onDrink(amount),
      onHotSauce: () => this.onHotSauce(),
      hint: (text) => game.hud.now(text, 5),
    })
    const walk = (this.walkEnv = this.walkEnvironment())
    this.crewBoard = new CrewBoard(this.ship, game.audio, (cls) => this.chooseClass(cls))
    this.darts = new DartBoardArea(this.root, this.ship, this.grab, DART_TEAMS, {
      audio: game.audio,
      debris: this.debris,
      ground: walk.groundHeight,
      scatter: () => this.drunk.effects().dartScatter,
      onBullseye: () => {
        if (this.phase !== 'fakeout' || game.record.bullseyeBeforeBattle) return
        game.record.bullseyeBeforeBattle = true
        game.hud.say('Achievement: Bullseye Before Battle!', 4)
      },
    })
    const fog = game.scene.fog as THREE.Fog
    this.baseFog = { near: fog.near, far: fog.far }

    game.player.enter(walk, new THREE.Vector3(0.3, DECK_Y, 4.3), Math.PI)
    this.connectNet()
    game.audio.setEnvironment('air')
    game.wrist.setVisible(false)
    game.vignette.setMask(false)
    game.hud.say('Welcome aboard! Golden hour off the Sicilian coast. Enjoy the calm.', 5, 'Salvo')
    game.hud.setPrompt('Walk: left stick · Turn: right stick · Grab: grip. Pick up a blunderbuss from the rack up at the bow, by the clay thrower.')
  }

  /** The mini map (once the mask is on): our deck from above, bow to stern. */
  mapArea(): MapArea | null {
    const mid = this.ship.group.localToWorld(new THREE.Vector3(0, DECK_Y + 3.4, (DECK_BOW_Z + STERN_Z) / 2))
    return { x: mid.x, z: mid.z, size: STERN_Z - DECK_BOW_Z + 8, top: mid.y, name: 'On deck', exposure: 0.3, boost: 0.3 }
  }

  guide(): ButtonGuide {
    return {
      left: ['Stick: walk', 'X: jump', 'Grip: grab · climb net', '(point + grip: pull to you)', 'Trigger: fire · pour · strike', 'match · throw dart'],
      right: ['Stick: turn', 'A: jump', 'Grip: grab · climb net', '(point + grip: pull to you)', 'Trigger: fire · pour · strike', 'match · throw dart'],
      desktop: ['<b>Deck</b>', 'Drag: look · WASD: walk · Space: jump', 'At the net: Space / Q climb up / down', 'E: grab / drop · F: trigger · R: reload'],
    }
  }

  update(dt: number, elapsed: number): void {
    // What anyone holds, everyone sees (set up once the stage is built and we're in a crew).
    if (!this.heldSync && this.game.net) {
      this.heldSync = new HeldSync(this.game, this.id)
      syncAll(this.heldSync, this.id, this.grab.items)
    }
    this.heldSync?.update(dt)
    const { game } = this
    game.player.update(dt, game.inXr, game.desktop)
    // Putting on whatever's missing reaches for your own class's set first.
    this.gear.preferredSet = Math.max(0, GEAR_SETS.findIndex((g) => g.cls === game.party.character))
    this.gear.update()
    this.grab.update(dt, game.hands, game.player.physics.velocity, game.rig)
    this.range.update(dt)
    this.darts.update(dt, game.hands, game.camera)
    this.barrel.update(game.camera)
    this.range.faceSign(game.camera)
    this.cannons.update(dt, game.camera)
    this.updateRigging()
    this.updateHelm(dt, elapsed)
    this.updatePolly(dt, elapsed)
    this.crewBoard.update(dt, game.hands, game.bots.members(), game.net?.sessionId ?? 'me')
    this.crewBoard.setCode(game.net?.code ?? '')
    this.updateDrunk(dt)
    this.crew.update(dt, elapsed)
    this.ship.update(elapsed)
    this.enemy.update(elapsed)
    this.bobEnemy(elapsed)
    this.above.update(dt, elapsed, game.halfHeight)
    for (const p of [this.smoke, this.fire, this.debris, this.splash]) p.update(dt, game.halfHeight)

    this.syncNet(dt)
    this.swords.update(dt, game.halfHeight)
    this.rats.update(dt, game.hands, game.camera)
    this.roast.update(dt)
    this.cannoli.update(dt)
    this.tug.update(dt, game.hands, game.camera)
    if (this.phase !== 'overboard') this.bow.update(dt, game.camera.getWorldPosition(this.v), game.hands, game.camera, () => this.kingOfTheWorld(null))
    this.swords.face(game.camera)
    for (const z of this.ziplines) z.face(game.camera)
    if (this.phase === 'fakeout') this.updateFakeout(dt)
    else if (this.phase === 'attack') this.updateAttack(dt, elapsed)

    if (game.player.inWater && this.phase !== 'overboard') this.overboard()
  }

  exit(): void {
    this.heldSync?.dispose()
    for (const off of this.unsubscribe) off()
    this.game.hud.clear()
    this.game.vignette.drunk = 0
    this.game.vignette.burn = 0
    this.game.vignette.blackout = 0
    this.game.player.frozen = false
    this.game.player.setDrunk(0, 1)
    this.game.scene.remove(this.root)
    disposeTree(this.root)
  }

  /** Debug/test hook: start the attack as if the ship had been shot. `secondsAgo` catches a late joiner up. */
  startAttack(shooter = 'You', secondsAgo = 0): void {
    if (this.phase !== 'fakeout') return
    const { game } = this
    this.phase = 'attack'
    this.gear.unlock()
    this.cannons.swivel.fired()
    game.record.whoShotFirst = shooter
    game.audio.silence(1.2)
    game.hud.clear()
    this.riggingPrompt = ''
    // Heave to: the ship slows to a stop, and the other ship is no longer part of the moving scenery.
    this.sailing.underway = false
    this.root.attach(this.enemy.group)
    // Attaching re-expresses her rotation, and it can come out as a half turn about x and z (the same
    // pose) — which the battle's turn (it only sets y) would leave upside down. Keep her upright.
    const bow = new THREE.Vector3(0, 0, -1).applyQuaternion(this.enemy.group.quaternion)
    this.enemy.group.rotation.set(0, Math.atan2(-bow.x, -bow.z), 0)
    this.aimEnemyAtUs()
    // Anyone up the rigging is back on deck: the mast is about to take hits.
    const sliding = this.ziplines.some((z) => z.riding)
    for (const z of this.ziplines) z.forceRelease()
    const head = game.camera.getWorldPosition(this.v)
    if (sliding || game.player.climbing || this.rigs.some((r) => r.inNest(head))) {
      game.player.placeFeet(this.rigging.footOfNet(this.v))
      game.player.noJump = false
    }
    // Beer and darts are over; everybody's needed now.
    for (const mug of this.barrel.mugs) mug.dropNow()
    for (const sword of this.swords.swords) sword.forceDrop()
    this.attack = new AttackSequence(this.root, this.ship, this.enemy, this.broadsideYaw, {
      audio: game.audio,
      smoke: this.smoke,
      fire: this.fire,
      debris: this.debris,
      splash: this.splash,
      onScoreboardHit: () => {
        this.range.breakBoard()
        this.darts.interrupt()
      },
      hands: () => game.hands,
      head: () => game.camera.getWorldPosition(this.v2),
    })
    this.attack.t = Math.max(0, secondsAgo)
    if (shooter !== 'You') game.hud.now(`${shooter} shot the ship in the bay!`, 3)
  }

  private chooseClass(cls: CharacterClass): void {
    this.game.chooseClass(cls)
  }

  /** Flying at the bow with Rose: you (`who` null) or a crewmate shouts it, and Rose answers. */
  private kingOfTheWorld(who: string | null): void {
    const { game } = this
    game.hud.now(who ? `${who}: "I'M THE KING OF THE WORLD!"` : '"I\'M THE KING OF THE WORLD!"', 4)
    speak("I'm the king of the world!", { pitch: 0.95, rate: 1.05, volume: who ? 0.6 : 1 })
    setTimeout(() => speak("I'm flying, Jack!", { pitch: 1.45, rate: 1, volume: 0.8 }), 1900)
    setTimeout(() => game.hud.now('Rose: "I\'m flying, Jack!"', 3), 1900)
    if (!who && game.net) game.net.send('prop', { key: 'intro/king', v: [game.net.serverNow()] })
  }

  /** The crew dived: whoever's still on deck goes over the side with their gear on. */
  followCrew(id: string): boolean {
    if (id !== 'level1') return false
    this.overboard()
    return true
  }

  /** Bots walk the deck with the crew and go over the side when it's time. */
  bots(): BotWorld | null {
    if (!this.walkEnv) return null
    this.botWorld ??= {
      env: this.walkEnv,
      spawn: (slot) => {
        const head = this.game.camera.getWorldPosition(new THREE.Vector3())
        const p = head.add(new THREE.Vector3(Math.cos(slot * 2.1) * 1.8, 0, Math.sin(slot * 2.1) * 1.8))
        this.walkEnv.constrain(p)
        return p
      },
      task: () => null,
      collectibles: () => [],
      route: (_from, to) => [to],
      refill: null,
      bubbles: null,
      abandonShip: (from) => {
        if (this.phase !== 'attack' || !railsOpen(this.attack!.t, this.gear.complete)) return null
        const local = this.ship.group.worldToLocal(from.clone())
        const side = Math.sign(local.x) || 1
        const z = THREE.MathUtils.clamp(local.z, DECK_BOW_Z + 3, CABIN_FRONT_Z - 1)
        return this.ship.group.localToWorld(new THREE.Vector3(side * (deckHalfWidth(z) + 2.5), DECK_Y, z))
      },
    }
    return this.botWorld
  }

  // ---- Crew play ---------------------------------------------------------------------------------

  private connectNet(): void {
    const net = this.game.net
    if (!net) return
    const on = <T,>(type: string, cb: (msg: T) => void) => this.unsubscribe.push(net.on<T>(type, cb))
    this.guns.forEach((gun, i) => {
      const id = `gun${i}`
      gun.onGrabbed = () => net.send('claim', { id })
      gun.onReleased = () => net.send('release', { id })
    })
    this.swords.swords.forEach((sword, i) => {
      const id = `sword${i}`
      sword.onGrabbed = (hand) => {
        net.send('claim', { id })
        net.send('swordHand', { id, hand: hand.handedness === 'left' ? 0 : 1 })
      }
      sword.onReleased = () => net.send('release', { id })
    })
    // Darts: everyone sees each throw, and the landing (from the thrower's device) scores everywhere.
    const modes: DartsMode[] = ['301', '501', 'clock']
    this.darts.onThrow = (i, p, v) => net.send('dart', { i, k: 0, p: p.toArray(), v: v.toArray() })
    this.darts.onLanded = (i, at) => net.send('dart', { i, k: 1, at: at ? at.toArray() : null })
    this.darts.onMode = (mode, doubleOut) => net.send('prop', { key: 'intro/darts', v: [modes.indexOf(mode), doubleOut ? 1 : 0] })
    on<{ i: number; k: number; p?: number[]; v?: number[]; at?: number[] | null }>('dart', (msg) => {
      if (msg.k === 0 && msg.p && msg.v) this.darts.remoteThrow(msg.i, new THREE.Vector3().fromArray(msg.p), new THREE.Vector3().fromArray(msg.v))
      else if (msg.k === 1) this.darts.remoteLanded(msg.i, msg.at ? new THREE.Vector2().fromArray(msg.at) : null)
    })
    // Whack-a-Rat: one round, one score, for the whole crew.
    this.rats.onStart = (seed, startAt) => net.send('prop', { key: 'intro/rats', v: [seed, startAt] })
    this.rats.onHit = (i, startAt) => net.send('prop', { key: 'intro/ratHit', v: [i, startAt] })
    // Tug-of-war: everyone's pulls go to the host, who runs the match for all.
    this.tug.onPull = (team, amount) => net.send('prop', { key: 'intro/tugpull', v: [team, amount] })
    this.tug.onMatch = (state) => net.send('prop', { key: 'intro/tug', v: state })
    // Cannoli: filled, dipped, left on the plate, eaten: the same for everyone.
    this.cannoli.onChange = (i, state) => net.send('prop', { key: `intro/cannoli${i}`, v: state })
    // The roast: rats onto skewers, skewers (what's on them, how cooked), the spit.
    this.roast.onRatTaken = (i, round) => net.send('prop', { key: `intro/roast/rat${i}`, v: [round] })
    this.roast.onSkewer = (i, state) => net.send('prop', { key: `intro/roast/sk${i}`, v: state })
    this.roast.onSpit = (i, since) => net.send('prop', { key: 'intro/roast/spit', v: [i, since] })
    // Scuba gear: a piece someone puts on is gone from the rack for everyone.
    this.gear.onTaken = (set, piece) => net.send('prop', { key: `intro/gear/${set}/${piece}`, v: [1] })
    // The clay switches are shared: flipping one flips it for everybody.
    const switches = { 'intro/clayCount': this.range.countSwitch, 'intro/clayAuto': this.range.autoSwitch }
    for (const [key, sw] of Object.entries(switches)) sw.onFlip = (index) => net.send('prop', { key, v: [index] })
    on<{ key: string; v: number[]; by?: string }>('prop', (msg) => {
      const sw = switches[msg.key as keyof typeof switches]
      if (sw) sw.show(msg.v[0] === 1 ? 1 : 0)
      if (msg.key === 'intro/tugpull' && msg.by) this.tug.remotePull(msg.by, msg.v[0], msg.v[1])
      if (msg.key === 'intro/tug') this.tug.remoteMatch(msg.v)
      const cannolo = /^intro\/cannoli(\d)$/.exec(msg.key)
      if (cannolo) this.cannoli.remote(Number(cannolo[1]), msg.v)
      const roast = /^intro\/roast\/(rat|sk)(\d)$/.exec(msg.key)
      if (roast?.[1] === 'rat') this.roast.ratTakenRemote(Number(roast[2]), msg.v[0])
      if (roast?.[1] === 'sk') this.roast.skewerRemote(Number(roast[2]), msg.v)
      if (msg.key === 'intro/roast/spit') this.roast.spitRemote(msg.v[0], msg.v[1])
      if (msg.key === 'intro/rats') this.rats.start(msg.v[0], msg.v[1])
      if (msg.key === 'intro/ratHit') this.rats.hitRemote(msg.v[0], msg.v[1])
      const gear = /^intro\/gear\/(\d)\/(tank|mask|fins)$/.exec(msg.key)
      if (gear) this.gear.takenElsewhere(Number(gear[1]), gear[2] as GearPiece)
      if (msg.key === 'intro/darts') this.darts.setMode(modes[msg.v[0]] ?? '301', msg.v[1] === 1)
      // A crewmate flew with Rose (recently: the prop cache replays old ones to late joiners).
      if (msg.key === 'intro/king' && net.serverNow() - msg.v[0] < 5000) {
        const who = net.roster().find((p) => p.sessionId === msg.by)?.name ?? 'Someone'
        this.bow.fly()
        this.kingOfTheWorld(who)
      }
      // Someone unlocked the swivel gun (or had, before we joined).
      if (msg.key === 'intro/swivelUnlocked' && this.cannons.swivel.locked) {
        this.cannons.swivel.unlock(!msg.by)
        this.swivelKey.enabled = false
        this.swivelKey.object.visible = false
      }
    })
    net.send('props', { prefix: 'intro/' })
    on<{ id: string; hand: number }>('swordHand', (msg) => this.swordHands.set(msg.id, msg.hand === 0 ? 0 : 1))
    on<{ id: string }>('claimDenied', (msg) => {
      if (msg.id === 'wheel') {
        for (const hand of this.game.hands) if (hand.held === this.quarterdeck.wheel) {
          hand.held = null
          this.quarterdeck.wheel.release(hand)
        }
        this.game.hud.now('Someone else has the helm.', 2)
        return
      }
      if (msg.id.startsWith('sword')) {
        this.swords.swords[Number(msg.id.replace('sword', ''))]?.forceDrop()
        this.game.hud.now('Someone beat you to that sword.', 2)
        return
      }
      const gun = this.guns[Number(msg.id.replace('gun', ''))]
      if (gun && msg.id.startsWith('gun')) {
        gun.forceDrop()
        this.game.hud.now('Someone beat you to that gun.', 2)
      }
    })
    on<{ id: string }>('fired', (msg) => this.guns[Number(msg.id.replace('gun', ''))]?.playRemoteFire())
    on<{ id: number; seed: number; delay: number }>('clay', (msg) => {
      if (this.phase !== 'fakeout') return
      this.range.launchSeeded(msg.id, msg.seed, msg.delay)
      this.game.hud.say('Pull!', 1.2, 'Salvo')
    })
    on<{ id: number }>('clayBroken', (msg) => this.range.shatterById(msg.id))
    on<{ i: number }>('cannon', (msg) => this.cannons.fireRemote(msg.i))
    on<PollyState>('polly', (msg) => this.polly.applyState(msg))
    on<{ id: number; at: number[]; vel: number[]; by: string; local: number }>('cracker', (msg) => {
      if (msg.by === net.sessionId) this.polly.renameCracker(msg.local, msg.id)
      else this.polly.addRemoteCracker(msg.id, new THREE.Vector3().fromArray(msg.at), new THREE.Vector3().fromArray(msg.vel))
    })
    on<{ id: number }>('pollyCatch', (msg) => this.polly.remoteCatch(msg.id))
    on<SailState>('sail', (msg) => {
      const holder = net.state?.claims?.get('wheel') as string | undefined
      const command = holder ? holder === net.sessionId : this.game.bots.simulating
      if (!command) this.sailing.receive(msg)
    })
    const wheel = this.quarterdeck.wheel
    wheel.onGrabbed = () => net.send('claim', { id: 'wheel' })
    wheel.onReleased = () => net.send('release', { id: 'wheel' })
    on<{ id: number; at: number[]; vel: number[]; by: string; local: number }>('clayThrown', (msg) => {
      if (msg.by === net.sessionId) this.range.renameClay(msg.local, msg.id)
      else if (this.phase === 'fakeout') this.range.launchThrown(msg.id, new THREE.Vector3().fromArray(msg.at), new THREE.Vector3().fromArray(msg.vel))
    })
    on<{ at: number; shooter: string }>('attack', (msg) => this.joinAttack(msg.at, msg.shooter))
    // Joining a crew that's already under attack (or past it): catch up.
    if (net.state?.attackAt) this.joinAttack(net.state.attackAt, net.state.shooter)
  }

  /** Everyone a blade could cut: you, your crewmates, the bots and the ship's sailors. */
  private swordTargets(): SwordTarget[] {
    const { game } = this
    const targets: SwordTarget[] = []
    if (game.selfBody.group.visible) {
      targets.push({
        id: 'self',
        spheres: game.selfBody.hitSpheres(),
        onHit: () => {
          for (const hand of game.hands) hand.pulse(0.35, 90)
        },
      })
    }
    for (const [id, avatar] of game.remote?.visibleAvatars() ?? []) targets.push({ id, spheres: avatar.hitSpheres() })
    for (const [id, bot] of game.bots.bots) if (bot.avatar.group.visible) targets.push({ id, spheres: bot.avatar.hitSpheres() })
    for (const sailor of this.crew.sailors) {
      const g = sailor.group
      g.updateMatrixWorld(true)
      targets.push({
        id: `sailor:${sailor.spec.name}`,
        spheres: [
          { center: g.localToWorld(new THREE.Vector3(0, 1.62, 0)), radius: 0.15 },
          { center: g.localToWorld(new THREE.Vector3(0, 1.15, 0)), radius: 0.24 },
          { center: g.localToWorld(new THREE.Vector3(0, 0.6, 0)), radius: 0.19 },
        ],
      })
    }
    return targets
  }

  private joinAttack(at: number, shooter: string): void {
    const net = this.game.net!
    const name = shooter === net.me()?.name ? 'You' : shooter
    if (name === 'You') this.game.record.whoShotFirst = 'You'
    this.startAttack(name, (net.serverNow() - at) / 1000)
    if (name !== 'You') this.game.record.whoShotFirst = shooter
  }

  private syncNet(dt: number): void {
    const { net, remote } = this.game
    if (!net || !remote) return
    // Guns held by someone else ride in their right hand.
    this.guns.forEach((gun, i) => {
      const owner: string | undefined = net.state?.claims?.get(`gun${i}`)
      gun.setRemoteHand(owner && owner !== net.sessionId ? remote.hand(owner, 1) : null)
    })
    // Swords held by someone else ride in the hand they drew with.
    this.swords.swords.forEach((sword, i) => {
      const id = `sword${i}`
      const owner: string | undefined = net.state?.claims?.get(id)
      const theirs = owner && owner !== net.sessionId ? owner : null
      sword.setRemoteHand(theirs ? remote.hand(theirs, this.swordHands.get(id) ?? 1) : null, theirs)
    })
    this.boardTimer -= dt
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.5
      this.range.setShooters(net.roster().map((p) => ({ name: p.sessionId === net.sessionId ? `${p.name} (you)` : p.name, color: p.color, hits: p.hits, shots: p.shots })))
    }
  }

  // ---- Fake-out ---------------------------------------------------------------------------------

  private updateFakeout(dt: number): void {
    const { game, range } = this
    this.fakeoutTime += dt
    this.pullCooldown = Math.max(0, this.pullCooldown - dt)
    const gunHeld = this.guns.some((g) => g.held)

    if (gunHeld && !this.firstGunHeld) {
      this.firstGunHeld = true
      game.hud.setPrompt('Trigger fires. After two shots, flick your wrist down, then up, to reload (or press A/X).')
      game.hud.say('Ready when you are!', 3, 'Salvo')
      this.pullCooldown = 3
    }
    if (this.firstGunHeld && this.game.record.clayShots >= 6) game.hud.setPrompt('')

    // Until someone takes over the lever, Salvo calls "Pull!" whenever someone's holding a gun and the sky is clear.
    range.countSwitch.touch(game.hands)
    range.autoSwitch.touch(game.hands)
    // AUTO on: clays keep coming (a moment after the last ones are gone). In a crew one device runs it.
    this.autoTimer = Math.max(0, this.autoTimer - dt)
    if (range.autoSwitch.on) {
      this.leverUsed = true
      const runsHere = !game.net || game.bots.simulating
      if (runsHere && !range.anyInFlight && this.autoTimer === 0) {
        this.autoTimer = AUTO_GAP
        this.pull(range.countSwitch.count)
      }
    }
    if (!this.leverUsed && gunHeld && !range.anyInFlight && this.pullCooldown === 0) this.pull(Math.random() < 0.3 ? 2 : 1)

    // Gentle nudges toward the ship in the bay. Nothing ever says to shoot it.
    const nudges: [number, () => void][] = [
      [100, () => game.hud.say("That merchant's been sitting in the bay all afternoon...", 5, 'Nino')],
      [170, () => {
        this.polly.flyTo(this.enemy.group.getWorldPosition(new THREE.Vector3()))
        game.hud.say("Polly doesn't like the look of that ship.", 5, 'Rosalia')
      }],
      [240, () => game.hud.say('Odd. Not a soul on her deck.', 5, 'Turi')],
    ]
    if (this.nudges < nudges.length && this.fakeoutTime >= nudges[this.nudges][0]) nudges[this.nudges++][1]()
  }

  private pull(count: number): void {
    this.crew.get('Salvo').group.getWorldPosition(this.v)
    this.game.audio.play('whistle', this.v.setY(this.v.y + 1.6))
    this.pullCooldown = PULL_COOLDOWN + Math.random() * 1.5
    // In a crew there's one thrower: the server launches the clays for everybody.
    if (this.game.net) {
      this.game.net.send('pull', { count })
      return
    }
    this.game.hud.say('Pull!', 1.2, 'Salvo')
    this.range.pull(count)
  }

  private onFire(origin: THREE.Vector3, directions: THREE.Vector3[]): void {
    const { game } = this
    const net = game.net
    const you = this.range.shooters[0]
    const hits = this.range.shoot(you, origin, directions, !net)
    if (net) {
      net.send('shot')
      const held = this.guns.findIndex((g) => g.held)
      if (held >= 0) net.send('fired', { id: `gun${held}` })
      for (const id of hits) net.send('clayHit', { id })
    } else {
      game.record.clayShots = you.shots
      game.record.clayHits = you.hits
    }
    if (hits.length > 0) game.hands.forEach((h) => h.held && h.pulse(0.2, 30))

    // Pellets that land in the sea nearby kick up little splashes.
    let splashes = 0
    for (const dir of directions) {
      if (dir.y >= -0.01 || splashes >= 3) continue
      const t = -origin.y / dir.y
      if (t > 70) continue
      splashes++
      this.splash.emit({ position: this.v.copy(origin).addScaledVector(dir, t), velocity: new THREE.Vector3(0, 1.5, 0), spread: 0.5, color: 0xeaf6ff, size: 0.08, life: 0.5, count: 5 })
    }

    // Pellets on the "merchant" just knock off a few splinters: only the quarterdeck's swivel gun
    // (and that's locked) starts the fight.
    this.enemy.group.updateMatrixWorld(true)
    for (const dir of directions) {
      this.raycaster.set(origin, dir)
      this.raycaster.far = 400
      const hit = this.raycaster.intersectObjects(this.enemy.hitMeshes, false)[0]
      if (hit) {
        this.debris.emit({ position: hit.point, spread: 1, color: 0x5b3a21, size: 0.08, life: 1, count: 3 })
        return
      }
    }
  }

  // ---- Polly --------------------------------------------------------------------------------------

  private pollyTimer = 0

  /** Polly is run on one device (solo: here; in a crew: the host) and everyone else follows it. */
  private updatePolly(dt: number, elapsed: number): void {
    const { game } = this
    const net = game.net
    const runHere = !net || game.bots.simulating
    this.polly.setAuthority(runHere)
    this.polly.update(dt, elapsed, game.hands)
    this.pollyTimer -= dt
    if (net && runHere && this.pollyTimer <= 0) {
      this.pollyTimer = 0.1
      net.send('polly', this.polly.snapshot())
    }
  }

  // ---- Sailing ------------------------------------------------------------------------------------

  /** The wheel steers; in a crew, whoever holds it (or the host) sails for everyone. */
  private updateHelm(dt: number, elapsed: number): void {
    const { game, sailing } = this
    const wheel = this.quarterdeck.wheel
    const net = game.net
    const holder = net?.state?.claims?.get('wheel') as string | undefined
    wheel.lockedBy = net && holder && holder !== net.sessionId ? holder : null
    const command = !net || (holder ? holder === net.sessionId : game.bots.simulating)
    if (command) sailing.takeCommand()
    const used = sailing.update(dt, elapsed, wheel.rudder)
    if (!sailing.commanding && !wheel.held) wheel.setAngle(sailing.state.wheel)
    else sailing.state.wheel = wheel.angle
    this.above.setHeading(sailing.state.heading)
    if (sailing.correcting && used !== 0 && !this.warnedShoals && this.phase === 'fakeout') {
      this.warnedShoals = true
      game.hud.say(wheel.held ? "Shoals ahead, Captain! Bringin' her about." : 'Easy there, bringing her about!', 3, 'Salvo')
    }
    if (!sailing.correcting) this.warnedShoals = false
    // The one sailing the ship tells everyone else where she is, five times a second.
    this.sailTimer -= dt
    if (net && command && this.sailTimer <= 0) {
      this.sailTimer = 0.2
      const s = sailing.state
      net.send('sail', { x: s.x, z: s.z, heading: s.heading, speed: s.speed, wheel: s.wheel })
    }
  }

  /** The attack begins: turn the other ship (wherever the voyage left her) into a sensible range. */
  private aimEnemyAtUs(): void {
    // Close enough to see her in full: broadside on, 75 m off, guns blazing (from wherever she was).
    const at = this.enemy.group.position
    const flat = new THREE.Vector3(at.x, 0, at.z)
    if (flat.lengthSq() < 1) flat.set(1, 0, -1)
    flat.setLength(ENEMY_BATTLE_RANGE)
    at.x = flat.x
    at.z = flat.z
    this.enemy.group.scale.setScalar(1)
    const toUs = flat.clone().negate().normalize()
    this.broadsideYaw = Math.atan2(toUs.z, -toUs.x)
  }

  // ---- Cannons and rigging ------------------------------------------------------------------------

  /** A cannonball from `a` to `b`: did it hit the ship in the bay? Only the swivel gun's starts the attack. */
  private cannonHit(a: THREE.Vector3, b: THREE.Vector3, swivel: boolean): THREE.Vector3 | null {
    const length = a.distanceTo(b)
    if (length < 1e-4) return null
    this.enemy.group.updateMatrixWorld(true)
    this.raycaster.set(a, this.v2.subVectors(b, a).normalize())
    this.raycaster.far = length
    const hit = this.raycaster.intersectObjects(this.enemy.hitMeshes, false)[0]
    if (!hit) return null
    if (this.phase === 'fakeout' && swivel) {
      if (this.game.net) this.game.net.send('hitShip')
      else this.startAttack('You')
    }
    return hit.point.clone()
  }

  /**
   * The swivel gun's key: hung on a nail on the cabin wall, tucked in under the high end of the
   * quarterdeck stairs. Carry it up and touch it to the padlock to open it.
   */
  private buildSwivelKey(): void {
    const { game } = this
    const key = makeItem('key')
    key.scale.setScalar(1.3)
    key.position.set((STAIRS.x0 + STAIRS.x1) / 2, DECK_Y + 0.55, CABIN_FRONT_Z - 0.07)
    key.rotation.set(0, 0, Math.PI / 2)
    const nail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.6, roughness: 0.5 }))
    nail.position.copy(key.position).add(new THREE.Vector3(0, 0.06, 0.02))
    this.ship.shake.add(key, nail)
    this.cannons.swivel.onNag = () => game.hud.now('It\'s padlocked shut. The key must be put away somewhere on the ship...', 3)
    this.swivelKey = this.grab.add(
      new LooseItem(key, {
        radius: 0.1,
        settle: 'home',
        onGrab: () => {
          game.hud.now('An old iron key, hidden under the stairs. What could it open?', 3)
          return false
        },
        whileHeld: (hand) => {
          if (!this.cannons.swivel.locked || key.getWorldPosition(this.v).distanceTo(this.cannons.swivel.lockPoint) > 0.22) return
          this.grab.drop(hand)
          this.swivelKey.enabled = false
          key.visible = false
          this.cannons.swivel.unlock()
          hand.pulse(0.7, 100)
          game.audio.play('click', this.cannons.swivel.lockPoint, 1)
          game.hud.now('Click! The padlock falls away from the swivel gun...', 3)
          game.net?.send('prop', { key: 'intro/swivelUnlocked', v: [1] })
        },
      }),
    )
  }

  /** The net nearest a point (by distance to its mast). */
  private nearestRig(p: THREE.Vector3): Rigging {
    const local = this.ship.shake.worldToLocal(p.clone())
    return this.rigs.reduce((best, r) => (Math.abs(local.z - r.spec.mastZ) < Math.abs(local.z - best.spec.mastZ) ? r : best))
  }

  /** Climbing into and out of the crow's nests, with A/X (R on the keyboard). */
  private updateRigging(): void {
    const { game } = this
    const player = game.player
    if (this.phase !== 'fakeout') {
      player.noJump = false
      return
    }
    const head = game.camera.getWorldPosition(this.v)
    // Whichever nest you're in, or at the top of the net to.
    const rig = this.rigs.find((r) => r.inNest(head)) ?? this.rigs.find((r) => player.climbing && r.nearTop(head)) ?? this.rigging
    const inNest = rig.inNest(head)
    const atTop = !inNest && player.climbing && rig.nearTop(head)
    player.noJump = inNest || atTop
    const key = game.inXr ? 'A/X' : 'R'
    const prompt = atTop ? `${key}: climb into the crow's nest` : inNest ? `${key}: climb back out onto the net` : ''
    if (prompt !== this.riggingPrompt) {
      if (prompt || this.riggingPrompt) game.hud.setPrompt(prompt)
      this.riggingPrompt = prompt
    }
    const pressed = game.hands.some((h) => h.connected && h.primaryPressed && !h.held)
    if (!pressed) return
    if (atTop) {
      player.placeFeet(rig.nestSpot(this.v2))
      game.audio.play('thud', this.v2, 0.4)
      if (!this.sawTheView) {
        this.sawTheView = true
        game.hud.say('What a view! You can see the whole bay from up here.', 4)
      }
    } else if (inNest) {
      player.placeHead(rig.netTopHang(this.v2))
    }
  }

  // ---- Beer ------------------------------------------------------------------------------------

  /** A swig of hot sauce: fire in your mouth, and the drink's gone from your head. */
  private onHotSauce(): void {
    const { game } = this
    const wasDrunk = this.drunk.drinks > 0.2
    this.drunk.sober()
    this.applyDrunkEffects()
    const mouth = game.camera.getWorldPosition(new THREE.Vector3()).add(game.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.25)).add(new THREE.Vector3(0, -0.08, 0))
    this.fire.emit({ position: mouth, velocity: game.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(1.5), spread: 0.4, color: 0xff6a2a, size: 0.08, endSize: 0.02, life: 0.5, count: 14 })
    game.hud.say(wasDrunk ? 'WHOA, that\'s HOT! Your eyes water... and your head is clear as a bell.' : 'WHOA, that\'s HOT! Good thing you weren\'t drunk.', 4)
  }

  private onDrink(amount: number): void {
    const before = Math.floor(this.drunk.drinks)
    if (this.drunk.drink(amount) === 'blackout') return this.passOut()
    const after = Math.floor(this.drunk.drinks)
    if (after > before) this.drinkRemark(after)
  }

  /** A word from the crew (or your own head) as each mug goes down. */
  private drinkRemark(drinks: number): void {
    const lines: Record<number, [string, string?]> = {
      1: ['Salute! Good grog, eh?', 'Salvo'],
      2: ['A warm glow spreads through you.'],
      3: ["Steady there, the deck's not moving. Much.", 'Rosalia'],
      5: ['Hic!'],
      7: ['Everything is golden and a bit swimmy.'],
      8: ['Easy, friend. One or two more and you are under the table!', 'Salvo'],
    }
    const line = lines[drinks]
    if (line) this.game.hud.say(line[0], 3, line[1])
  }

  private passOut(): void {
    const { game } = this
    game.player.frozen = true
    for (const hand of game.hands) {
      if (hand.held) {
        hand.held.release(hand, new THREE.Vector3())
        hand.held = null
      }
    }
    game.audio.silence(3)
    game.hud.say('...', 3)
    // Can't take your darts turn while out cold.
    this.darts.skipTurn()
  }

  private updateDrunk(dt: number): void {
    const event = this.drunk.update(dt)
    const { game } = this
    if (this.drunk.passedOut) {
      const t = this.drunk.blackout
      // Fade to black quickly, hold, then fade back in over the last second.
      game.vignette.blackout = Math.min(1, (3 - t) / 0.5, t / 1)
    } else if (game.vignette.blackout > 0) {
      game.vignette.blackout = 0
    }
    if (event === 'wake') {
      game.player.frozen = false
      game.hud.say('You come round on the deck. Head clear, somehow.', 4)
    }
    this.applyDrunkEffects()
  }

  private applyDrunkEffects(): void {
    const fx = this.drunk.effects()
    const { game } = this
    game.player.setDrunk(fx.walkDrift, fx.walkSpeed)
    for (const gun of this.guns) gun.sway = fx.aimSway
    const visual = game.settings.drunkFx
    const fog = game.scene.fog as THREE.Fog | null
    if (fog && 'far' in fog && this.baseFog.far > 0) {
      const scale = visual ? fx.fogScale : 1
      fog.far = this.baseFog.far * scale
      fog.near = Math.min(this.baseFog.near * scale, fog.far * 0.3)
    }
    game.vignette.drunk = visual ? fx.tint : 0
  }

  // ---- Attack -----------------------------------------------------------------------------------

  private updateAttack(dt: number, elapsed: number): void {
    const attack = this.attack!
    const before = attack.t
    attack.update(dt, elapsed)
    const t = attack.t
    const { game } = this

    const at = (mark: number) => before < mark && t >= mark
    if (at(2)) game.hud.say('Is she... turning?', 2.5, 'Nino')
    if (at(4.2)) game.hud.say('PIRATES! Get down!', 2.5, 'Salvo')
    if (at(6)) {
      this.crew.panic()
      game.hud.say("She's holed below the waterline! We're going down!", 4, 'Rosalia')
      this.updateGearPrompt()
    }
    if (at(24)) game.hud.say('The foremast!', 2.5, 'Turi')
    if (t >= 6) game.hud.setTimer(`SINKING ${formatClock(secondsLeft(t))}`)
    if (at(60) && !this.gear.complete) game.hud.say('Hurry! Tank, mask, fins, then over the side!', 4, 'Salvo')
    if (!this.railsWereOpen && railsOpen(t, this.gear.complete)) {
      this.railsWereOpen = true
      game.hud.setPrompt('Abandon ship! Go over the side!')
      game.hud.say('Abandon ship!', 3, 'Salvo')
    }
    if (t >= ATTACK_SECONDS) this.overboard()
  }


  private onGear(piece: GearPiece): void {
    const lines: Record<GearPiece, string> = {
      tank: 'Tank clipped on.',
      mask: 'Mask on.',
      fins: 'Fins on.',
      map: 'You have the treasure map. Guard it with your life!',
    }
    this.game.hud.say(lines[piece], 2.5)
    if (this.phase === 'attack') this.updateGearPrompt()
    if (piece === 'mask') this.game.vignette.setMask(true)
  }

  private updateGearPrompt(): void {
    if (this.railsWereOpen) return
    const s = this.gear.state
    const mark = (done: boolean) => (done ? '✓' : '✗')
    const next = !s.tank
      ? 'Tank: grab it and let go over your shoulder.'
      : !s.mask
        ? 'Mask: hold it up to your face.'
        : !s.fins
          ? 'Fins: grab them.'
          : 'Grab the treasure map from the captain’s table!'
    this.game.hud.setPrompt(`Gear up at the SCUBA rack. Tank ${mark(s.tank)} · Mask ${mark(s.mask)} · Fins ${mark(s.fins)} · Map ${mark(s.map)}. ${next}`)
  }

  private overboard(): void {
    if (this.phase === 'overboard') return
    this.phase = 'overboard'
    const { game } = this
    // Washed off unready? The sea's kind: whatever was missing is on you now.
    this.gear.equipAll()
    // The cold sea sobers you up.
    this.drunk.sober()
    this.applyDrunkEffects()
    game.audio.play('bigSplash')
    game.hud.clear()
    game.goTo(() => new Level1Stage(game, true))
  }

  // ---- World ------------------------------------------------------------------------------------

  private buildGunRack(): void {
    const rack = new THREE.Group()
    rack.position.copy(GUN_RACK)
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1b, roughness: 0.85 })
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.14), wood)
    beam.position.y = 1.3
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.25), wood)
    base.position.y = 0.25
    rack.add(beam, base)
    this.ship.shake.add(rack)
    const upright = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.12, 0, 0))
    for (const x of [-0.25, 0.25]) {
      // Grips rest at about waist height so they're easy to reach.
      const gun = new Shotgun(rack, new THREE.Vector3(x, 0.8, 0.02), upright, {
        audio: this.game.audio,
        smoke: this.smoke,
        flash: this.fire,
        onFire: (origin, dirs) => this.onFire(origin, dirs),
        desktop: () => !this.game.inXr,
      })
      this.guns.push(this.grab.add(gun))
    }
  }

  private bobEnemy(elapsed: number): void {
    const e = this.enemy.group
    e.position.y = Math.sin(elapsed * 0.6) * 0.15
    e.rotation.z = Math.sin(elapsed * 0.5) * 0.02
  }

  /** On foot on our (possibly tilting and sinking) deck. */
  private walkEnvironment(): WalkEnvironment {
    const ship = this.ship.group
    const local = new THREE.Vector3()
    const toLocal = (x: number, z: number) => ship.worldToLocal(local.set(x, ship.position.y + DECK_Y, z))
    return {
      kind: 'walk',
      waterY: 0,
      // Hanging on a net, or dangling from the rope between the nests.
      climbable: (p, reach) => this.rigs.some((r) => r.onNet(p, reach)),
      climbUp: (target) => this.nearestRig(this.game.camera.getWorldPosition(new THREE.Vector3())).upTheNet(target),
      climbHold: (head, target) => this.nearestRig(head).holdOffset(head, target),
      groundHeight: (x, z, below) => {
        if (below !== undefined) {
          for (const r of this.rigs ?? []) {
            const nest = r.nestFloorAt(x, z, below)
            if (nest !== null) return nest
          }
        }
        const upper = this.quarterdeck?.groundAt(x, z, below) ?? null
        if (upper !== null) return upper
        const p = toLocal(x, z)
        if (p.z > STERN_Z || p.z < DECK_BOW_Z || Math.abs(p.x) > deckHalfWidth(p.z)) return null
        return ship.localToWorld(p.setY(DECK_Y)).y
      },
      constrain: (head, feetY) => {
        if (feetY !== undefined && this.quarterdeck) {
          // Up the stairs or on the quarterdeck: its own railings apply.
          const q = ship.worldToLocal(local.set(head.x, feetY, head.z))
          const feetLocal = q.y
          if (this.quarterdeck.constrain(q, feetLocal)) {
            const world = ship.localToWorld(q)
            head.x = world.x
            head.z = world.z
            return
          }
        }
        const nestRig = this.rigs?.find((r) => r.inNest(head))
        if (nestRig) {
          const q = ship.worldToLocal(local.copy(head))
          nestRig.constrainInNest(q)
          const world = ship.localToWorld(q)
          head.x = world.x
          head.z = world.z
          return
        }
        const p = toLocal(head.x, head.z)
        const open = this.phase === 'attack' && railsOpen(this.attack!.t, this.gear.complete)
        const cabinFront = CABIN_FRONT_Z - RAIL_MARGIN
        if (open) {
          // Over the side is allowed, but not through the cabin wall.
          if (p.z > cabinFront && Math.abs(p.x) < deckHalfWidth(STERN_Z)) p.z = cabinFront
        } else {
          // Right up into the bow's point, to stand behind Rose.
          p.z = THREE.MathUtils.clamp(p.z, DECK_BOW_Z + 1.35, cabinFront)
          const half = deckHalfWidth(p.z) - RAIL_MARGIN
          p.x = THREE.MathUtils.clamp(p.x, -half, half)
        }
        for (const o of OBSTACLES) {
          const dx = p.x - o.x
          const dz = p.z - o.z
          const d = Math.hypot(dx, dz)
          if (d < o.r + 0.2 && d > 1e-4) {
            p.x = o.x + (dx / d) * (o.r + 0.2)
            p.z = o.z + (dz / d) * (o.r + 0.2)
          }
        }
        const world = ship.localToWorld(p)
        head.x = world.x
        head.z = world.z
      },
    }
  }
}

/** Say it out loud (the browser's speech voice), if it has one. */
function speak(text: string, o: { pitch: number; rate: number; volume: number }): void {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return
  const line = new SpeechSynthesisUtterance(text)
  line.pitch = o.pitch
  line.rate = o.rate
  line.volume = o.volume
  synth.speak(line)
}
