import * as THREE from 'three'
import type { MapArea } from '../ui/MiniMap'
import type { GameContext, Stage } from '../core/Stage'
import type { Interactable } from '../interaction/GrabSystem'
import { LooseItem } from '../interaction/LooseItem'
import type { SwimEnvironment, WalkEnvironment } from '../movement/environment'
import levelData from '../data/levels/vault.json'
import type { LevelData } from '../systems/LevelProgress'
import { makeItem } from '../systems/items'
import { SURFACE_Y } from '../world/SeabedScene'
import { Particles } from '../fx/Particles'
import { Label } from '../ui/Label'
import { CAVERN, CHEST_AT, FALLS, FLOOR_Y, LAGOON, buildCavern, constrainInCavern, containInLagoon, gold, insideFootprint, lagoonR, vaultFloor, type CavernParts } from '../vault/Cavern'
import { Keeper } from '../vault/Keeper'
import { Oyster } from '../vault/Oyster'
import { DiveLevel, type DiveLevelSetup } from './DiveLevel'

const LEVEL = levelData as LevelData
/** Up out of the Wreck Graveyard's trench: underwater in the lagoon, facing the chest. */
const SPAWN = new THREE.Vector3(0, SURFACE_Y - 1.6, -10)
/** Coming this close to the sleeping keeper's head without the pearl wakes it. */
const WAKE_RANGE = 3
/** Oysters on the lagoon floor under the waterfall; the third holds the pearl. */
const OYSTERS: [number, number, number][] = [[-2.2, -16.2, 0.4], [-0.8, -17.3, -0.2], [0.9, -16.6, 0.9], [2.3, -17.4, -0.7], [0.2, -15.4, 2.1]]
const PEARL_OYSTER = 2
const COINS: [number, number][] = [
  [-6, -1], [7, 1], [-9, 6], [9, 7], [-14, -2], [15, -1], [-5, 12], [6, 12], [-16, 4], [17, 3],
  [-3, 18], [4, 20], [-22, 6], [22, 2], [-14, -16], [15, -18], [-8, -22], [9, -21], [-20, -8], [21, -6],
]
type Look = 'air' | 'water'

// The finale, the Treasure Vault. Up from the trench, divers surface in the lagoon of a vast cavern:
// a floor of gold coins heaped into hills, open chests spilling jewels, marble columns with torches,
// shafts of daylight, and a waterfall pouring off a ledge into the lagoon. The riddle: "Wake not the
// keeper, feed it instead; give it the pearl from the oyster bed." An ancient sea serpent sleeps coiled
// before the great chest. Open the oysters under the waterfall, find the pearl, feed it to the keeper
// (it slides away into the lagoon), then everyone puts a hand on the chest's lid to open it together.
export class VaultStage extends DiveLevel {
  readonly id = 'vault'
  readonly ownsWaterLook = true
  protected readonly finale = true
  private parts!: CavernParts
  private walkEnv!: WalkEnvironment
  private keeper!: Keeper
  private readonly oysters: Oyster[] = []
  private pearl!: THREE.Group
  private pearlItem!: LooseItem
  private chestLid = new THREE.Group()
  private chestLight!: THREE.PointLight
  private chestOpen = -1
  private readonly sparkle = new Particles({ max: 600, gravity: 0.15, drag: 0.4, blending: THREE.AdditiveBlending })
  private readonly mist = new Particles({ max: 400, gravity: 0.3, drag: 1.2 })
  private victory: Label | null = null
  private look: Look | null = null
  private wakeCooldown = 0
  private pourTimer = 0
  private sparkleTimer = 0
  /** Who has a hand on the chest's lid right now (session ids; 'me' solo). */
  private readonly holding = new Set<string>()
  private myHands = 0
  private readonly looks: Record<Look, { fog: THREE.FogExp2; background: THREE.Color }> = {
    air: { fog: new THREE.FogExp2(0x2a1a08, 0.012), background: new THREE.Color(0x120b04) },
    water: { fog: new THREE.FogExp2(0x1d6a70, 0.07), background: new THREE.Color(0x1d6a70) },
  }

  constructor(game: GameContext) {
    super(game, LEVEL)
  }

  // ---- World --------------------------------------------------------------------------------------

