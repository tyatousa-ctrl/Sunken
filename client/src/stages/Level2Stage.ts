import * as THREE from 'three'
import type { GameContext, Stage } from '../core/Stage'
import type { Hand } from '../input/Hand'
import { LooseItem } from '../interaction/LooseItem'
import type { SwimEnvironment } from '../movement/environment'
import levelData from '../data/levels/level2.json'
import type { LevelData } from '../systems/LevelProgress'
import type { Interactable } from '../interaction/GrabSystem'
import type { BotTask } from '../bots/world'
import { makeItem } from '../systems/items'
import { SeabedScene } from '../world/SeabedScene'
import { Particles } from '../fx/Particles'
import { DiveLevel, type DiveLevelSetup } from './DiveLevel'
import { Level3Stage } from './Level3Stage'
import { Turtle } from '../level2/Turtle'
import { StoneDoor, DIAL_SETS } from '../level2/StoneDoor'
import { Starfish } from '../level2/Starfish'
import { Reef, ReefFish, makeAmphora, type Boulder } from '../level2/Reef'

const LEVEL = levelData as unknown as LevelData & { code: string }
/** The door's code, read off the three dials left to right. */
const ANSWER = LEVEL.code
const RADIUS = 48
/** Where divers arrive: through the arch from Level 1, at the south edge, facing north. */
const SPAWN = new THREE.Vector3(0, 1.4, 36)
/** The door of stone, set into the reef ridge to the north (faces south). */
const DOOR = new THREE.Vector3(0, 0, -33)
/** The high reef: a tall pillar in the west with a downcurrent round it. */
const PILLAR = new THREE.Vector3(-26, 0, -8)
const PILLAR_TOP = 8.2
const DOWNCURRENT_RADIUS = 4.5
const DOWNCURRENT_FROM = 2.5
/** The air vent in the meadow. */
const VENT = new THREE.Vector3(10, 0, 10)
const VENT_RADIUS = 1.8
const EXIT = new THREE.Vector3(0, 0, -45)
/** Grip within this of the middle of the turtle's shell to hold on. */
const SHELL_REACH = 0.75

/** Rolling meadow sand, flat round the arrival point. */
export function meadowHeight(x: number, z: number): number {
  const rolling = 0.5 * Math.sin(x * 0.07 + 1) * Math.cos(z * 0.06) + 0.25 * Math.sin(x * 0.19 + z * 0.13) + 0.1 * Math.sin(x * 0.6 - z * 0.45)
  const flat = THREE.MathUtils.smoothstep(Math.hypot(x - SPAWN.x, z - SPAWN.z), 3, 9)
  return rolling * flat - 0.02
}

/** Height of the high reef's flat top (world). */
const pillarTop = () => meadowHeight(PILLAR.x, PILLAR.z) + PILLAR_TOP

/** Starfish on the sand (they curl up and glow when touched). */
const STARFISH: [number, number][] = [[8, 22], [-12, 18], [-6, -2], [14, -22]]
/**
 * Three big starfish, one mark of the code on each back, framed in its dial's shape: on two rocks
 * (`rock`: the rock's height above the sand) and on top of the high reef, where only the turtle goes.
 * `yaw` turns each so its mark reads the right way up from where divers usually come.
 */
