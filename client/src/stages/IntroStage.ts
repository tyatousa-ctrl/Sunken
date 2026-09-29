import * as THREE from 'three'
import { disposeTree, type GameContext, type Stage } from '../core/Stage'
import { Particles } from '../fx/Particles'
import { GrabSystem } from '../interaction/GrabSystem'
import type { WalkEnvironment } from '../movement/environment'
import { AttackSequence } from '../intro/AttackSequence'
import { ATTACK_SECONDS, formatClock, railsOpen, secondsLeft } from '../intro/attackTimeline'
import { ClayRange } from '../intro/ClayRange'
import { Crew } from '../intro/Crew'
import { GearRack, type GearPiece } from '../intro/GearRack'
import { Shotgun } from '../intro/Shotgun'
import { AboveWater } from '../world/above/Coast'
import { BOW_Z, CABIN_FRONT_Z, DECK_Y, Galleon, STERN_Z, halfWidthAt } from '../world/ship/Galleon'
import { DiveStage } from './DiveStage'

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

/** Deck obstacles (ship-local circles): masts, the captain's table, the gear rack, the thrower. */
const OBSTACLES: Obstacle[] = [
  { x: 0, z: 0, r: 0.45 },
  { x: 0, z: -8, r: 0.45 },
  { x: -1.4, z: 7.2, r: 0.75 },
  { x: -(halfWidthAt(1.6) - 0.45), z: 1.6, r: 0.5 },
  { x: halfWidthAt(6.2) - 0.5, z: 6.2, r: 0.45 },
]

// Milestone 3: golden hour on the galleon's deck. Clay shooting is the fake-out; a stray pellet into
// the ship in the bay starts the real game: she runs up a black flag and opens fire, our ship sinks,
// and the crew has to gear up and go over the side.
export class IntroStage implements Stage {
  readonly root = new THREE.Group()
  private readonly ship = new Galleon({ flag: 'crew' })
  private readonly enemy = new Galleon({ hullColor: 0x2e2620, sailColor: 0xcfc6b2, flag: 'merchant' })
  private readonly smoke = new Particles({ max: 500, gravity: 0.3, drag: 0.6 })
  private readonly fire = new Particles({ max: 400, gravity: 1.5, drag: 1, blending: THREE.AdditiveBlending })
  private readonly debris = new Particles({ max: 400, gravity: -9.8, drag: 0.3 })
  private readonly splash = new Particles({ max: 400, gravity: -9.8, drag: 0.4 })
  private readonly grab = new GrabSystem()
  private readonly guns: Shotgun[] = []
  private readonly raycaster = new THREE.Raycaster()
  private above!: AboveWater
  private range!: ClayRange
  private crew!: Crew
  private gear!: GearRack
  private attack: AttackSequence | null = null
  private phase: Phase = 'fakeout'
  private fakeoutTime = 0
  private pullCooldown = 0
  private firstGunHeld = false
  private nudges = 0
  private broadsideYaw = 0
  private railsWereOpen = false
  private readonly v = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()

  constructor(private readonly game: GameContext) {}

  enter(): void {
    const { game } = this
    game.scene.add(this.root)
    this.above = new AboveWater(game.scene, this.root)
    this.root.add(this.ship.group)

    const toUs = ENEMY_POSITION.clone().negate().setY(0).normalize()
    // Broadside = the enemy's port side (local -x) facing us.
    this.broadsideYaw = Math.atan2(toUs.z, -toUs.x)
    this.enemy.mergeAll()
    this.enemy.group.scale.setScalar(0.85)
    this.enemy.group.position.copy(ENEMY_POSITION)
    this.enemy.group.rotation.y = this.broadsideYaw + 1.25
    this.root.add(this.enemy.group)

    for (const p of [this.smoke, this.fire, this.debris, this.splash]) this.root.add(p.points)

    this.buildGunRack()
    this.range = new ClayRange(this.root, this.ship, { audio: game.audio, debris: this.debris, splash: this.splash })
    this.crew = new Crew(this.ship, this.root)
    this.gear = new GearRack(this.ship, this.grab, game.camera, game.audio, (hand) => this.grab.drop(hand))
    this.gear.onChange = (piece) => this.onGear(piece)

    game.player.enter(this.walkEnvironment(), new THREE.Vector3(0, DECK_Y, 3), Math.PI)
    game.audio.setEnvironment('air')
    game.wrist.setVisible(false)
    game.vignette.setMask(false)
    game.hud.say('Welcome aboard! Golden hour off the Sicilian coast. Enjoy the calm.', 5, 'Salvo')
    game.hud.setPrompt('Walk: left stick · Turn: right stick · Grab: grip. Pick up a blunderbuss from the rack by the cabin.')
  }

