import * as THREE from 'three'
import type { GameContext, Stage } from '../core/Stage'
import type { Hand } from '../input/Hand'
import { LooseItem } from '../interaction/LooseItem'
import type { SwimEnvironment } from '../movement/environment'
import levelData from '../data/levels/level4.json'
import type { LevelData } from '../systems/LevelProgress'
import type { CharacterClass } from '../systems/crew'
import { makeItem } from '../systems/items'
import { SeabedScene } from '../world/SeabedScene'
import { DECK_Y, Galleon, STERN_Z, wreckColliders } from '../world/ship/Galleon'
import { Reef, type Boulder } from '../level2/Reef'
import { Lantern } from '../level4/Lantern'
import { Moray } from '../level4/Moray'
import { Particles } from '../fx/Particles'
import { DiveLevel, type DiveLevelSetup } from './DiveLevel'
import { VaultStage } from './VaultStage'

const LEVEL = levelData as LevelData
const RADIUS = 52
/** Arriving from the Blue Grotto's north passage: at the south edge, facing north into the gloom. */
const SPAWN = new THREE.Vector3(0, 4, 38)
const VENT = new THREE.Vector3(-9, 0, 22)
/** The trench: a crack in the seabed running east–west just north of the nameless wreck. */
const TRENCH = { z: -42, x0: -20, x1: 18, halfWidth: 2, depth: 5.5 }
const EXIT = new THREE.Vector3(TRENCH.x1 - 3, 0, TRENCH.z)
/** Where map piece V lies in the trench (the nameless lantern's light falls on it). */
const PIECE_AT = new THREE.Vector3(3, 0, TRENCH.z)
const CALM_SECONDS = 30
const CALM_RANGE = 4

interface WreckSpec {
  name: string | null
  position: [number, number, number]
  rotation: [number, number, number]
}
const WRECKS: WreckSpec[] = [
  { name: 'SANTA ROSALIA', position: [-21, -0.5, 6], rotation: [0.05, 1.15, 0.32] },
  { name: 'LA FORTUNA', position: [19, -0.6, -6], rotation: [-0.08, -0.75, -0.26] },
  { name: null, position: [-1, -0.4, -29], rotation: [0.04, 0.12, 0.14] },
]

const COINS: [number, number][] = [
  [3, 30], [-6, 26], [8, 20], [-14, 16], [14, 12], [-4, 10], [6, 2], [-10, -4], [11, -18], [-15, -14],
  [2, -12], [-8, -20], [16, -26], [-18, -30], [8, -36],
]
/** Coins on the wrecks' decks (wreck index, ship-local x, z). */
const DECK_COINS: [number, number, number][] = [[0, 1, -4], [0, -1.2, 3], [1, 0.8, -2], [1, -1, 5], [2, 1.5, 0]]
const TRENCH_COINS: [number, number][] = [[-12, TRENCH.z], [10, TRENCH.z + 0.6]]
const RUNES: [number, number][] = [[-12, 22], [12, -20]]

/** Seabed with gentle dunes, and the trench cut deep into it. */
export function graveyardFloor(x: number, z: number): number {
  const dunes = Math.sin(x * 0.21 + 0.4) * Math.cos(z * 0.17) * 0.45 + Math.sin(x * 0.7 + z * 0.5) * 0.08
  const flat = THREE.MathUtils.smoothstep(Math.hypot(x - SPAWN.x, z - SPAWN.z), 3, 9)
  const base = dunes * flat - 0.02
  const across = 1 - THREE.MathUtils.smoothstep(Math.abs(z - TRENCH.z), TRENCH.halfWidth, TRENCH.halfWidth + 2.2)
  const along = THREE.MathUtils.smoothstep(x, TRENCH.x0, TRENCH.x0 + 4) * (1 - THREE.MathUtils.smoothstep(x, TRENCH.x1 - 2, TRENCH.x1 + 2))
  return base - TRENCH.depth * across * along
}