const CLUES: { symbol: string; dial: number; at: [number, number]; yaw: number; rock?: number; pillar?: true }[] = [
  { symbol: '2', dial: 0, at: [21, -4], yaw: 0.9, rock: 1.35 },
  { symbol: 'C', dial: 1, at: [-20, -26], yaw: -0.4, rock: 1.05 },
  { symbol: '!', dial: 2, at: [PILLAR.x - 0.3, PILLAR.z - 0.2], yaw: 0.6, pillar: true },
]
const COINS: [number, number][] = [
  [3, 28], [-4, 24], [10, 16], [-14, 10], [18, 8], [-9, 0], [6, -6], [22, -12], [-18, -16], [12, -28],
  [-26, 14], [26, 20], [0, 12], [-3, -20], [16, 2], [-22, 4], [4, -16], [-10, 28],
]
/** Two coins sit in the hidden chamber. */
const CHAMBER_COINS: [number, number, number][] = [[-1.2, 0.35, -38.5], [1.3, 0.35, -38.8]]
const GEMS: { at: [number, number]; y: number; pillar?: true }[] = [
  // On the high reef, next to the marked starfish.
  { at: [PILLAR.x + 0.6, PILLAR.z + 0.3], y: 0.2, pillar: true },
  // By an amphora's mouth, east.
  { at: [30, -18], y: 0.45 },
  // Behind the door, beside the map piece.
  { at: [0.9, -39.2], y: 0.9 },
]
const RUNES: [number, number][] = [[-16, 22], [20, -18]]
const AMPHORAE: [number, number, number][] = [[29.5, -18, 0.4], [-14, 12, 2.1], [6, 30, 1.2], [-24, -20, 2.8]]

// Level 2, The Seagrass Meadows. Open Posidonia meadows with a rocky reef to the north and a loggerhead
// turtle gliding a loop round it all. The door of stone has three dials (numbers, letters, signs);
// three big starfish in the meadow each carry one mark of the code, framed in its dial's shape. One
// lies on top of the high reef, where the current drags divers down: grip the turtle's shell and she
// carries you up. Set the dials to 2, C, ! and map piece III waits in the chamber behind the door.
export class Level2Stage extends DiveLevel {
  readonly id = 'level2'
  private world!: SeabedScene
  private turtle!: Turtle
  private door!: StoneDoor
  private fishSchools!: ReefFish
  private readonly starfish: Starfish[] = []
  /** The three marked starfish, in code order. */
  private readonly clues: Starfish[] = []
  /** The hand holding the turtle's shell while you ride. */
  private riderHand: Hand | null = null
  /** A bot rode up the high reef: what it calls out when she arrives. */
  private botArrival: (() => void) | null = null
  private botRode = false
  private readonly turnedDials = new Set<number>()
  private wrongCooldown = 0
  private readonly current = new Particles({ max: 260, gravity: 0, drag: 0, blending: THREE.AdditiveBlending })
  private mapPiece!: THREE.Group
  private riding = false
  private currentTimer = 0

  constructor(game: GameContext) {
    super(game, LEVEL)
  }

