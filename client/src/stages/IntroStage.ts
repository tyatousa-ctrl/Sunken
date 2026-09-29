import type { ButtonGuide } from '../ui/ControllerGuide'
import * as THREE from 'three'
import { disposeTree, type GameContext, type Stage } from '../core/Stage'
import { Particles } from '../fx/Particles'
import { GrabSystem } from '../interaction/GrabSystem'
import type { WalkEnvironment } from '../movement/environment'
import { AttackSequence } from '../intro/AttackSequence'
import { ATTACK_SECONDS, formatClock, railsOpen, secondsLeft } from '../intro/attackTimeline'
import { ClayRange } from '../intro/ClayRange'
import { Crew } from '../intro/Crew'
import { BARREL_POSITION, BeerBarrel } from '../intro/BeerBarrel'
import { BOARD_POSITION, DartBoardArea, THROW_DISTANCE } from '../intro/DartBoard'
import { DrunkState } from '../intro/drunk'
import { GearRack, TABLE_POSITION, type GearPiece } from '../intro/GearRack'
import { Shotgun } from '../intro/Shotgun'
import { AboveWater } from '../world/above/Coast'
import { CREW_BOARD_SPOT, CrewBoard } from '../intro/CrewBoard'
import type { BotWorld } from '../bots/world'
import type { CharacterClass } from '../systems/crew'
import { CLASS_NAMES } from '../systems/crew'
import { saveSettings } from '../core/settings'
import { BOW_Z, CABIN_FRONT_Z, DECK_Y, Galleon, STERN_Z, halfWidthAt } from '../world/ship/Galleon'
import { NET_OBSTACLES, Rigging } from '../intro/Rigging'
import { DeckCannons, MATCH_CRATE } from '../intro/DeckCannons'
import { PERCH_SPOT, Quarterdeck, STAIRS } from '../intro/Quarterdeck'
import { Sailing, type SailState } from '../intro/Sailing'
import { CrackerPack, Parrot, type PollyState } from '../intro/Parrot'
import { Swords, type SwordTarget } from '../intro/Swords'
import { Zipline } from '../intro/Zipline'
import { Level1Stage } from './Level1Stage'

/** The "harmless merchant" anchored in the bay, ~150 m off the starboard bow. */
const ENEMY_POSITION = new THREE.Vector3(110, 0, -100)
const RAIL_MARGIN = 0.35
const PULL_COOLDOWN = 2.5

type Phase = 'fakeout' | 'attack' | 'overboard'

interface Obstacle {
  x: number
  z: number
  r: number
}

