import * as THREE from 'three'
import type { GameContext, Stage } from '../core/Stage'
import type { Hand } from '../input/Hand'
import { LooseItem } from '../interaction/LooseItem'
import type { SwimEnvironment, WalkEnvironment } from '../movement/environment'
import levelData from '../data/levels/level3.json'
import type { LevelData } from '../systems/LevelProgress'
import type { CharacterClass } from '../systems/crew'
import type { BotTask } from '../bots/world'
import { makeItem } from '../systems/items'
import { TooHeavy } from '../level1/CaptainsCabin'
import { SeabedScene, SURFACE_Y, sandHeight } from '../world/SeabedScene'
import { applyCaustics } from '../world/caustics'
import { Reef, makeAmphora, type Boulder } from '../level2/Reef'
import { CAVE, CLIFF_Z, NORTH_TUNNEL, SHELVES, buildGrotto, caveFloor, constrainWalker, containInGrotto, grottoFloor, inCave, shelfAt, shelfColliders, type Shelf } from '../level3/Grotto'
import { LightShells } from '../level3/LightShells'
import { DiveLevel, type DiveLevelSetup } from './DiveLevel'

const LEVEL = levelData as LevelData
/** Arriving from the Seagrass Meadows: out in the open sea, facing the cliff. */
const SPAWN = new THREE.Vector3(0, 4.5, 40)
const VENT = new THREE.Vector3(-8, 0, 30)
const EXIT = new THREE.Vector3(0, 0, -46)
/** The boulder that blocks the old ones' way out, just inside the north passage. */
const BOULDER_AT = new THREE.Vector3(0, 5, -35.6)
const BOULDER_ASIDE = new THREE.Vector3(3.2, 3.2, -31.5)
const BOULDER_RADIUS = 1.5
/** The beam: from the glowing water near the arch, off three shells, onto the carved wall. */
const BEAM_SOURCE = new THREE.Vector3(2.5, SURFACE_Y + 0.05, -2)
const SHELL_SPOTS = [
  new THREE.Vector3(8, SURFACE_Y + 0.7 + 1.15, -14),
  new THREE.Vector3(1.5, SURFACE_Y + 0.9 + 1.15, -34),
  new THREE.Vector3(-8, SURFACE_Y + 0.7 + 1.15, -19),
]
const CARVING = new THREE.Vector3(-10.0, SURFACE_Y + 2.6, -8.5)
/** The niche beside the carving that slides open to show map piece IV. */
const NICHE = new THREE.Vector3(-8.7, SURFACE_Y + 0.7, -9.2)
const CLIMB_REACH = 0.55

const COINS_SEA: [number, number][] = [[4, 32], [-5, 26], [9, 22], [-12, 18], [14, 30], [-3, 16]]
const COINS_TUNNEL: [number, number, number][] = [[0.6, 5.3, 8], [-0.5, 5.3, 3]]
const COINS_POOL: [number, number][] = [[-2, -10], [3, -20], [-4, -26], [0, -16], [5, -8]]
const COINS_SHELVES: [number, number][] = [[9, -6], [7, -22], [-8, -13], [-9, -25], [3, -30]]
const COINS_CAMP: [number, number, number][] = [[-4.1, 0.8, -35.2], [5.2, 0.95, -36.4]]
type Look = 'sea' | 'air' | 'grottoWater' | 'grottoAir'

// Level 3, The Blue Grotto. Swim through a narrow arch in the sea cliff and a short dark tunnel, and
// surface inside a great cave whose water glows blue with the noon light pouring through the arch.
// Grip a ledge at the surface to climb out onto the rock shelves and walk; step off to drop back in.
// The riddle bounces a beam of that light off three polished shells onto a carved wall, which reveals
// map piece IV and the old ones' way out, a north passage the Strongman must unblock.
export class Level3Stage extends DiveLevel {
  readonly id = 'level3'
  readonly ownsWaterLook = true
  private world!: SeabedScene
  private shells!: LightShells
  private walkEnv!: WalkEnvironment
  private boulder!: THREE.Mesh
  private boulderCollider = { center: BOULDER_AT.clone(), radius: BOULDER_RADIUS }
  private boulderT = -1
  private carving!: THREE.Mesh
  private nicheDoor!: THREE.Mesh
  private nicheT = -1
  private mapPiece!: THREE.Group
  private rowboat!: THREE.Group
  private look: Look | null = null
  private readonly looks: Record<Look, { fog: THREE.Fog | THREE.FogExp2; background: THREE.Color }> = {
    sea: { fog: new THREE.FogExp2(0x0a4f7a, 0.06), background: new THREE.Color(0x0a4f7a) },
    air: { fog: new THREE.Fog(0xf1c28e, 60, 700), background: new THREE.Color(0xe9c79a) },
    grottoWater: { fog: new THREE.FogExp2(0x1d78d0, 0.045), background: new THREE.Color(0x1d78d0) },
    grottoAir: { fog: new THREE.FogExp2(0x0a2447, 0.028), background: new THREE.Color(0x051226) },
  }