  protected buildWorld(): DiveLevelSetup {
    const inDoorway = (x: number, z: number) => Math.abs(x - DOOR.x) < 5 && z < DOOR.z + 6
    this.world = new SeabedScene(this.game.scene, this.root, this.bubbles, {
      height: meadowHeight,
      sandSize: 130,
      seed: 11,
      rocks: 34,
      rockRing: [9, 42],
      seagrass: 9000,
      seagrassHeight: 1.3,
      seagrassSpread: 44,
      seagrassClear: (x, z) => Math.hypot(x - SPAWN.x, z - SPAWN.z) < 4 || inDoorway(x, z) || Math.hypot(x - PILLAR.x, z - PILLAR.z) < 3 || Math.hypot(x - VENT.x, z - VENT.z) < 2,
      vent: VENT,
      surfaceSize: 200,
    })
    // Scattered rocks must not block the doorway or sit on the pillar.
    this.world.removeRocks((c, r) => inDoorway(c.x, c.z) || Math.hypot(c.x - PILLAR.x, c.z - PILLAR.z) < 3 + r || Math.hypot(c.x - SPAWN.x, c.z - SPAWN.z) < 4 + r)
    this.rocks.push(...this.world.rocks.filter((r) => r.radius > 0))
    const reef = new Reef(this.root, this.reefBoulders())
    this.rocks.push(...reef.colliders)
    this.sealChamber()
    this.root.add(this.current.points)

    for (const [x, z, yaw] of AMPHORAE) {
      const amphora = makeAmphora()
      amphora.position.set(x, meadowHeight(x, z) + 0.12, z)
      amphora.rotation.set(0, yaw, Math.PI / 2 - 0.1)
      this.root.add(amphora)
    }

    // The loggerhead's loop passes most of the starfish (and the pillar), a gentle tour of the meadow.
    const loop = [
      [0, 3, 26], [9, 2.5, 20], [18, 3, 6], [20, 2.8, -6], [14, 3, -18], [2, 4, -24], [-14, 3.5, -22], [-24, 4, -12],
      [-20, 3, 2], [-12, 2.6, 16], [-4, 3, 22],
    ].map(([x, y, z]) => new THREE.Vector3(x, meadowHeight(x, z) + y, z))
    this.turtle = new Turtle(this.root, loop)
    this.fishSchools = new ReefFish(this.root, [
      { center: new THREE.Vector3(6, 3, 12), radius: 3, count: 24 },
      { center: new THREE.Vector3(-14, 4, -10), radius: 4, count: 30 },
      { center: new THREE.Vector3(16, 3.5, -20), radius: 2.5, count: 18 },
      { center: new THREE.Vector3(-4, 5, 30), radius: 3.5, count: 20 },
    ])

    // Three dials in a row before the door, read left to right as you face it.
    const dialSpots = [-2.1, 0, 2.1].map((x) => new THREE.Vector3(x, 0, 2.9))
    this.door = new StoneDoor(new THREE.Vector3(DOOR.x, meadowHeight(DOOR.x, DOOR.z) - 0.05, DOOR.z), this.game.audio, dialSpots)
    this.root.add(this.door.group)
    this.boxes.push(this.door.collider)

    return {
      floorHeight: meadowHeight,
      radius: RADIUS,
      refillZones: [{ center: VENT, radius: VENT_RADIUS }],
      checkpoint: SPAWN.clone(),
      gate: { position: EXIT, yaw: 0 },
      botRefill: VENT.clone().setY(meadowHeight(VENT.x, VENT.z)),
    }
  }