// Level 4, The Wreck Graveyard. Dark, deep water where three wrecks lie in the sand, moray eels in their
// hulls. The riddle: "Three ships lie still; the one with no name holds the flame." Two sterns carry
// their names; the third's has been scratched off. Each wreck has an old lantern at her stern: the named
// ships' lanterns sputter out, but the nameless one's burns, and its light shows map piece V lying in
// the trench beside her. The trench runs east to the way out, toward the treasure vault.
export class Level4Stage extends DiveLevel {
  readonly id = 'level4'
  private world!: SeabedScene
  private readonly wrecks: Galleon[] = []
  private readonly lanterns: Lantern[] = []
  private readonly eels: Moray[] = []
  private readonly sparks = new Particles({ max: 200, gravity: -2, drag: 1, blending: THREE.AdditiveBlending })
  private nameless!: THREE.Mesh
  private beam!: THREE.Mesh
  private spot!: THREE.SpotLight
  private mapPiece!: THREE.Group
  private readonly pushBack = new THREE.Vector3()

  constructor(game: GameContext) {
    super(game, LEVEL)
  }

  // ---- World --------------------------------------------------------------------------------------

  protected buildWorld(): DiveLevelSetup {
    this.world = new SeabedScene(this.game.scene, this.root, this.bubbles, {
      height: graveyardFloor,
      sandSize: 140,
      seed: 53,
      rocks: 40,
      rockRing: [8, 46],
      seagrass: 600,
      seagrassSpread: 40,
      seagrassClear: (x, z) => Math.abs(z - TRENCH.z) < 6 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 4,
      vent: VENT,
      godRays: false,
      sandColor: 0x6b6352,
      sandCaustics: 0.15,
    })
    // Deep and dark: dim light, murky blue-black water.
    const { scene } = this.game
    scene.background = new THREE.Color(0x03101a)
    scene.fog = new THREE.FogExp2(0x03101a, 0.085)
    for (const child of this.root.children) {
      if (child instanceof THREE.HemisphereLight) child.intensity = 0.9
      if (child instanceof THREE.DirectionalLight) child.intensity = 0.45
    }
    this.world.removeRocks((c, r) => Math.abs(c.z - TRENCH.z) < TRENCH.halfWidth + 2 + r || this.nearWreck(c, r + 5))
    this.rocks.push(...this.world.rocks.filter((r) => r.radius > 0))
    this.root.add(this.sparks.points)

    WRECKS.forEach((spec, i) => this.buildWreck(spec, i))
    // The two rock-dwelling morays' boulders (their holes open on the near side).
    const eelRocks: Boulder[] = [
      { center: new THREE.Vector3(-7.1, graveyardFloor(-7.1, 3.7) + 0.7, 3.7), size: new THREE.Vector3(2, 1.6, 1.8) },
      { center: new THREE.Vector3(9.7, graveyardFloor(9.7, -31.1) + 0.7, -31.1), size: new THREE.Vector3(1.9, 1.5, 1.8) },
    ]
    const rim = new Reef(this.root, [...this.trenchRim(), ...eelRocks], 61)
    this.rocks.push(...rim.colliders)

    // Morays: in two of the wrecks' hulls, one under the nameless stern, and two among the rocks.
    const hull = (i: number, x: number, y: number, z: number, out: THREE.Vector3) => {
      const g = this.wrecks[i].group
      g.updateMatrixWorld(true)
      return [g.localToWorld(new THREE.Vector3(x, y, z)), out.transformDirection(g.matrixWorld)] as const
    }
    for (const [at, facing] of [
      hull(0, 3.3, DECK_Y - 1.2, -3, new THREE.Vector3(1, 0, 0)),
      hull(1, -3.3, DECK_Y - 1.1, 2, new THREE.Vector3(-1, 0, 0)),
      hull(2, 2.2, DECK_Y - 1.4, STERN_Z - 0.3, new THREE.Vector3(0.3, 0, 1)),
      [new THREE.Vector3(-6, graveyardFloor(-6, 4) + 0.6, 4), new THREE.Vector3(1, 0.2, 0.3)] as const,
      [new THREE.Vector3(9, graveyardFloor(9, -30) + 0.6, -30), new THREE.Vector3(-0.6, 0.2, 1)] as const,
    ]) {
      this.eels.push(new Moray(this.root, at, facing))
      this.rocks.push({ center: at.clone(), radius: 0.35 })
    }

    return {
      floorHeight: graveyardFloor,
      radius: RADIUS,
      refillZones: [{ center: VENT, radius: 1.8 }],
      checkpoint: SPAWN.clone(),
      gate: { position: EXIT, yaw: -Math.PI / 2 },
      botRefill: VENT.clone().setY(graveyardFloor(VENT.x, VENT.z)),
    }
  }