  constructor(game: GameContext) {
    super(game, LEVEL)
  }

  // ---- World --------------------------------------------------------------------------------------

  protected buildWorld(): DiveLevelSetup {
    this.world = new SeabedScene(this.game.scene, this.root, this.bubbles, {
      height: sandHeight,
      sandSize: 150,
      seed: 31,
      rocks: 24,
      rockRing: [10, 34],
      seagrass: 3000,
      seagrassSpread: 30,
      seagrassClear: (x, z) => z < CLIFF_Z + 2 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 3,
      vent: VENT,
      godRays: false,
      surfaceSize: 0,
    })
    // No scattered rocks inside or against the cliff.
    this.world.removeRocks((c, r) => c.z < CLIFF_Z + 2 + r)
    this.rocks.push(...this.world.rocks.filter((r) => r.radius > 0))
    buildGrotto(this.root)
    const cliffRocks = new Reef(this.root, this.cliffBoulders(), 41)
    this.rocks.push(...cliffRocks.colliders)
    this.boxes.push(...shelfColliders())
    this.buildCamp()
    this.buildBoulder()

    // The glowing water lights the cave from below.
    const glow = new THREE.PointLight(0x3aa0ff, 70, 34, 1.4)
    glow.position.set(0, SURFACE_Y - 3, -17)
    this.root.add(glow)
    const campLight = new THREE.PointLight(0xffb45a, 6, 9, 1.6)
    campLight.position.set(-2.5, SURFACE_Y + 2.4, -35.5)
    this.root.add(campLight)

    this.walkEnv = {
      kind: 'walk',
      waterY: SURFACE_Y,
      groundHeight: (x, z, below) => {
        const s = shelfAt(x, z)
        if (!s) return null
        return below === undefined || below > s.y - 0.6 ? s.y : null
      },
      constrain: (head) => constrainWalker(head),
    }
    return {
      floorHeight: grottoFloor,
      radius: 80,
      refillZones: [{ center: VENT, radius: 1.8 }],
      checkpoint: SPAWN.clone(),
      gate: { position: EXIT, yaw: 0 },
      botRefill: VENT.clone().setY(sandHeight(VENT.x, VENT.z)),
      contain: containInGrotto,
    }
  }