  protected buildWorld(): DiveLevelSetup {
    this.parts = buildCavern(this.root)
    this.root.add(this.sparkle.points, this.mist.points)
    this.keeper = new Keeper(this.root)
    this.buildChest()
    this.walkEnv = {
      kind: 'walk',
      waterY: SURFACE_Y,
      groundHeight: (x, z) => (lagoonR(x, z) < 0.98 ? null : vaultFloor(x, z)),
      constrain: (head) => constrainInCavern(head),
    }
    return {
      floorHeight: vaultFloor,
      radius: 40,
      refillZones: [],
      checkpoint: SPAWN.clone(),
      // There is no way on from here: the arch stays out of sight, deep under the floor.
      gate: { position: new THREE.Vector3(0, -40, 60), yaw: 0 },
      botRefill: null,
      contain: containInLagoon,
    }
  }

  /** The great chest on the dais: iron-bound, its lid hinged at the back. */
  private buildChest(): void {
    const chest = new THREE.Group()
    chest.position.copy(CHEST_AT)
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2a12, roughness: 0.75 })
    const band = gold(0xd4a83c)
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 1.05), wood)
    body.position.y = 0.45
    chest.add(body)
    for (const x of [-0.6, 0, 0.6]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.92, 1.07), band)
      strap.position.set(x, 0.45, 0)
      chest.add(strap)
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.06), band)
    lock.position.set(0, 0.75, 0.55)
    chest.add(lock)
    // The lid: a half-barrel, pivoting on hinges along the back edge.
    this.chestLid.position.set(0, 0.9, -0.525)
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.525, 0.525, 1.7, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2), wood)
    lid.position.z = 0.525
    const lidBand = new THREE.Mesh(new THREE.CylinderGeometry(0.535, 0.535, 0.1, 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2), band)
    lidBand.position.z = 0.525
    this.chestLid.add(lid, lidBand)
    chest.add(this.chestLid)
    // Gold heaped inside, lit from within once it's open.
    const hoard = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold())
    hoard.scale.set(1, 0.35, 0.6)
    hoard.position.y = 0.86
    chest.add(hoard)
    this.chestLight = new THREE.PointLight(0xffd070, 0, 14, 1.2)
    this.chestLight.position.set(0, 1.4, 0)
    chest.add(this.chestLight)
    this.root.add(chest)
  }

  protected arrive(env: SwimEnvironment): void {
    const { game } = this
    // No exit arch here.
    this.gate.group.visible = false
    const i = this.boxes.indexOf(this.gate.collider)
    if (i >= 0) this.boxes.splice(i, 1)
    game.player.enter(env, SPAWN.clone(), Math.PI, this.bubbles)
    game.hud.say('Up and up the trench... light above. Surface!', 4)
    game.hud.say(`The last riddle on your map: "${LEVEL.riddle}"`, 7)
  }

  protected updateWorld(dt: number, elapsed: number): void {
    const head = this.game.camera.getWorldPosition(this.head)
    this.updateLook(head)
    this.keeper.update(dt)
    for (const o of this.oysters) o.update(dt)
    this.pearl.visible = this.pearlItem.heldBy !== null || (this.oysters[PEARL_OYSTER].open && !this.keeper.gone && !this.progress.done.has('feedKeeper'))
    // The waterfall streams down; foam and mist churn at its foot; its roar comes and goes.
    const map = (this.parts.waterfall.material as THREE.MeshBasicMaterial).map!
    map.offset.y += dt * 1.6
    ;(this.parts.foam.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(elapsed * 5) * 0.08
    this.mist.emit({ position: new THREE.Vector3(FALLS.x + (Math.random() - 0.5) * FALLS.width, SURFACE_Y + 0.1, FALLS.z), velocity: new THREE.Vector3(0, 0.8, 0.4), spread: 0.7, color: 0xe8fbff, size: 0.35, endSize: 1.4, life: 2.2, count: 2, alpha: 0.35 })
    this.pourTimer -= dt
    if (this.pourTimer <= 0) {
      this.pourTimer = 0.5
      this.game.audio.play('pour', new THREE.Vector3(FALLS.x, SURFACE_Y + 1, FALLS.z), 0.7)
    }
    // Torches flicker; the daylight shafts breathe; gold glitters.
    for (const [i, t] of this.parts.torches.entries()) {
      const f = 1 + Math.sin(elapsed * 11 + i) * 0.08 + Math.sin(elapsed * 23 + i * 2) * 0.05
      t.light.intensity = 30 * f
      t.flame.scale.set(0.7 * f, 1.1 / f, 1)
    }
    for (const [i, s] of this.parts.shafts.entries()) (s.material as THREE.MeshBasicMaterial).opacity = 0.09 + Math.sin(elapsed * 0.4 + i) * 0.025
    this.sparkleTimer -= dt
    if (this.sparkleTimer <= 0) {
      this.sparkleTimer = 0.05
      const x = (Math.random() - 0.5) * 50
      const z = (Math.random() - 0.5) * 46 - 4
      if (lagoonR(x, z) > 1.1 && insideFootprint(x, z, 2)) {
        this.sparkle.emit({ position: new THREE.Vector3(x, vaultFloor(x, z) + 0.1, z), velocity: new THREE.Vector3(0, 0.15, 0), spread: 0.05, color: 0xfff0b0, size: 0.06, endSize: 0.01, life: 1.2, count: 1 })
      }
    }
    this.animateChest(dt)
    this.sparkle.update(dt, this.game.halfHeight)
    this.mist.update(dt, this.game.halfHeight)
  }

  /** Warm golden air above; clear turquoise water in the lagoon. */
  private updateLook(head: THREE.Vector3): void {
    const look: Look = head.y > SURFACE_Y + 0.02 ? 'air' : 'water'
    if (look === this.look) return
    this.look = look
    const { scene, audio } = this.game
    scene.fog = this.looks[look].fog
    scene.background = this.looks[look].background
    audio.setEnvironment(look)
  }

  protected nextStage(): (() => Stage) | null {
    return null
  }

  protected levelInk(): string[] {
    return ['Hidden ink: a gem on the highest heap in the north-west, one in the foam under the waterfall, and one at the foot of the eastern columns.']
  }

  // ---- Puzzle -----------------------------------------------------------------------------------

  protected buildPuzzle(): void {
    const { game } = this
    for (const [x, z, yaw] of OYSTERS) {
      const oyster = new Oyster(this.root, new THREE.Vector3(x, vaultFloor(x, z) + 0.05, z), yaw, game.audio)
      this.oysters.push(this.grab.add(oyster))
    }
    const pearlOyster = this.oysters[PEARL_OYSTER]
    pearlOyster.group.updateMatrixWorld(true)
    this.pearl = makeItem('pearl')
    this.pearl.position.copy(pearlOyster.pearlSpot)
    this.pearl.visible = false
    this.root.add(this.pearl)
    // A soft glow so it can be found in the churned-up water.
    this.pearl.add(new THREE.PointLight(0xfff4e0, 2, 2.5, 1.5))
    this.pearlItem = this.grab.add(
      new LooseItem(this.pearl, {
        // Generous, so reaching into the open oyster takes the pearl rather than shutting the shell.
        radius: 0.3,
        settle: 'home',
        onGrab: (hand) => {
          if (!pearlOyster.open || this.keeper.gone) return true
          hand.pulse(0.6, 100)
          if (!this.progress.done.has('takePearl')) {
            this.step('takePearl')
            game.hud.now('A pearl, big as a quail\'s egg, glowing softly. Now: who is hungry?', 4)
          }
          return false
        },
        whileHeld: (hand) => {
          if (this.keeper.gone || this.pearl.getWorldPosition(this.v).distanceTo(this.keeper.mouth) > 0.9) return
          this.grab.drop(hand)
          this.pearl.visible = false
          this.step('feedKeeper')
        },
      }),
    )
    this.grab.add(this.chestHandle())

    for (const [x, z] of COINS) this.place(this.root, 'coin', x, vaultFloor(x, z) + 0.15, z)
    this.place(this.root, 'gem', -18, vaultFloor(-18, -10) + 0.2, -10)
    this.place(this.root, 'gem', FALLS.x + 1.2, vaultFloor(FALLS.x + 1.2, FALLS.z + 1.5) + 0.25, FALLS.z + 1.5)
    this.place(this.root, 'gem', 23, vaultFloor(23, -4) + 0.2, -4)
  }

  /** The chest's lid, as something to put a hand on. Everyone's hands on it at once opens it. */
  private chestHandle(): Interactable {
    const lidCentre = CHEST_AT.clone().add(new THREE.Vector3(0, 1.1, 0.1))
    return {
      pullable: false,
      grabGap: (point) => (this.chestOpen >= 0 ? Infinity : point.distanceTo(lidCentre) - 0.9),
      grab: (hand) => {
        hand.pulse(0.4, 60)
        this.myHands++
        this.shareHold()
      },
      release: () => {
        this.myHands = Math.max(0, this.myHands - 1)
        this.shareHold()
      },
      setHighlight: () => {},
    }
  }

  private shareHold(): void {
    const me = this.game.net?.sessionId ?? 'me'
    if (this.myHands > 0) this.holding.add(me)
    else this.holding.delete(me)
    this.shareProp(`hold/${me}`, [this.myHands > 0 ? 1 : 0])
  }

  protected onProp(key: string, v: number[]): void {
    const who = /^hold\/(.+)$/.exec(key)?.[1]
    if (!who) return
    if (v[0] === 1) this.holding.add(who)
    else this.holding.delete(who)
  }

  protected updateLevel(dt: number): void {
    const { game } = this
    const head = game.camera.getWorldPosition(this.head)
    const player = game.player
    this.wakeCooldown = Math.max(0, this.wakeCooldown - dt)

    if (player.env?.kind === 'swim') this.tryClimbOut(head)
    else if (player.inWater) {
      // Stepped off into the lagoon: swimming again.
      player.switchEnvironment(this.env)
      player.noJump = false
      game.audio.play('splash', head, 0.6)
    }
    if (player.env?.kind === 'walk') player.noJump = true
    if (head.y > SURFACE_Y + 0.02) this.teach('arrive', 'Gold. Everywhere, gold... and something enormous asleep before the great chest. Grip the lagoon\'s edge to climb out.', 7)

    // Wake not the keeper: too close without the pearl and it stirs, shoving you back.
    const fed = this.progress.done.has('feedKeeper')
    if (!fed && this.wakeCooldown === 0) {
      const withPearl = this.pearlItem.heldBy !== null
      const d = head.distanceTo(this.keeper.headPosition)
      if (d < WAKE_RANGE && !withPearl) {
        this.wakeCooldown = 3
        this.keeper.disturb()
        const away = head.clone().sub(this.keeper.headPosition).setY(0).setLength(1.4)
        game.rig.position.add(away)
        for (const h of game.hands) h.pulse(0.9, 200)
        game.audio.play('impact', this.keeper.headPosition, 0.5)
        game.hud.now('The keeper stirs, one great eye cracking open... Back away! "Wake not the keeper."', 4)
      } else if (d < WAKE_RANGE + 1.5 && withPearl) {
        this.teach('scent', 'The keeper\'s nostrils flare at the pearl\'s scent. Hold it to its mouth.', 4)
      }
    }

    // Opening the chest: everyone in the vault with a hand on the lid.
    if (this.holding.size > 0 && this.chestOpen < 0) {
      if (!fed) {
        if (this.wakeCooldown === 0) {
          this.wakeCooldown = 3
          this.keeper.disturb()
          game.hud.now('The lid won\'t lift, and the keeper stirs at the scrape of it. Not while it sleeps here.', 4)
        }
      } else {
        const needed = this.humansHere()
        const present = [...this.holding].filter((id) => needed.includes(id)).length
        if (present >= needed.length) this.step('openChest')
        else this.teach(`chest${present}`, `Hands on the lid: ${present} of ${needed.length}. Everyone together!`, 3)
      }
    }
  }

  /** Session ids of the humans in the vault right now (just you, solo). */
  private humansHere(): string[] {
    const net = this.game.net
    if (!net) return ['me']
    return net.roster().filter((p) => p.connected && (p.sessionId === net.sessionId || p.stage === this.id)).map((p) => p.sessionId)
  }

  /** At the surface, a hand gripping the lagoon's edge (or Space on the keyboard) climbs out onto the gold. */
  private tryClimbOut(head: THREE.Vector3): void {
    const { game } = this
    if (head.y < SURFACE_Y - 0.3) return
    for (const hand of game.hands) {
      if (!hand.connected || hand.held) continue
      const p = hand.worldPos(new THREE.Vector3())
      const r = lagoonR(p.x, p.z)
      const wanted = hand.virtual ? game.desktop.rise > 0 : hand.squeezePressed
      if (!wanted || r < 0.8) continue
      // Out onto the bank, just past the water's edge in the hand's direction.
      const dx = (p.x - LAGOON.x) / Math.max(r, 1e-3)
      const dz = (p.z - LAGOON.z) / Math.max(r, 1e-3)
      const x = LAGOON.x + dx * 1.12
      const z = LAGOON.z + dz * 1.12
      game.player.switchEnvironment(this.walkEnv)
      game.player.placeFeet(new THREE.Vector3(x, vaultFloor(x, z), z))
      for (const h of game.hands) h.pulse(0.4, 60)
      game.audio.play('splash', head, 0.4)
      this.teach('walk', 'You climb out onto the gold. Walk with the left stick; step back into the lagoon to swim.', 6)
      return
    }
  }

  private animateChest(dt: number): void {
    if (this.chestOpen < 0) return
    this.chestOpen = Math.min(1, this.chestOpen + dt / 2.5)
    const u = 1 - Math.pow(1 - this.chestOpen, 3)
    this.chestLid.rotation.x = -1.9 * u
    this.chestLight.intensity = 60 * u
    if (this.chestOpen < 1 || Math.random() < 0.4) {
      this.sparkle.emit({ position: CHEST_AT.clone().add(new THREE.Vector3(0, 1.1, 0)), velocity: new THREE.Vector3(0, 2.2, 0), spread: 0.9, color: 0xffe08a, size: 0.08, endSize: 0.02, life: 1.6, count: 3 })
    }
  }

  // ---- Steps -------------------------------------------------------------------------------------

  protected applyLevelStep(id: string, who: string | null): void {
    const { game } = this
    if (id === 'feedKeeper') {
      this.pearl.visible = false
      if (this.catchingUp) this.keeper.leave(true)
      else {
        this.keeper.leave()
        game.audio.play('gulp', this.keeper.headPosition, 1)
        game.hud.now(who ? `${who} fed the keeper the pearl!` : 'The keeper\'s eyes open, golden and calm. It takes the pearl... and slides away into the lagoon.', 5)
      }
    }
    if (id === 'openChest') {
      this.chestOpen = this.catchingUp ? 1 : 0
      if (!this.catchingUp) {
        for (const h of game.hands) h.pulse(1, 400)
        game.audio.play('impact', CHEST_AT, 0.8)
      }
      this.showVictory()
    }
  }

  /** The victory board over the open chest: the crew's haul and the run's stories. */
  private showVictory(): void {
    if (this.victory) return
    const { game } = this
    const party = game.party
    const minutes = Math.floor(this.time / 60)
    const seconds = Math.floor(this.time % 60).toString().padStart(2, '0')
    const r = game.record
    this.victory = new Label({ width: 2.4, canvasWidth: 1024, canvasHeight: 820, billboard: true })
    this.victory.mesh.position.copy(CHEST_AT).add(new THREE.Vector3(0, 3.1, 0))
    this.root.add(this.victory.mesh)
    this.victory.set([
      { text: 'VICTORY!', size: 96, bold: true, color: '#ffd35a' },
      { text: 'The treasure of Sunken Sicily is yours', size: 44, color: '#fff4d6' },
      { text: `Team score ★ ${party.score}`, size: 44, bold: true, color: '#ffe08a' },
      { text: `Coins ${party.inventory.count('coin')} · Gems ${party.inventory.count('gem')} · Map pieces ${party.mapPieces.length} / 5`, size: 38 },
      { text: `Time in the vault ${minutes}:${seconds}`, size: 34, color: '#d8cfb8' },
      { text: `Who shot first? ${r.whoShotFirst ?? 'Nobody saw'}`, size: 36, color: '#ffb4a0' },
      { text: `Clays ${r.clayHits} / ${r.clayShots}${r.bullseyeBeforeBattle ? ' · Bullseye before battle!' : ''}`, size: 30, color: '#d8cfb8' },
    ])
    game.hud.say('The chest opens on a blaze of gold. You did it, crew!', 6)
  }

  protected objective(): THREE.Vector3 {
    switch (this.progress.nextStep?.id) {
      case 'takePearl':
        return this.oysters[PEARL_OYSTER].group.getWorldPosition(new THREE.Vector3())
      case 'feedKeeper':
        return this.keeper.mouth
      default:
        return CHEST_AT.clone().add(new THREE.Vector3(0, 1, 0))
    }
  }

  /** The whole treasure room, lagoon and gold, seen from just above the heaps. */
  mapArea(): MapArea | null {
    return { x: CAVERN.center.x, z: CAVERN.center.z, size: 60, top: FLOOR_Y + 3.5, name: this.level.name }
  }

  /** Bots keep to the lagoon (they don't climb out onto the gold). */
  protected botCanReach(p: THREE.Vector3): boolean {
    return p.y < SURFACE_Y - 0.3 && lagoonR(p.x, p.z) < 0.9
  }

  exit(): void {
    this.game.player.noJump = false
    super.exit()
  }

  /** Keep the victory board facing whoever looks at it. */
  update(dt: number, elapsed: number): void {
    super.update(dt, elapsed)
    this.victory?.face(this.game.camera)
  }
}
