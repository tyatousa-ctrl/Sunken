import * as THREE from 'three'
import type { GameContext, Stage } from '../core/Stage'
import type { Hand } from '../input/Hand'
import { LooseItem } from '../interaction/LooseItem'
import { CABIN, CaptainsCabin, TooHeavy } from '../level1/CaptainsCabin'
import type { SwimEnvironment } from '../movement/environment'
import levelData from '../data/levels/level1.json'
import type { LevelData } from '../systems/LevelProgress'
import type { CharacterClass } from '../systems/crew'
import type { BotTask } from '../bots/world'
import { SANDBOX_RADIUS, SeabedScene, SURFACE_Y, VENT_POSITION, VENT_RADIUS, sandHeight } from '../world/SeabedScene'
import { CABIN_FRONT_Z, CABIN_INTERIOR, DECK_Y, Galleon, wreckColliders } from '../world/ship/Galleon'
import { DiveLevel, type DiveLevelSetup } from './DiveLevel'
import { Level2Stage } from './Level2Stage'

const LEVEL = levelData as LevelData
const WRECK_REST = new THREE.Vector3(7, 1.2, -13)
const WRECK_YAW = 0.5
const WRECK_ROLL = 0.22
const WRECK_PITCH = -0.06
const WRECK_START_Y = SURFACE_Y - 1.5
const SINK_SECONDS = 22
const GATE_POSITION = new THREE.Vector3(-20, 0, -24)
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
  [0, DECK_Y + 16 * 0.525 + 0.3, 0],
  // Tucked in the cabin corner, at the figurehead's feet.
  [-3.1, DECK_Y + 0.1, 10.1],
]
const SEABED_GEMS: [number, number][] = [[-26, 8]]
/** Tide runes: mana for spells (one on deck, two on the seabed). */
const WRECK_RUNES: [number, number, number][] = [[1.2, DECK_Y + 0.12, -1]]
const SEABED_RUNES: [number, number][] = [[6, -3.5], [-8, 4]]

// Level 1, The Sinking Galleon (the tutorial level). The galleon settles on the seabed; the map's
// first riddle leads into the captain's cabin, where the Strongman heaves the stone figurehead aside,
// the key underneath opens the captain's chest, and map piece II opens the way on.
export class Level1Stage extends DiveLevel {
  readonly id = 'level1'
  private readonly wreck = new Galleon({ hollowCabin: true })
  private world!: SeabedScene
  private cabin!: CaptainsCabin
  private keyItem!: LooseItem
  private sinkTime = 0
  private settled = false
  private lockNagCooldown = 0

  constructor(
    game: GameContext,
    private readonly arrivedFromShip: boolean,
  ) {
    super(game, LEVEL)
  }

  protected buildWorld(): DiveLevelSetup {
    this.world = new SeabedScene(this.game.scene, this.root, this.bubbles)
    this.rocks.push(...this.world.rocks)

    // The wreck: foremast shot away in the attack, everything static merged, cabin contents on top.
    this.wreck.foremast.rotation.z = 1.35
    this.wreck.foremast.position.y = DECK_Y - 0.8
    this.wreck.mergeAll()
    this.wreck.group.position.set(WRECK_REST.x, this.arrivedFromShip ? WRECK_START_Y : WRECK_REST.y, WRECK_REST.z)
    this.wreck.group.rotation.set(this.arrivedFromShip ? 0 : WRECK_PITCH, WRECK_YAW, this.arrivedFromShip ? 0.05 : WRECK_ROLL)
    this.root.add(this.wreck.group)
    this.clearRocksUnderWreck()
    this.cabin = new CaptainsCabin(this.wreck.shake, this.game.audio)
    return {
      floorHeight: sandHeight,
      radius: SANDBOX_RADIUS,
      refillZones: [{ center: VENT_POSITION, radius: VENT_RADIUS }],
      checkpoint: new THREE.Vector3(0, 0.8, 2),
      gate: { position: GATE_POSITION, yaw: Math.atan2(-GATE_POSITION.x, -GATE_POSITION.z) },
      botRefill: VENT_POSITION.clone().setY(sandHeight(VENT_POSITION.x, VENT_POSITION.z)),
    }
  }

  protected arrive(env: SwimEnvironment): void {
    const { game } = this
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
    game.hud.say(
      game.inXr
        ? 'Your backpack: press A or X (or reach over your shoulder and grip) to open it. Look at a controller to see what its buttons do.'
        : 'Your backpack: press R to open it. The keys are listed in the corner.',
      7,
    )
  }

  protected updateWorld(dt: number, elapsed: number): void {
    this.world.update(dt, elapsed, this.game.camera.getWorldPosition(this.head))
    this.cabin.update(dt)
    this.updateWreck(dt)
  }

  protected nextStage(): () => Stage {
    return () => new Level2Stage(this.game)
  }

  protected levelInk(): string[] {
    return ["Hidden ink: gems glint in the crow's nest, in the cabin corner by the door, and far out to the west."]
  }

  // ---- The Strongman's heave --------------------------------------------------------------------