  /** Boulders heaped along the cliff's foot and scattered up its face (none across the arch). */
  private cliffBoulders(): Boulder[] {
    const b: Boulder[] = []
    let s = 9
    const random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 70; i++) {
      const x = (random() - 0.5) * 90
      const y = random() < 0.6 ? random() * 6 - 1 : random() * 26
      if (Math.abs(x) < 4.5 && y < 10) continue
      const size = 1.5 + random() * 3.5
      b.push({ center: new THREE.Vector3(x, y, CLIFF_Z + size * 0.3), size: new THREE.Vector3(size, size * (0.6 + random() * 0.5), size * 0.7) })
    }
    return b
  }

  /** The smugglers' camp on the platform at the north end: crates, barrels, a cold fire, a rowboat. */
  private buildCamp(): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.85 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x3b2413, roughness: 0.9 })
    const y = SHELVES[1].y
    const crate = (x: number, z: number, s: number, yaw: number, stack = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), wood)
      m.position.set(x, y + s / 2 + stack, z)
      m.rotation.y = yaw
      this.root.add(m)
    }
    crate(-4.2, -36.8, 0.8, 0.2)
    crate(-4.1, -35.2, 0.7, -0.3)
    crate(-4.2, -36.8, 0.6, 0.5, 0.8)
    crate(5.3, -36.2, 0.9, 0.1)
    for (const [x, z] of [[-5.3, -33], [-5.8, -34.1]]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 12), dark)
      barrel.position.set(x, y + 0.4, z)
      this.root.add(barrel)
    }
    // A cold fire ring, and the smugglers' lantern still glowing faintly.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 1 }))
      stone.position.set(-1 + Math.cos(a) * 0.5, y + 0.08, -34.5 + Math.sin(a) * 0.5)
      this.root.add(stone)
    }
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xffa040, emissiveIntensity: 0.9 }))
    lantern.position.set(-2.5, y + 1.0, -35.5)
    this.root.add(lantern)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), dark)
    post.position.set(-2.5, y + 0.5, -35.5)
    this.root.add(post)
    // Amphorae the smugglers never shipped.
    for (const [x, z, yaw] of [[2.8, -37.2, 0.2], [3.5, -37.4, 1.1], [-6.4, -30.5, 2.2]]) {
      const amphora = makeAmphora()
      amphora.position.set(x, y + 0.12, z)
      amphora.rotation.set(0, yaw, Math.PI / 2 - 0.05)
      this.root.add(amphora)
    }

    // A rowboat tied up at the platform's edge, bobbing on the glowing water.
    this.rowboat = new THREE.Group()
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), wood)
    hull.scale.set(0.7, 0.4, 1.8)
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.3), dark)
    seat.position.y = -0.1
    this.rowboat.add(hull, seat)
    this.rowboat.position.set(4.5, SURFACE_Y + 0.15, -24.5)
    this.rowboat.rotation.y = 0.4
    this.root.add(this.rowboat)
    this.rocks.push({ center: new THREE.Vector3(4.5, SURFACE_Y - 0.1, -24.5), radius: 0.7 })

    // The carved wall: spirals, a sun over waves, and an arrow down into the water. Faint until lit.
    this.carving = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), new THREE.MeshStandardMaterial({ map: makeCarvingTexture(), roughness: 1, emissive: 0x000000 }))
    this.carving.position.copy(CARVING)
    this.carving.lookAt(CAVE.center.clone().setY(CARVING.y))
    this.root.add(this.carving)
    // The niche's stone door, and map piece IV behind it on a small ledge.
    const stone = new THREE.MeshStandardMaterial({ color: 0x6d665b, roughness: 1, flatShading: true })
    applyCaustics(stone, 0.3, { facing: 'down', tint: [0.3, 0.65, 1.0] })
    this.nicheDoor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.2), stone)
    this.nicheDoor.position.copy(NICHE).add(new THREE.Vector3(0, 0.45, 0))
    this.nicheDoor.lookAt(CAVE.center.clone().setY(this.nicheDoor.position.y))
    this.root.add(this.nicheDoor)
    this.mapPiece = makeItem('mapPiece')
    this.mapPiece.position.copy(NICHE).add(new THREE.Vector3(-0.35, 0.45, 0))
    this.mapPiece.rotation.y = Math.PI / 2
    this.mapPiece.visible = false
    this.root.add(this.mapPiece)
  }

  private buildBoulder(): void {
    const material = new THREE.MeshStandardMaterial({ color: 0x4b4540, roughness: 1, flatShading: true })
    applyCaustics(material, 0.4)
    this.boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(BOULDER_RADIUS, 1), material)
    this.boulder.position.copy(BOULDER_AT)
    this.root.add(this.boulder)
    this.rocks.push(this.boulderCollider)
  }

  protected arrive(env: SwimEnvironment): void {
    const { game } = this
    game.player.enter(env, SPAWN.clone(), 0, this.bubbles)
    game.hud.say('A sea cliff rises ahead, and low in its face, a dark arch...', 5)
    game.hud.say(`A new riddle on your map: "${LEVEL.riddle}"`, 7)
  }

  protected updateWorld(dt: number, elapsed: number): void {
    const head = this.game.camera.getWorldPosition(this.head)
    this.world.update(dt, elapsed, head)
    this.shells.update(elapsed)
    this.rowboat.position.y = SURFACE_Y + 0.15 + Math.sin(elapsed * 1.1) * 0.04
    this.rowboat.rotation.z = Math.sin(elapsed * 0.8) * 0.03
    if (this.mapPiece.visible) this.mapPiece.rotation.x = Math.sin(elapsed) * 0.1
    this.animateBoulder(dt)
    this.animateNiche(dt)
    this.updateLook(head)
  }

  /** Four looks: the open sea, above it, the grotto's glowing water, and the grotto's dim blue air. */
  private updateLook(head: THREE.Vector3): void {
    const inGrotto = head.z < CLIFF_Z
    const above = head.y > SURFACE_Y + 0.02
    const look: Look = inGrotto ? (above ? 'grottoAir' : 'grottoWater') : above ? 'air' : 'sea'
    if (look === this.look) return
    this.look = look
    const { scene, audio } = this.game
    scene.fog = this.looks[look].fog
    scene.background = this.looks[look].background
    audio.setEnvironment(above ? 'air' : 'water')
  }

  protected nextStage(): (() => Stage) | null {
    return null
  }

  protected levelInk(): string[] {
    return ['Hidden ink: a gem behind the smugglers\' crates, one in a dark nook deep in the grotto\'s pool, and one at the cliff\'s foot east of the arch.']
  }

  // ---- Puzzle -----------------------------------------------------------------------------------

  protected buildPuzzle(): void {
    const { game } = this
    this.shells = new LightShells(this.root, { source: BEAM_SOURCE, shells: SHELL_SPOTS, target: CARVING }, game.audio)
    for (const shell of this.shells.shells) this.grab.add(shell)
    this.shells.onLit = () => this.step('lightCarving')

    const heavy = this.grab.add(new TooHeavy(this.boulder, BOULDER_RADIUS + 0.2, () => this.boulderT < 0))
    heavy.onTry = () =>
      game.hud.now(
        game.party.character === 'strongman'
          ? 'A great boulder. You could heave it: press B beside it.'
          : 'It won\'t budge. The Strongman could heave it aside: point at the Strongman bot and pull the trigger to call it.',
        4,
      )

    this.grab.add(
      new LooseItem(this.mapPiece, {
        radius: 0.14,
        settle: 'home',
        onGrab: (hand) => {
          if (!this.mapPiece.visible) return true
          hand.pulse(0.8, 150)
          this.step('takeMapPiece')
          return true
        },
      }),
    )

    for (const [x, z] of COINS_SEA) this.placeOnSand('coin', x, z)
    for (const [x, y, z] of COINS_TUNNEL) this.place(this.root, 'coin', x, y, z)
    for (const [x, z] of COINS_POOL) this.place(this.root, 'coin', x, (caveFloor(x, z) ?? 0) + 0.15, z)
    for (const [x, z] of COINS_SHELVES) this.place(this.root, 'coin', x, (shelfAt(x, z)?.y ?? SURFACE_Y) + 0.12, z)
    for (const [x, y, z] of COINS_CAMP) this.place(this.root, 'coin', x, SHELVES[1].y + y, z)
    this.place(this.root, 'gem', -4.8, SHELVES[1].y + 0.12, -38.3) // behind the crates
    this.place(this.root, 'gem', -6.6, (caveFloor(-6.6, -21) ?? 3) + 0.25, -21) // the dark nook in the pool
    this.place(this.root, 'gem', 7, sandHeight(7, CLIFF_Z + 2) + 0.15, CLIFF_Z + 2) // the cliff's foot
    this.place(this.root, 'rune', 10, SHELVES[0].y + 0.15, -18)
    this.placeOnSand('rune', -14, 24)
  }

  protected updateLevel(dt: number): void {
    const { game } = this
    const head = game.camera.getWorldPosition(this.head)
    const player = game.player
    if (!this.progress.done.has('enterGrotto') && head.y > SURFACE_Y + 0.02 && inCave(head)) {
      this.step('enterGrotto')
      game.hud.now('The Blue Grotto! The water glows as if lit from below.', 5)
      this.teach('climb', game.inXr ? 'Grip the edge of a rock shelf at the surface to climb out.' : 'At the surface beside a rock shelf, press Space to climb out.', 6)
    }

    if (player.env?.kind === 'swim') this.tryClimbOut(head)
    else if (player.inWater) {
      // Stepped (or fell) off a shelf: back to swimming.
      player.switchEnvironment(this.env)
      player.noJump = false
      game.audio.play('splash', head, 0.6)
    }
    if (player.env?.kind === 'walk') player.noJump = true
    void dt
  }

  /** At the surface, a hand gripping a shelf's edge (or Space on the keyboard) climbs out onto it. */
  private tryClimbOut(head: THREE.Vector3): void {
    const { game } = this
    if (head.y < SURFACE_Y - 0.25 || !inCave(head)) return
    let shelf: Shelf | null = null
    let from: THREE.Vector3 | null = null
    for (const hand of game.hands) {
      if (!hand.connected || hand.held) continue
      const p = hand.worldPos(new THREE.Vector3())
      const s = shelfAt(p.x, p.z, CLIMB_REACH)
      const wanted = hand.virtual ? game.desktop.rise > 0 : hand.squeezePressed
      if (s && wanted && Math.abs(p.y - s.y) < 0.7) {
        shelf = s
        from = p
      }
    }
    if (!shelf || !from) return
    // Stand just inside the edge, where the hand was.
    const feet = new THREE.Vector3(
      THREE.MathUtils.clamp(from.x, shelf.x0 + 0.6, shelf.x1 - 0.6),
      shelf.y,
      THREE.MathUtils.clamp(from.z, shelf.z0 + 0.6, shelf.z1 - 0.6),
    )
    game.player.switchEnvironment(this.walkEnv)
    game.player.placeFeet(feet)
    for (const h of game.hands) h.pulse(0.4, 60)
    game.audio.play('splash', head, 0.4)
    this.teach('walk', 'You haul yourself up onto the rock. Walk with the left stick; step off the edge to dive back in.', 6)
  }

  // ---- The Strongman's heave ---------------------------------------------------------------------

  protected levelSkill(cls: CharacterClass, hand: Hand): boolean {
    if (cls !== 'strongman') return false
    const { game } = this
    const near = hand.worldPos(new THREE.Vector3()).distanceTo(this.boulder.position) < BOULDER_RADIUS + 0.9 || game.camera.getWorldPosition(this.head).distanceTo(this.boulder.position) < BOULDER_RADIUS + 2.8
    if (!near || this.boulderT >= 0) return false
    if (this.progress.nextStep?.id !== 'moveBoulder') {
      game.hud.now('You could shift it... but where would it lead? The riddle isn\'t solved yet.', 4)
      return true
    }
    if (!this.skill.trigger()) {
      game.hud.now(`Your strength is spent. Ready again in ${Math.ceil(this.skill.remaining)} s.`, 3)
      return true
    }
    for (const h of game.hands) h.pulse(1, 300)
    this.step('moveBoulder')
    return true
  }

  private animateBoulder(dt: number): void {
    if (this.boulderT < 0 || this.boulderT >= 1) return
    this.boulderT = Math.min(1, this.boulderT + dt / 2.5)
    const u = 1 - Math.pow(1 - this.boulderT, 3)
    this.boulder.position.lerpVectors(BOULDER_AT, BOULDER_ASIDE, u)
    this.boulder.rotation.z = -u * 1.3
    this.boulderCollider.center.copy(this.boulder.position)
  }

  private animateNiche(dt: number): void {
    if (this.nicheT < 0 || this.nicheT >= 1) return
    this.nicheT = Math.min(1, this.nicheT + dt / 2)
    this.nicheDoor.position.y = NICHE.y + 0.45 - this.nicheT * 1.0
  }

  // ---- Steps -------------------------------------------------------------------------------------

  protected applyLevelStep(id: string, who: string | null): void {
    const { game } = this
    if (id === 'lightCarving') {
      this.shells.solveNow()
      const m = this.carving.material as THREE.MeshStandardMaterial
      m.emissive.setHex(0x3a9df0)
      m.emissiveIntensity = 0.8
      this.mapPiece.visible = true
      if (this.catchingUp) {
        this.nicheT = 1
        this.nicheDoor.position.y = NICHE.y - 0.55
      } else {
        this.nicheT = 0
        game.audio.play('impact', CARVING, 0.6)
        game.hud.now(who ? `${who} lit the carving!` : 'The carving blazes blue! A stone slides aside beside it...', 4)
        game.hud.say(
          game.party.character === 'navigator'
            ? 'You read the old words in the carving: "Take the map, then roll the great stone from the north door; the way lies below."'
            : 'The carving shows a sun above the waves, and an arrow pointing down to a great stone at the grotto\'s north end.',
          6,
        )
      }
    }
    if (id === 'takeMapPiece') this.mapPiece.visible = false
    if (id === 'moveBoulder') {
      if (this.catchingUp) {
        this.boulderT = 1
        this.boulder.position.copy(BOULDER_ASIDE)
        this.boulderCollider.center.copy(BOULDER_ASIDE)
      } else {
        this.boulderT = 0
        game.audio.play('impact', this.boulder.position, 0.9)
        game.hud.now(who ? `${who} heaves the great stone aside!` : 'You heave the great stone aside. The passage beyond is open!', 4)
      }
    }
  }

  protected objective(): THREE.Vector3 {
    switch (this.progress.nextStep?.id) {
      case 'enterGrotto':
        return new THREE.Vector3(0, 6, CLIFF_Z)
      case 'lightCarving':
        // The shell where the beam stops: that's the one to turn next.
        return this.shells.shells[Math.max(0, this.shells.reached - 1)].center
      case 'takeMapPiece':
        return this.mapPiece.getWorldPosition(new THREE.Vector3())
      case 'moveBoulder':
        return this.boulder.position.clone()
      default:
        return this.gate.center
    }
  }

  /** Into the grotto through the arch; out of it by the north passage. */
  protected route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const outside = (p: THREE.Vector3) => p.z > CLIFF_Z
    const arch = [new THREE.Vector3(0, 6, CLIFF_Z + 3), new THREE.Vector3(0, 6, CLIFF_Z - 6), new THREE.Vector3(0, 6.5, -4)]
    if (outside(from) && !outside(to)) return [...arch, to]
    if (!outside(from) && outside(to)) return [...arch.reverse(), to]
    return [to]
  }

  /** Bots stay in the water (they don't climb out onto the shelves), and out of the closed passage. */
  protected botCanReach(p: THREE.Vector3): boolean {
    if (p.y > SURFACE_Y - 0.3) return false
    return !(p.z < NORTH_TUNNEL.z1 && this.boulderT < 0)
  }

  /** The Strongman bot heaves the boulder once the map piece is taken and a human is nearby. */
  protected botTask(): BotTask | null {
    if (this.progress.nextStep?.id !== 'moveBoulder' || this.boulderT >= 0) return null
    return {
      position: BOULDER_AT.clone().add(new THREE.Vector3(0, 0.5, 3)),
      skill: 'strongman',
      ready: this.humanHeads().some((h) => h.distanceTo(BOULDER_AT) < 10),
      act: (name: string) => {
        this.step('moveBoulder')
        this.game.hud.now(`${name} heaves the great stone aside!`, 4)
      },
    }
  }

  exit(): void {
    this.game.player.noJump = false
    super.exit()
  }
}