/** Deck obstacles (ship-local circles): masts, table, gear rack, thrower, beer table, dart rack. */
const OBSTACLES: Obstacle[] = [
  { x: 0, z: 0, r: 0.45 },
  { x: 0, z: -8, r: 0.45 },
  { x: TABLE_POSITION.x, z: TABLE_POSITION.z, r: 0.75 },
  { x: -(halfWidthAt(1.6) - 0.45), z: 1.6, r: 0.5 },
  { x: halfWidthAt(6.2) - 0.5, z: 6.2, r: 0.45 },
  { x: BARREL_POSITION.x, z: BARREL_POSITION.z, r: 0.6 },
  { x: -2.35, z: BOARD_POSITION.z - THROW_DISTANCE - 0.1, r: 0.15 },
  { x: CREW_BOARD_SPOT.x, z: CREW_BOARD_SPOT.z, r: 0.35 },
  { x: MATCH_CRATE.x, z: MATCH_CRATE.z, r: 0.35 },
  ...NET_OBSTACLES,
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
  private readonly ship = new Galleon({ flag: 'crew' })
  private readonly enemy = new Galleon({ hullColor: 0x2e2620, sailColor: 0xcfc6b2, flag: 'merchant' })
  private readonly smoke = new Particles({ max: 500, gravity: 0.3, drag: 0.6 })
  private readonly fire = new Particles({ max: 400, gravity: 1.5, drag: 1, blending: THREE.AdditiveBlending })
  private readonly debris = new Particles({ max: 400, gravity: -9.8, drag: 0.3 })
  private readonly splash = new Particles({ max: 400, gravity: -9.8, drag: 0.4 })
  // The rigging net is a handhold: grip it to climb.
  private readonly grab = new GrabSystem({ rocks: [], climb: (p) => this.rigging?.onNet(p, 0.12) ?? false })
  private rigging!: Rigging
  private zipline!: Zipline
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
    this.range.onLever = (count) => {
      if (this.phase !== 'fakeout') return
      // Someone's working the thrower: Salvo stops calling "Pull!" on his own.
      this.leverUsed = true
      this.pull(count)
    }
    this.rigging = new Rigging(this.ship)
    this.zipline = new Zipline(this.ship, game.rig, game.player, game.audio)
    this.grab.add(this.zipline)
    this.cannons = new DeckCannons(this.root, this.ship, this.grab, {
      audio: game.audio,
      smoke: this.smoke,
      fire: this.fire,
      splash: this.splash,
      debris: this.debris,
      hitTest: (a, b) => this.cannonHit(a, b),
      onFire: (i) => game.net?.send('cannon', { i }),
    })
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
    this.gear.onLocked = (hand) => {
      hand.pulse(0.2, 40)
      game.hud.now('The scuba gear is chained up. No need for it on a fine day like this… yet.', 3)
    }
    this.barrel = new BeerBarrel(this.ship, this.grab, {
      audio: game.audio,
      beer: this.splash,
      camera: game.camera,
      onDrink: (amount) => this.onDrink(amount),
    })
    const walk = (this.walkEnv = this.walkEnvironment())
    this.crewBoard = new CrewBoard(this.ship, game.audio, (cls) => this.chooseClass(cls))
    this.darts = new DartBoardArea(this.root, this.ship, this.grab, [{ name: 'You', color: '#e8b930' }], {
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
    game.hud.setPrompt('Walk: left stick · Turn: right stick · Grab: grip. Pick up a blunderbuss from the rack by the cabin.')
  }

  guide(): ButtonGuide {
    return {
      left: ['Stick: walk', 'X: jump', 'Grip: grab · climb net', '(point + grip: pull to you)', 'Trigger: fire · pour · strike', 'match · throw dart'],
      right: ['Stick: turn', 'A: jump', 'Grip: grab · climb net', '(point + grip: pull to you)', 'Trigger: fire · pour · strike', 'match · throw dart'],
      desktop: ['<b>Deck</b>', 'Drag: look · WASD: walk · Space: jump', 'At the net: Space / Q climb up / down', 'E: grab / drop · F: trigger · R: reload'],
    }
  }

  update(dt: number, elapsed: number): void {
    const { game } = this
    game.player.update(dt, game.inXr, game.desktop)
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
    this.updateDrunk(dt)
    this.crew.update(dt, elapsed)
    this.ship.update(elapsed)
    this.enemy.update(elapsed)
    this.bobEnemy(elapsed)
    this.above.update(dt, elapsed, game.halfHeight)
    for (const p of [this.smoke, this.fire, this.debris, this.splash]) p.update(dt, game.halfHeight)

    this.syncNet(dt)
    this.swords.update(dt, game.halfHeight)
    this.swords.face(game.camera)
    this.zipline.face(game.camera)
    if (this.phase === 'fakeout') this.updateFakeout(dt)
    else if (this.phase === 'attack') this.updateAttack(dt, elapsed)

    if (game.player.inWater && this.phase !== 'overboard') this.overboard()
  }

  exit(): void {
    for (const off of this.unsubscribe) off()
    this.game.hud.clear()
    this.game.vignette.drunk = 0
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
    game.record.whoShotFirst = shooter
    game.audio.silence(1.2)
    game.hud.clear()
    this.riggingPrompt = ''
    // Heave to: the ship slows to a stop, and the other ship is no longer part of the moving scenery.
    this.sailing.underway = false
    this.root.attach(this.enemy.group)
    this.aimEnemyAtUs()
    // Anyone up the rigging is back on deck: the mast is about to take hits.
    const sliding = this.zipline.riding
    this.zipline.forceRelease()
    if (sliding || game.player.climbing || this.rigging.inNest(game.camera.getWorldPosition(this.v))) {
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
    const { game } = this
    if (game.net) {
      game.net.send('profile', { character: cls })
    } else {
      game.party.character = cls
    }
    game.settings.character = cls
    saveSettings(game.settings)
    game.hud.now(`You're the ${CLASS_NAMES[cls]} now.`, 3)
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
        const z = THREE.MathUtils.clamp(local.z, BOW_Z + 3, CABIN_FRONT_Z - 1)
        return this.ship.group.localToWorld(new THREE.Vector3(side * (halfWidthAt(z) + 2.5), DECK_Y, z))
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

    if (this.phase !== 'fakeout') return
    // Any pellet on the "merchant" (hull, sails, flag) starts the attack.
    this.enemy.group.updateMatrixWorld(true)
    for (const dir of directions) {
      this.raycaster.set(origin, dir)
      this.raycaster.far = 400
      if (this.raycaster.intersectObjects(this.enemy.hitMeshes, false).length > 0) {
        // In a crew the server decides who was first; the attack starts when it says so.
        if (game.net) game.net.send('hitShip')
        else this.startAttack('You')
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
    const at = this.enemy.group.position
    const flat = new THREE.Vector3(at.x, 0, at.z)
    const distance = flat.length()
    if (distance > 260 || distance < 80) {
      flat.setLength(160)
      at.x = flat.x
      at.z = flat.z
    }
    const toUs = flat.clone().negate().normalize()
    this.broadsideYaw = Math.atan2(toUs.z, -toUs.x)
  }

  // ---- Cannons and rigging ------------------------------------------------------------------------

  /** A cannonball from `a` to `b`: did it hit the ship in the bay? Hitting her starts the attack. */
  private cannonHit(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 | null {
    const length = a.distanceTo(b)
    if (length < 1e-4) return null
    this.enemy.group.updateMatrixWorld(true)
    this.raycaster.set(a, this.v2.subVectors(b, a).normalize())
    this.raycaster.far = length
    const hit = this.raycaster.intersectObjects(this.enemy.hitMeshes, false)[0]
    if (!hit) return null
    if (this.phase === 'fakeout') {
      if (this.game.net) this.game.net.send('hitShip')
      else this.startAttack('You')
    }
    return hit.point.clone()
  }

  /** Climbing into and out of the crow's nest, with A/X (R on the keyboard). */
  private updateRigging(): void {
    const { game } = this
    const player = game.player
    if (this.phase !== 'fakeout') {
      player.noJump = false
      return
    }
    const head = game.camera.getWorldPosition(this.v)
    const inNest = this.rigging.inNest(head)
    const atTop = !inNest && player.climbing && this.rigging.nearTop(head)
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
      player.placeFeet(this.rigging.nestSpot(this.v2))
      game.audio.play('thud', this.v2, 0.4)
      if (!this.sawTheView) {
        this.sawTheView = true
        game.hud.say('What a view! You can see the whole bay from up here.', 4)
      }
    } else if (inNest) {
      player.placeHead(this.rigging.netTopHang(this.v2))
    }
  }

  // ---- Beer ------------------------------------------------------------------------------------

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
    rack.position.set(2.0, DECK_Y, CABIN_FRONT_Z - 0.18)
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
      climbable: (p, reach) => this.rigging.onNet(p, reach),
      climbUp: (target) => this.rigging.upTheNet(target),
      climbHold: (head, target) => this.rigging.holdOffset(head, target),
      groundHeight: (x, z, below) => {
        if (below !== undefined) {
          const nest = this.rigging?.nestFloorAt(x, z, below) ?? null
          if (nest !== null) return nest
        }
        const upper = this.quarterdeck?.groundAt(x, z, below) ?? null
        if (upper !== null) return upper
        const p = toLocal(x, z)
        if (p.z > STERN_Z || p.z < BOW_Z || Math.abs(p.x) > halfWidthAt(p.z)) return null
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
        if (this.rigging?.inNest(head)) {
          const q = ship.worldToLocal(local.copy(head))
          this.rigging.constrainInNest(q)
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
          if (p.z > cabinFront && Math.abs(p.x) < halfWidthAt(STERN_Z)) p.z = cabinFront
        } else {
          p.z = THREE.MathUtils.clamp(p.z, BOW_Z + 2.2, cabinFront)
          const half = halfWidthAt(p.z) - RAIL_MARGIN
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

