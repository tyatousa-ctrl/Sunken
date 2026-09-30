import type { ButtonGuide } from '../ui/ControllerGuide'
import type { MapArea } from '../ui/MiniMap'
import * as THREE from 'three'
import { disposeTree, type GameContext, type Stage } from '../core/Stage'
import { GrabSystem } from '../interaction/GrabSystem'
import type { BotWorld } from '../bots/world'
import type { SwimEnvironment } from '../movement/environment'
import { Bubbles } from '../world/Bubbles'
import { addSandboxProps } from '../world/SandboxProps'
import { SANDBOX_RADIUS, SeabedScene, SURFACE_Y, VENT_POSITION, VENT_RADIUS, sandHeight, type RockCollider } from '../world/SeabedScene'

// The underwater movement sandbox (`?stage=sandbox`): open seabed, props to grab, an air vent.
export class DiveStage implements Stage {
  readonly id = 'sandbox'
  readonly root = new THREE.Group()
  private readonly bubbles = new Bubbles(SURFACE_Y)
  private world!: SeabedScene
  private grab!: GrabSystem
  private readonly rocks: RockCollider[] = []
  private botWorld: BotWorld | null = null
  private env: SwimEnvironment | null = null

  constructor(private readonly game: GameContext) {}

  enter(): void {
    const { game } = this
    game.scene.add(this.root)
    this.root.add(this.bubbles.points)
    this.world = new SeabedScene(game.scene, this.root, this.bubbles)
    this.rocks.push(...this.world.rocks)

    this.grab = new GrabSystem({ rocks: this.rocks, floor: sandHeight })
    addSandboxProps(this.root, this.grab, this.rocks, () => game.player.refillFull())

    const env: SwimEnvironment = (this.env = {
      kind: 'swim',
      floorHeight: sandHeight,
      surfaceY: SURFACE_Y,
      rocks: this.rocks,
      boxes: [],
      radius: SANDBOX_RADIUS,
      refillZones: [{ center: VENT_POSITION, radius: VENT_RADIUS }],
    })

    game.audio.setEnvironment('water')
    game.wrist.setVisible(true)
    game.player.air.fill()

    game.vignette.setMask(true)
    game.player.enter(env, new THREE.Vector3(0, 0.6, 4), 0, this.bubbles)
  }

  mapArea(): MapArea {
    return { x: 0, z: 0, size: SANDBOX_RADIUS * 2, top: SURFACE_Y - 0.25, name: 'Sandbox' }
  }

  guide(): ButtonGuide {
    return {
      left: ['Grip + pull: swim', 'Trigger: bubble jet', 'Stick: drift'],
      right: ['Grip + pull: swim', 'Trigger: bubble jet', 'Stick: turn · rise / sink'],
      desktop: ['<b>Diving</b>', 'WASD: swim · Space / Q: rise / sink · Shift: jets'],
    }
  }

  update(dt: number, elapsed: number): void {
    const { game } = this
    game.player.update(dt, game.inXr, game.desktop)
    this.grab.update(dt, game.hands, game.player.physics.velocity, game.rig)
    this.world.update(dt, elapsed)
    this.bubbles.update(dt)
    game.wrist.update(dt, {
      air: game.player.air.fraction,
      depth: game.player.depth,
      speed: game.player.speed,
      refilling: game.player.refilling,
    })
  }

  bots(): BotWorld | null {
    if (!this.env) return null
    this.botWorld ??= {
      env: this.env,
      spawn: (slot) => new THREE.Vector3(Math.cos(slot * 2.1) * 2.5, 1.6, 4 + Math.sin(slot * 2.1) * 2.5),
      task: () => null,
      collectibles: () => [],
      route: (_from, to) => [to],
      refill: VENT_POSITION.clone(),
      bubbles: this.bubbles,
    }
    return this.botWorld
  }

  exit(): void {
    this.game.scene.remove(this.root)
    disposeTree(this.root)
  }
}