  protected levelSkill(cls: CharacterClass, hand: Hand): boolean {
    if (cls !== 'strongman') return false
    const { game } = this
    const target = this.cabin.figurehead.getWorldPosition(this.v)
    const near = hand.worldPos(new THREE.Vector3()).distanceTo(target) < HEAVE_REACH || game.camera.getWorldPosition(this.head).distanceTo(target) < 1.5
    if (!near || this.cabin.lifted) {
      game.hud.now('Nothing heavy to lift here.', 2)
      return true
    }
    if (!this.skill.trigger()) {
      game.hud.now(`Your strength is spent. Ready again in ${Math.ceil(this.skill.remaining)} s.`, 3)
      return true
    }
    for (const h of game.hands) h.pulse(1, 300)
    this.step('enterCabin')
    this.step('liftFigurehead')
    game.hud.now('You heave the stone maiden aside... something glints where she lay.', 4)
    return true
  }

  // ---- Puzzle -----------------------------------------------------------------------------------

  protected buildPuzzle(): void {
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
        this.step('takeMapPiece')
        return true
      },
    })
    this.grab.add(piece)
    for (const coin of this.cabin.chestCoins) this.addCollectible(coin, 'coin')

    for (const [x, y, z] of WRECK_COINS) this.place(this.wreck.shake, 'coin', x, y, z)
    for (const [x, z] of SEABED_COINS) this.placeOnSand('coin', x, z)
    for (const [x, y, z] of WRECK_GEMS) this.place(this.wreck.shake, 'gem', x, y, z)
    for (const [x, z] of SEABED_GEMS) this.placeOnSand('gem', x, z)
    for (const [x, y, z] of WRECK_RUNES) this.place(this.wreck.shake, 'rune', x, y, z)
    for (const [x, z] of SEABED_RUNES) this.placeOnSand('rune', x, z)
  }

  protected updateLevel(dt: number): void {
    const { game } = this
    this.lockNagCooldown = Math.max(0, this.lockNagCooldown - dt)
    const head = game.camera.getWorldPosition(this.head)

    // Found where the captain slept.
    if (!this.progress.done.has('enterCabin') && this.inCabin(head)) {
      this.step('enterCabin')
      game.hud.now("The captain's cabin. His bunk is still here...", 4)
    }

    // The chest lock: the key in hand, or an empty hand with the key in the backpack.
    if (this.cabin.lifted && !this.cabin.unlocked) {
      const lock = this.cabin.lock.getWorldPosition(this.v)
      for (const hand of game.hands) {
        if (!hand.connected) continue
        const d = hand.worldPos(new THREE.Vector3()).distanceTo(lock)
        if (hand.held === this.keyItem && d < 0.18) {
          this.backpack.forget(this.keyItem)
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
  }

  private unlockChest(hand: Hand): void {
    hand.pulse(0.6, 80)
    this.step('openChest')
    this.game.hud.now('The lock gives with a clunk. The lid creaks open.', 3)
  }

  protected applyLevelStep(id: string, who: string | null, byOther: boolean): void {
    if (id === 'liftFigurehead') {
      this.cabin.lift()
      if (who) this.game.hud.now(`${who} heaved the figurehead aside!`, 3)
    }
    if (id === 'takeKey') {
      if (byOther) {
        // Someone else has the key now; ours disappears so there's only ever one.
        this.cabin.keyTaken = true
        if (this.keyItem.heldBy) this.grab.drop(this.keyItem.heldBy)
        this.keyItem.goHome()
        this.keyItem.enabled = false
        this.keyItem.object.visible = false
        if (who) this.game.hud.now(`${who} took the key.`, 3)
      } else if (this.game.net) {
        this.teach('key', 'The key! Keep hold of it, or stow it in your backpack by letting go over your shoulder.')
      }
    }
    if (id === 'openChest') {
      this.cabin.unlock()
      if (who) this.game.hud.now(`${who} opened the captain's chest.`, 3)
    }
    if (id === 'takeMapPiece') this.cabin.mapPiece.visible = false
  }

  protected objective(): THREE.Vector3 {
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

  // ---- Bots ---------------------------------------------------------------------------------------

  /** The Strongman bot heaves the figurehead, once a human has found the cabin. */
  protected botTask(): BotTask | null {
    if (!this.settled || this.cabin.lifted || this.progress.nextStep?.id !== 'liftFigurehead') return null
    return {
      position: this.wreck.group.localToWorld(CABIN.figurehead.clone().add(new THREE.Vector3(0.9, 0.7, -0.1))),
      skill: 'strongman',
      ready: this.humanHeads().some((h) => this.inCabin(h)),
      act: (name: string) => {
        this.step('liftFigurehead')
        this.game.hud.now(`${name} heaves the stone maiden aside!`, 4)
      },
    }
  }

  private inCabin(p: THREE.Vector3): boolean {
    const local = this.wreck.group.worldToLocal(p.clone()).sub(CABIN_INTERIOR.center)
    const h = CABIN_INTERIOR.half
    return Math.abs(local.x) < h.x && Math.abs(local.y) < h.y && Math.abs(local.z) < h.z
  }

  /** Waypoints that go through the cabin doorway rather than its walls. */
  protected route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
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
}
