import * as THREE from 'three'
import { disposeTree, type GameContext, type Stage } from '../core/Stage'
import { GrabSystem } from '../interaction/GrabSystem'
import type { SwimEnvironment } from '../movement/environment'
import { Bubbles } from '../world/Bubbles'
import { addSandboxProps } from '../world/SandboxProps'
import { SANDBOX_RADIUS, SeabedScene, SURFACE_Y, VENT_POSITION, VENT_RADIUS, sandHeight, type RockCollider } from '../world/SeabedScene'
import { Galleon } from '../world/ship/Galleon'

export type DiveArrival = 'sandbox' | 'shipwreck'

const WRECK_REST = new THREE.Vector3(7, 1.2, -13)
const WRECK_START_Y = SURFACE_Y - 1.5
const SINK_SECONDS = 22

// Underwater: the movement sandbox seabed. Arriving from the ship, the galleon sinks past the
// divers and settles on the seabed (it becomes Level 1 in the next milestone).
export class DiveStage implements Stage {
  readonly root = new THREE.Group()
  private readonly bubbles = new Bubbles(SURFACE_Y)
  private world!: SeabedScene
  private grab!: GrabSystem
  private wreck: Galleon | null = null
  private sinkTime = 0
  private readonly rocks: RockCollider[] = []
  private readonly wreckColliders: RockCollider[] = []
  private readonly tmp = new THREE.Vector3()

  constructor(
    private readonly game: GameContext,
    private readonly arrival: DiveArrival,
  ) {}

  enter(): void {
    const { game } = this
    game.scene.add(this.root)
    this.root.add(this.bubbles.points)
    this.world = new SeabedScene(game.scene, this.root, this.bubbles)
    this.rocks.push(...this.world.rocks)

    this.grab = new GrabSystem({ rocks: this.rocks, floor: sandHeight })
    addSandboxProps(this.root, this.grab, this.rocks, () => game.player.refillFull())

    const env: SwimEnvironment = {
      kind: 'swim',
      floorHeight: sandHeight,
      surfaceY: SURFACE_Y,
      rocks: this.rocks,
      radius: SANDBOX_RADIUS,
      refillZones: [{ center: VENT_POSITION, radius: VENT_RADIUS }],
    }

    game.audio.setEnvironment('water')
    game.wrist.setVisible(true)
    game.vignette.setMask(true)
    game.player.air.fill()

    if (this.arrival === 'shipwreck') {
      this.wreck = new Galleon()
      this.wreck.mergeAll()
      this.wreck.group.position.set(WRECK_REST.x, WRECK_START_Y, WRECK_REST.z)
      this.wreck.group.rotation.set(0, 0.5, 0.05)
      this.root.add(this.wreck.group)
      // Rough collision spheres along the keel, added once the wreck has settled.
      for (let z = -12; z <= 11; z += 3.5) this.wreckColliders.push({ center: new THREE.Vector3(0, 1.2, z), radius: 3.2 })
      game.player.enter(env, new THREE.Vector3(0, SURFACE_Y - 3.2, 3), 0.35, this.bubbles)
      game.hud.say('Splash! The galleon is going down past you...', 5)
      game.hud.say('Swim clear and watch her settle on the seabed.', 5)
      game.hud.say('Level 1, The Sinking Galleon, is built in the next milestone. Until then, explore the seabed.', 7)
      // Burst of bubbles all around the diver as they hit the water.
      game.camera.getWorldPosition(this.tmp)
      this.bubbles.emit(this.tmp, new THREE.Vector3(0, 1, 0), 160, 1.4, 2.5)
    } else {
      game.player.enter(env, new THREE.Vector3(0, 0.6, 4), 0, this.bubbles)
    }
  }

  update(dt: number, elapsed: number): void {
    const { game } = this
    game.player.update(dt, game.inXr, game.desktop)
    this.grab.update(dt, game.hands, game.player.physics.velocity, game.rig)
    this.world.update(dt, elapsed)
    this.updateWreck(dt)
    this.bubbles.update(dt)
    game.wrist.update(dt, {
      air: game.player.air.fraction,
      depth: game.player.depth,
      speed: game.player.speed,
      refilling: game.player.refilling,
    })
  }

  exit(): void {
    this.game.scene.remove(this.root)
    disposeTree(this.root)
  }

  private updateWreck(dt: number): void {
    const wreck = this.wreck
    if (!wreck || this.sinkTime >= SINK_SECONDS) return
    this.sinkTime = Math.min(SINK_SECONDS, this.sinkTime + dt)
    const t = this.sinkTime / SINK_SECONDS
    // Sinks fast at first, then slows as it nears the bottom, rolling onto its side a little.
    const ease = 1 - Math.pow(1 - t, 2.2)
    wreck.group.position.y = THREE.MathUtils.lerp(WRECK_START_Y, WRECK_REST.y, ease)
    wreck.group.rotation.z = THREE.MathUtils.lerp(0.05, 0.22, ease)
    wreck.group.rotation.x = THREE.MathUtils.lerp(0, -0.06, ease)
    // Air escaping from the hull as it goes down.
    if (Math.random() < dt * 30) {
      this.tmp.set((Math.random() - 0.5) * 5, 2.5, (Math.random() - 0.5) * 20)
      wreck.group.localToWorld(this.tmp)
      this.bubbles.emit(this.tmp, new THREE.Vector3(0, 1, 0), 8, 1.2, 0.8)
    }
    if (this.sinkTime >= SINK_SECONDS) {
      wreck.group.updateMatrixWorld(true)
      for (const c of this.wreckColliders) this.rocks.push({ center: wreck.group.localToWorld(c.center.clone()), radius: c.radius })
      this.game.hud.say('The galleon has settled on the seabed.', 4)
    }
  }
}