  private nearWreck(c: THREE.Vector3, r: number): boolean {
    return WRECKS.some((w) => Math.hypot(c.x - w.position[0], c.z - w.position[2]) < 10 + r)
  }

  /** A wreck half-sunk in the sand: masts broken, her name on the stern (or scratched off), a lantern. */
  private buildWreck(spec: WreckSpec, index: number): void {
    const wreck = new Galleon({ hollowCabin: true })
    wreck.mainmast.rotation.z = index === 1 ? -1.2 : 0.25
    wreck.mainmast.scale.y = index === 0 ? 0.55 : 1
    wreck.foremast.rotation.z = index === 2 ? 1.4 : -0.3
    wreck.foremast.position.y = DECK_Y - 0.6
    wreck.mergeAll()
    wreck.group.position.set(...spec.position)
    wreck.group.rotation.set(...spec.rotation)
    wreck.group.scale.setScalar(0.92)
    this.root.add(wreck.group)
    this.wrecks.push(wreck)
    wreck.group.updateMatrixWorld(true)
    for (const box of wreckColliders()) {
      const matrix = new THREE.Matrix4().makeTranslation(box.center.x, box.center.y, box.center.z).premultiply(wreck.group.matrixWorld)
      this.boxes.push({ matrix, inverse: matrix.clone().invert(), half: box.half.clone() })
    }

    // Her name, painted across the stern.
    // Faintly lit by its own old gilt, so it can be read in the gloom.
    const nameTexture = makeNameBoard(spec.name)
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.55), new THREE.MeshStandardMaterial({ map: nameTexture, emissiveMap: nameTexture, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.9 }))
    board.position.set(0, DECK_Y - 0.4, STERN_Z + 0.45)
    wreck.shake.add(board)
    if (!spec.name) this.nameless = board

    // The lantern, hanging from an iron arm at the stern.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.7), new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.5, metalness: 0.6 }))
    arm.position.set(2.4, DECK_Y + 2.55, STERN_Z + 0.2)
    wreck.shake.add(arm)
    const lantern = new Lantern(wreck.shake, new THREE.Vector3(2.4, DECK_Y + 2.2, STERN_Z + 0.5), !spec.name, this.game.audio, this.sparks)
    this.lanterns.push(lantern)
  }

  /** Boulders along the trench's lips, so it reads as a crack in the rock. */
  private trenchRim(): Boulder[] {
    const b: Boulder[] = []
    let s = 7
    const random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let x = TRENCH.x0 + 2; x < TRENCH.x1 - 1; x += 2.2) {
      for (const side of [-1, 1]) {
        if (Math.abs(x - EXIT.x) < 3) continue
        const z = TRENCH.z + side * (TRENCH.halfWidth + 1.6 + random())
        const size = 1.2 + random() * 1.4
        b.push({ center: new THREE.Vector3(x + random(), graveyardFloor(x, z) + size * 0.2, z), size: new THREE.Vector3(size, size * 0.6, size * 0.9) })
      }
    }
    return b
  }

  protected arrive(env: SwimEnvironment): void {
    const { game } = this
    game.player.enter(env, SPAWN.clone(), 0, this.bubbles)
    game.hud.say('Cold, dark water. Shapes of great ships loom out of the gloom ahead...', 5)
    game.hud.say(`A new riddle on your map: "${LEVEL.riddle}"`, 7)
  }

  protected updateWorld(dt: number, elapsed: number): void {
    const head = this.game.camera.getWorldPosition(this.head)
    this.world.update(dt, elapsed, head)
    for (const l of this.lanterns) l.update(dt)
    this.sparks.update(dt, this.game.halfHeight)
    if (this.mapPiece.visible) this.mapPiece.rotation.y += dt * 0.8
    if (this.beam.visible) (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.13 + Math.sin(elapsed * 3) * 0.02
  }

  protected nextStage(): () => Stage {
    return () => new VaultStage(this.game)
  }

  protected levelInk(): string[] {
    return ['Hidden ink: a gem in the Santa Rosalia\'s cabin, one in La Fortuna\'s, and one at the dark west end of the trench.']
  }

  // ---- Puzzle -----------------------------------------------------------------------------------

  protected buildPuzzle(): void {
    const { game } = this
    for (const lantern of this.lanterns) {
      this.grab.add(lantern)
      lantern.onGutter = () => game.hud.now('The flame sputters... and dies. The wick is rotten through. Wrong ship?', 3)
    }
    const real = this.lanterns[2]
    real.onLit = () => this.step('lightLantern')

    // Map piece V in the trench, unseen in the dark until the lantern's light falls on it.
    this.mapPiece = makeItem('mapPiece')
    this.mapPiece.position.copy(PIECE_AT).setY(graveyardFloor(PIECE_AT.x, PIECE_AT.z) + 0.5)
    this.mapPiece.visible = false
    this.root.add(this.mapPiece)
    this.grab.add(
      new LooseItem(this.mapPiece, {
        radius: 0.16,
        settle: 'home',
        onGrab: (hand) => {
          if (!this.mapPiece.visible) return true
          hand.pulse(0.8, 150)
          this.step('takeMapPiece')
          return true
        },
      }),
    )
    // The lantern's light: a warm shaft from the nameless stern down onto the piece.
    const from = real.center
    const to = this.mapPiece.position.clone()
    this.spot = new THREE.SpotLight(0xffc27a, 0, 30, 0.22, 0.5, 1)
    this.spot.position.copy(from)
    this.spot.target.position.copy(to)
    this.root.add(this.spot, this.spot.target)
    const length = from.distanceTo(to)
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.9, length, 16, 1, true).translate(0, -length / 2, 0),
      new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    this.beam.position.copy(from)
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize())
    this.beam.visible = false
    this.root.add(this.beam)

    for (const [x, z] of COINS) this.placeOnSand('coin', x, z)
    for (const [i, x, z] of DECK_COINS) this.place(this.wrecks[i].shake, 'coin', x, DECK_Y + 0.14, z)
    for (const [x, z] of TRENCH_COINS) this.placeOnSand('coin', x, z)
    // Gems: in the two named wrecks' cabins, and at the dark west end of the trench.
    this.place(this.wrecks[0].shake, 'gem', -1.8, DECK_Y + 0.3, 11.5)
    this.place(this.wrecks[1].shake, 'gem', 1.9, DECK_Y + 0.3, 11.2)
    this.placeOnSand('gem', TRENCH.x0 + 4, TRENCH.z)
    for (const [x, z] of RUNES) this.placeOnSand('rune', x, z)
  }

  protected updateLevel(dt: number): void {
    const { game } = this
    const head = game.camera.getWorldPosition(this.head)

    // Reading the sterns: close to the scratched-off one, the first step.
    if (!this.progress.done.has('findNameless') && head.distanceTo(this.nameless.getWorldPosition(this.v)) < 5) {
      this.step('findNameless')
      game.hud.now('This stern\'s name has been scratched away, letter by letter. A ship with no name...', 5)
    }
    for (const [i, lantern] of this.lanterns.entries()) {
      if (head.distanceTo(lantern.center) < 3) this.teach(`lantern${i}`, 'An old ship\'s lantern, still with oil in it. Grip it and pull the trigger to strike its flint.', 5)
      // A Light Orb brought close lights it too.
      if (!lantern.lit && this.magic.orbWithin(lantern.center, 1.3)) lantern.strike(null)
    }

    // The morays: too close and one lunges, shoving you back.
    for (const eel of this.eels) {
      if (!eel.update(dt, head)) continue
      this.pushBack.copy(head).sub(eel.group.getWorldPosition(this.v)).setLength(1.1)
      game.rig.position.add(this.pushBack)
      for (const h of game.hands) h.pulse(0.9, 120)
      game.audio.play('thud', head, 0.8)
      this.teach('eel', 'A moray eel! They guard their holes. Give them room, or let the Fish Whisperer calm them (B).', 5)
    }
    void dt
  }

  // ---- The Fish Whisperer calms the eels ------------------------------------------------------------

  protected levelSkill(cls: CharacterClass, _hand: Hand): boolean {
    if (cls !== 'fishWhisperer') return false
    const head = this.game.camera.getWorldPosition(this.head)
    const near = this.eels.filter((e) => e.distanceTo(head) < CALM_RANGE)
    if (near.length === 0) return false
    if (!this.skill.trigger()) {
      this.spent()
      return true
    }
    for (const eel of near) eel.soothe(CALM_SECONDS)
    this.game.hud.now(`You hum softly. The moray${near.length > 1 ? 's' : ''} settle${near.length > 1 ? '' : 's'} back into ${near.length > 1 ? 'their holes' : 'its hole'}.`, 3)
    return true
  }

  // ---- Steps -------------------------------------------------------------------------------------

  protected applyLevelStep(id: string, who: string | null): void {
    const { game } = this
    if (id === 'lightLantern') {
      this.lanterns[2].lightNow()
      this.mapPiece.visible = true
      this.beam.visible = true
      this.spot.intensity = 40
      if (!this.catchingUp) {
        game.hud.now(who ? `${who} lit the nameless ship's lantern!` : 'The lantern blazes up! Its light falls down into the trench... something glints there.', 5)
      }
    }
    if (id === 'takeMapPiece') {
      this.mapPiece.visible = false
      this.beam.visible = false
    }
  }

  protected objective(): THREE.Vector3 {
    switch (this.progress.nextStep?.id) {
      case 'findNameless':
        return this.nameless.getWorldPosition(new THREE.Vector3())
      case 'lightLantern':
        return this.lanterns[2].center
      case 'takeMapPiece':
        return this.mapPiece.getWorldPosition(new THREE.Vector3())
      default:
        return this.gate.center
    }
  }
}

/** A stern board: the ship's name in faded gilt, or scratched out to nothing. */
function makeNameBoard(name: string | null): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 216
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#2d2016'
  ctx.fillRect(0, 0, 1024, 216)
  ctx.strokeStyle = '#6b5234'
  ctx.lineWidth = 10
  ctx.strokeRect(8, 8, 1008, 200)
  ctx.font = 'bold 118px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#c9a24a'
  if (name) {
    ctx.fillText(name, 512, 112)
  } else {
    // Letters gouged away: a faint ghost of gilt under deep scratches.
    ctx.globalAlpha = 0.18
    ctx.fillText('S  N  A', 512, 112)
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#140d08'
    let seed = 11
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 90; i++) {
      ctx.lineWidth = 3 + rand() * 7
      const x = 120 + rand() * 784
      const y = 50 + rand() * 120
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + (rand() - 0.5) * 140, y + (rand() - 0.5) * 70)
      ctx.stroke()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