  /**
   * Solid walls round the chamber behind the door (the boulders leave gaps a diver could slip
   * through): a roof, two sides, and the back either side of the exit arch.
   */
  private sealChamber(): void {
    const y0 = meadowHeight(0, -39)
    const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
      const matrix = new THREE.Matrix4().makeTranslation(x, y0 + y, z)
      this.boxes.push({ matrix, inverse: matrix.clone().invert(), half: new THREE.Vector3(hx, hy, hz) })
    }
    box(0, 5.2, -39.5, 5.2, 0.6, 6.2) // roof
    box(-4.6, 2.5, -39.5, 0.4, 3, 6.2) // west wall
    box(4.6, 2.5, -39.5, 0.4, 3, 6.2) // east wall
    box(-3.6, 2.5, -45.3, 1.0, 3, 0.4) // back, beside the arch
    box(3.6, 2.5, -45.3, 1.0, 3, 0.4)
  }

  /** The reef: a ridge along the north with the door and a roofed chamber behind it, and the high pillar. */
  private reefBoulders(): Boulder[] {
    const b: Boulder[] = []
    const rock = (x: number, y: number, z: number, sx: number, sy: number, sz: number, level = false) =>
      b.push({ center: new THREE.Vector3(x, meadowHeight(x, z) + y, z), size: new THREE.Vector3(sx, sy, sz), level })
    // The ridge: two rows of big boulders either side of the doorway, stepping down at the ends.
    for (let x = -38; x <= 38; x += 3.4) {
      if (Math.abs(x) < 3.2) continue
      const end = THREE.MathUtils.smoothstep(Math.abs(x), 24, 38)
      const h = 3.2 - end * 1.6
      rock(x, h * 0.6, DOOR.z - 0.8, 2.2, h, 2.0)
      rock(x + 1.2, h * 1.35, DOOR.z - 2.2, 1.9, h * 0.9, 1.8)
      rock(x - 0.8, h * 0.4, DOOR.z + 1.0 + (x % 2), 1.4, 1.0, 1.3)
    }
    // Door frame: tall stones either side and a capstone across.
    rock(-2.6, 2.2, DOOR.z, 1.2, 2.6, 1.3)
    rock(2.6, 2.2, DOOR.z, 1.2, 2.6, 1.3)
    rock(0, 4.6, DOOR.z - 0.4, 3.4, 1.0, 1.6)
    // The chamber behind: walls and a roof of boulders, open only through the door and the exit arch.
    for (const z of [-36, -39.5, -42.5]) {
      rock(-4.2, 1.8, z, 1.8, 2.8, 1.9)
      rock(4.2, 1.8, z, 1.8, 2.8, 1.9)
    }
    for (const z of [-34.8, -37.2, -39.6, -42, -44.4]) rock(0, 5.4, z, 5.8, 1.3, 1.9, true)
    for (const z of [-37.5, -41.5]) for (const x of [-4.6, 4.6]) rock(x, 4.4, z, 1.6, 1.4, 2.4)
    for (const x of [-3.9, 3.9]) rock(x, 1.8, -45.2, 1.3, 2.8, 1.2)
    // The high reef: a column of boulders up to near the surface, with a flat top.
    // Wider at the foot, craggier going up, with a few shelves sticking out.
    for (let y = 0.8, i = 0; y < PILLAR_TOP - 0.6; y += 1.3, i++) {
      const w = 1.9 - y * 0.08 + (i % 2) * 0.25
      rock(PILLAR.x + Math.sin(i * 1.7) * 0.35, y, PILLAR.z + Math.cos(i * 1.3) * 0.35, w, 1.0 + (i % 3) * 0.15, w * 0.9)
      if (i % 2 === 1) rock(PILLAR.x + Math.cos(i * 2.1) * 1.3, y + 0.3, PILLAR.z + Math.sin(i * 2.1) * 1.3, 0.9, 0.5, 0.8)
    }
    rock(PILLAR.x, PILLAR_TOP - 0.4, PILLAR.z, 1.8, 0.4, 1.8, true)
    return b
  }

  protected arrive(env: SwimEnvironment): void {
    const { game } = this
    game.player.enter(env, SPAWN.clone(), 0, this.bubbles)
    game.hud.say('The Seagrass Meadows. Posidonia sways as far as you can see.', 5)
    game.hud.say(`A new riddle on your map: "${LEVEL.riddle}"`, 7)
  }

  protected updateWorld(dt: number, elapsed: number): void {
    const head = this.game.camera.getWorldPosition(this.head)
    this.world.update(dt, elapsed, head)
    this.turtle.update(dt)
    this.fishSchools.update(elapsed)
    this.door.update(dt)
    for (const s of this.starfish) s.update(dt, elapsed)
    this.current.update(dt, this.game.halfHeight)
    if (this.mapPiece.visible) this.mapPiece.rotation.y += dt
  }

  protected nextStage(): () => Stage {
    return () => new Level3Stage(this.game)
  }

  protected levelInk(): string[] {
    return ['Hidden ink: a gem waits on top of the high reef, one sleeps in an amphora to the east, and one lies behind the door of stone.']
  }

  /** A crewmate turned a dial, or the turtle set off with a rider. */
  protected onProp(key: string, v: number[]): void {
    const dial = /^dial(\d)$/.exec(key)?.[1]
    if (dial !== undefined) {
      const d = this.door.dials[Number(dial)]
      if (d) d.show(d.symbols[v[0]] ?? d.symbol)
    }
    if (key === 'turtle' && !this.turtle.riding) this.turtle.ride(this.pillarDropOff(), () => this.turtleArrived())
  }

  // ---- Puzzle -----------------------------------------------------------------------------------

  protected buildPuzzle(): void {
    STARFISH.forEach(([x, z], i) => this.starfish.push(new Starfish(this.root, new THREE.Vector3(x, meadowHeight(x, z) + 0.03, z), i)))
    CLUES.forEach((c, i) => {
      const [x, z] = c.at
      const y = (c.pillar ? pillarTop() : meadowHeight(x, z) + (c.rock ?? 0)) + 0.03
      const star = new Starfish(this.root, new THREE.Vector3(x, y, z), i + 1, new THREE.Euler(), 2.6)
      star.setMark(c.symbol, DIAL_SETS[c.dial].emblem, c.yaw)
      this.clues.push(star)
      this.starfish.push(star)
    })
    this.placeClueRocks()

    // Each dial starts on a wrong mark.
    ;['7', 'F', '#'].forEach((mark, i) => this.door.dials[i].show(mark))
    this.door.dials.forEach((dial, i) => {
      this.grab.add(dial)
      dial.onSet = () => {
        this.shareProp(`dial${i}`, [dial.value])
        this.onDial(i)
      }
    })
    // Grip the turtle's shell to ride her.
    this.grab.add(this.turtleShell())

    // Map piece III on a stone plinth in the chamber.
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0x6d665b, roughness: 1, flatShading: true }))
    plinth.position.set(0, meadowHeight(0, -39) + 0.4, -39)
    this.root.add(plinth)
    this.mapPiece = makeItem('mapPiece')
    this.mapPiece.position.set(0, meadowHeight(0, -39) + 1.0, -39)
    this.mapPiece.rotation.x = -0.4
    this.root.add(this.mapPiece)
    this.grab.add(
      new LooseItem(this.mapPiece, {
        radius: 0.14,
        settle: 'home',
        onGrab: (hand) => {
          if (!this.door.opened) return true
          hand.pulse(0.8, 150)
          this.step('takeMapPiece')
          return true
        },
      }),
    )

    for (const [x, z] of COINS) this.placeOnSand('coin', x, z)
    for (const [x, y, z] of CHAMBER_COINS) this.place(this.root, 'coin', x, meadowHeight(x, z) + y, z)
    for (const g of GEMS) {
      const [x, z] = g.at
      this.place(this.root, 'gem', x, (g.pillar ? pillarTop() : meadowHeight(x, z)) + g.y, z)
    }
    for (const [x, z] of RUNES) this.placeOnSand('rune', x, z)
  }

  /** The two marked starfish "on the rocks" need rocks under them. */
  private placeClueRocks(): void {
    const boulders: Boulder[] = []
    for (const s of CLUES) {
      if (!s.rock) continue
      const [x, z] = s.at
      // A boulder whose top is `rock` above the sand.
      boulders.push({ center: new THREE.Vector3(x, meadowHeight(x, z) + s.rock * 0.35, z), size: new THREE.Vector3(1.1, s.rock * 0.65, 1.0) })
    }
    const rocks = new Reef(this.root, boulders, 23)
    this.rocks.push(...rocks.colliders)
  }

  protected updateLevel(dt: number): void {
    const { game } = this
    const head = game.camera.getWorldPosition(this.head)

    // Touch a starfish (hand or face) and it glows from then on.
    for (const s of this.starfish) {
      const touched = s.touchedBy(head, true) || game.hands.some((h) => h.connected && s.touchedBy(h.worldPos(this.v), false))
      if (!touched || (s.counted && s.group.scale.x < 1)) continue
      if (!s.counted) for (const h of game.hands) h.pulse(0.2, 30)
      s.count()
    }

    // Came upon one of the marked starfish.
    this.clues.forEach((clue, i) => {
      if (head.distanceTo(clue.group.position) < 2.4) {
        this.teach(`clue${i}`, `A big starfish with a mark on its back, framed in a ${DIAL_SETS[CLUES[i].dial].emblem}, like the middle of one of the dials by the door.`, 6)
      }
    })

    // Found the door of stone.
    if (!this.progress.done.has('findDoor') && head.distanceTo(this.door.center) < 6) {
      this.step('findDoor')
      game.hud.now('A door of stone, carved with a circle, a square and a triangle. Three stone dials stand before it.', 5)
    }

    this.wrongCooldown = Math.max(0, this.wrongCooldown - dt)
    this.updateDowncurrent(dt, head)
    this.updateRide()
  }

  /** A dial settled on a mark. */
  private onDial(i: number): void {
    if (this.door.opened) return
    this.turnedDials.add(i)
    if (this.door.code === ANSWER) {
      if (!this.progress.done.has('findDoor')) this.step('findDoor')
      this.step('dialNumber')
      return
    }
    // Once all three have been tried, a wrong combination gets a (rare) grumble.
    if (this.turnedDials.size === 3 && this.wrongCooldown === 0) {
      this.wrongCooldown = 8
      this.game.hud.now(`${this.door.code.split('').join(' ')}... the dials click, but the door of stone doesn't move.`, 3)
    }
  }

  /** Near the high reef the water pours down: nobody swims up it (the turtle can). */
  private updateDowncurrent(dt: number, head: THREE.Vector3): void {
    const d = Math.hypot(head.x - PILLAR.x, head.z - PILLAR.z)
    const base = meadowHeight(PILLAR.x, PILLAR.z)
    // Standing on the top, you're out of it.
    const onTop = d < 1.9 && head.y > pillarTop()
    if (!this.riding && !onTop && d < DOWNCURRENT_RADIUS && head.y > base + DOWNCURRENT_FROM && head.y < pillarTop() + 1.5) {
      const strength = 1 - d / DOWNCURRENT_RADIUS
      this.game.rig.position.y -= (1.2 + 2.2 * strength) * dt
      const vel = this.game.player.physics.velocity
      if (vel.y > 0) vel.y *= 1 - Math.min(1, dt * 4)
      this.teach('downcurrent', 'The current round the pillar drags you down. Something might carry you up...', 5)
    }
    // Streaks of silt pouring down round the pillar show the current.
    this.currentTimer -= dt
    if (this.currentTimer <= 0) {
      this.currentTimer = 0.06
      const a = Math.random() * Math.PI * 2
      const r = 1.8 + Math.random() * (DOWNCURRENT_RADIUS - 1.8)
      const at = new THREE.Vector3(PILLAR.x + Math.cos(a) * r, pillarTop() + 1 + Math.random(), PILLAR.z + Math.sin(a) * r)
      this.current.emit({ position: at, velocity: new THREE.Vector3(0, -2.2, 0), spread: 0.1, color: 0x9fd8ee, size: 0.04, life: 3.2, count: 1, alpha: 0.5 })
    }
  }

  // ---- The turtle ride --------------------------------------------------------------------------

  /** Her shell, as something to grip: hold on and she carries you up the high reef. */
  private turtleShell(): Interactable {
    const center = new THREE.Vector3()
    return {
      pullable: false,
      grabGap: (point) => (this.riderHand ? Infinity : point.distanceTo(this.turtle.group.localToWorld(center.set(0, 0.2, 0))) - SHELL_REACH),
      grab: (hand) => this.mount(hand),
      release: (hand) => {
        if (hand === this.riderHand) this.dismount('You let go of the turtle.')
      },
      setHighlight: () => {},
    }
  }

  private mount(hand: Hand): void {
    const { game } = this
    this.riderHand = hand
    this.riding = true
    game.player.frozen = true
    hand.pulse(0.5, 80)
    if (!this.turtle.riding) {
      this.turtle.ride(this.pillarDropOff(), () => this.turtleArrived())
      this.shareProp('turtle', [1])
    }
    game.hud.now('You grab hold of her shell. Hold on: up she goes!', 3)
  }

  private dismount(message: string): void {
    const { game } = this
    if (!this.riding) return
    this.riding = false
    this.riderHand = null
    game.player.frozen = false
    game.player.physics.velocity.set(0, 0, 0)
    game.hud.now(message, 3)
  }

  /** She reached the top of the high reef: riders let go there. */
  private turtleArrived(): void {
    const hand = this.riderHand
    if (hand && hand.held) hand.held = null
    this.dismount('She sets you down on top of the high reef.')
    this.botArrival?.()
    this.botArrival = null
  }

  /** Where the turtle sets a rider down: just above the high reef's top, beside the marked starfish. */
  private pillarDropOff(): THREE.Vector3 {
    return new THREE.Vector3(PILLAR.x + 0.9, pillarTop() + 0.6, PILLAR.z + 1.1)
  }

  /** While riding, the diver moves with the turtle's shell. */
  private updateRide(): void {
    if (!this.riding) return
    const { game } = this
    const seat = this.turtle.seat(this.v)
    game.rig.updateMatrixWorld(true)
    const head = game.camera.getWorldPosition(this.head)
    // Keep the head just above her shell (eyes over the shell, body along it).
    game.rig.position.add(seat.add(new THREE.Vector3(0, 0.35, 0)).sub(head))
  }

  // ---- Steps -------------------------------------------------------------------------------------

  protected applyLevelStep(id: string, who: string | null): void {
    if (id === 'dialNumber') {
      this.door.dials.forEach((d, i) => d.show(ANSWER.match(/10|./g)![i]))
      const i = this.boxes.indexOf(this.door.collider)
      if (i >= 0) this.boxes.splice(i, 1)
      if (this.catchingUp) this.door.openNow()
      else {
        this.door.open()
        this.game.hud.now(who ? `${who} set the dials. The door of stone grinds down into the sand!` : 'The dials lock into place. The door of stone grinds down into the sand!', 4)
      }
    }
    if (id === 'takeMapPiece') this.mapPiece.visible = false
  }

  protected objective(): THREE.Vector3 {
    switch (this.progress.nextStep?.id) {
      case 'findDoor':
        return this.door.center
      case 'dialNumber':
        return this.door.dials[1].center
      case 'takeMapPiece':
        return this.mapPiece.getWorldPosition(new THREE.Vector3())
      default:
        return this.gate.center
    }
  }

  /** Bots stay out of the chamber until the door opens, and can't swim up the high reef's current. */
  protected botCanReach(p: THREE.Vector3): boolean {
    const inChamber = Math.abs(p.x) < 4.6 && p.z < DOOR.z - 0.3 && p.z > -45.5
    if (inChamber && !this.door.opened) return false
    const nearPillar = Math.hypot(p.x - PILLAR.x, p.z - PILLAR.z) < DOWNCURRENT_RADIUS
    return !(nearPillar && p.y > meadowHeight(PILLAR.x, PILLAR.z) + DOWNCURRENT_FROM)
  }

  /** Round the ridge's end rather than through it, when heading into the chamber. */
  protected route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const inChamber = (p: THREE.Vector3) => Math.abs(p.x) < 4 && p.z < DOOR.z - 0.5
    if (inChamber(to) && !inChamber(from)) return [new THREE.Vector3(0, 1.8, DOOR.z + 2.5), new THREE.Vector3(0, 1.6, DOOR.z - 2), to]
    if (inChamber(from) && !inChamber(to)) return [new THREE.Vector3(0, 1.6, DOOR.z - 2), new THREE.Vector3(0, 1.8, DOOR.z + 2.5), to]
    return [to]
  }

  /**
   * Once a human has been dragged down by the current (so they know the high reef matters), a bot
   * rides the turtle up and calls out that there's something up there, without saying what.
   */
  protected botTask(): BotTask | null {
    if (this.botRode || !this.taught.has('downcurrent') || this.turtle.riding) return null
    return {
      position: this.turtle.group.position.clone().add(new THREE.Vector3(0, 0.8, 0)),
      skill: 'fishWhisperer',
      ready: true,
      act: (name: string) => {
        this.botRode = true
        this.botArrival = () => this.game.hud.say(`${name}: "There's a big starfish up here on the high reef, with a mark on its back! Grab the turtle's shell and come and see."`, 5)
        this.turtle.ride(this.pillarDropOff(), () => this.turtleArrived())
        this.shareProp('turtle', [1])
        this.game.hud.now(`${name} catches hold of the turtle and rides her up the high reef.`, 3)
      },
    }
  }
}