/** Old carvings: a sun over waves, spirals, and an arrow pointing down. */
function makeCarvingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 384
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#7b7a74'
  ctx.fillRect(0, 0, 512, 384)
  ctx.strokeStyle = '#34322d'
  ctx.lineWidth = 9
  ctx.lineCap = 'round'
  // The sun.
  ctx.beginPath()
  ctx.arc(256, 90, 42, 0, Math.PI * 2)
  ctx.stroke()
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(256 + Math.cos(a) * 55, 90 + Math.sin(a) * 55)
    ctx.lineTo(256 + Math.cos(a) * 75, 90 + Math.sin(a) * 75)
    ctx.stroke()
  }
  // Waves.
  for (const y of [180, 210]) {
    ctx.beginPath()
    for (let x = 60; x <= 452; x += 4) ctx.lineTo(x, y + Math.sin(x * 0.06) * 10)
    ctx.stroke()
  }
  // Spirals either side.
  for (const cx of [90, 422]) {
    ctx.beginPath()
    for (let a = 0; a < Math.PI * 6; a += 0.1) ctx.lineTo(cx + Math.cos(a) * a * 3.5, 290 + Math.sin(a) * a * 3.5)
    ctx.stroke()
  }
  // The arrow down to a round stone.
  ctx.beginPath()
  ctx.moveTo(256, 240)
  ctx.lineTo(256, 320)
  ctx.moveTo(236, 300)
  ctx.lineTo(256, 322)
  ctx.lineTo(276, 300)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(256, 350, 18, 0, Math.PI * 2)
  ctx.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