  update(dt: number, elapsed: number): void {
    const { game } = this
    game.player.update(dt, game.inXr, game.desktop)
    this.gear.update()
    this.grab.update(dt, game.hands, game.player.physics.velocity, game.rig)
    this.range.update(dt)
    this.crew.update(dt, elapsed)
    this.ship.update(elapsed)
    this.enemy.update(elapsed)
    this.bobEnemy(elapsed)
    this.above.update(dt, elapsed, game.halfHeight)
    for (const p of [this.smoke, this.fire, this.debris, this.splash]) p.update(dt, game.halfHeight)

    if (this.phase === 'fakeout') this.updateFakeout(dt)
    else if (this.phase === 'attack') this.updateAttack(dt, elapsed)

    if (game.player.inWater && this.phase !== 'overboard') this.overboard()
  }

  exit(): void {
    this.game.hud.clear()
    this.game.scene.remove(this.root)
    disposeTree(this.root)
  }

  /** Debug/test hook: start the attack as if the ship had been shot. */
  startAttack(shooter = 'You'): void {
    if (this.phase !== 'fakeout') return
    const { game } = this
    this.phase = 'attack'
    game.record.whoShotFirst = shooter
    game.audio.silence(1.2)
    game.hud.clear()
    this.attack = new AttackSequence(this.root, this.ship, this.enemy, this.broadsideYaw, {
      audio: game.audio,
      smoke: this.smoke,
      fire: this.fire,
      debris: this.debris,
      splash: this.splash,
      onScoreboardHit: () => this.range.breakBoard(),
      hands: () => game.hands,
      head: () => game.camera.getWorldPosition(this.v2),
    })
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

    // Salvo calls "Pull!" whenever someone's holding a gun and the sky is clear; the button works too.
    if (range.checkButton(game.hands)) this.pull()
    else if (gunHeld && !range.anyInFlight && this.pullCooldown === 0) this.pull()

    // Gentle nudges toward the ship in the bay. Nothing ever says to shoot it.
    const nudges: [number, () => void][] = [
      [100, () => game.hud.say("That merchant's been sitting in the bay all afternoon...", 5, 'Nino')],
      [170, () => {
        this.crew.parrot.flyTo(this.enemy.group.position)
        game.hud.say("Polly doesn't like the look of that ship.", 5, 'Rosalia')
      }],
      [240, () => game.hud.say('Odd. Not a soul on her deck.', 5, 'Turi')],
    ]
    if (this.nudges < nudges.length && this.fakeoutTime >= nudges[this.nudges][0]) nudges[this.nudges++][1]()
  }

  private pull(): void {
    this.game.hud.say('Pull!', 1.2, 'Salvo')
    this.crew.get('Salvo').group.getWorldPosition(this.v)
    this.game.audio.play('whistle', this.v.setY(this.v.y + 1.6))
    this.range.pull(Math.random() < 0.3 ? 2 : 1)
    this.pullCooldown = PULL_COOLDOWN + Math.random() * 1.5
  }

  private onFire(origin: THREE.Vector3, directions: THREE.Vector3[]): void {
    const { game } = this
    const you = this.range.shooters[0]
    const hits = this.range.shoot(you, origin, directions)
    game.record.clayShots = you.shots
    game.record.clayHits = you.hits
    if (hits > 0) game.hands.forEach((h) => h.held && h.pulse(0.2, 30))

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
        this.startAttack('You')
        return
      }
    }
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
    game.audio.play('bigSplash')
    game.hud.clear()
    game.goTo(() => new DiveStage(game, 'shipwreck'))
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
      groundHeight: (x, z) => {
        const p = toLocal(x, z)
        if (p.z > STERN_Z || p.z < BOW_Z || Math.abs(p.x) > halfWidthAt(p.z)) return null
        return ship.localToWorld(p.setY(DECK_Y)).y
      },
      constrain: (head) => {
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

