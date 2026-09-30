import * as THREE from 'three'
import { swimPush } from '../movement/collide'
import { AirTank } from '../movement/AirTank'
import { SwimPhysics, type HandSample } from '../movement/SwimPhysics'
import { TUNING } from '../movement/tuning'
import type { PoseArray } from '../net/protocol'
import { Avatar } from '../net/RemotePlayers'
import type { CrewMember } from '../systems/crew'
import { SKILLS, SkillCooldown } from '../systems/skills'
import { chooseGoal, followOffset, type Command, type Goal } from './brain'
import type { BotWorld } from './world'

const ARRIVE = 0.7
const WALK_SPEED = 1.5
const GRAVITY = 9.8
const STUCK_SECONDS = 1.5
/** Slower progress than this towards a waypoint counts as being stuck. */
const STUCK_SPEED = 0.2

export interface Teammate {
  id: string
  head: THREE.Vector3
  /** Their air 0–1 if known (the local player). */
  air?: number
  refill?: () => void
}

export interface BotContext {
  now: number
  humans: Teammate[]
  say: (text: string) => void
  /** Share air with a remote human (the local player is refilled directly). */
  shareAir: (id: string) => void
}

// One bot diver: swims with the same physics as a player (visible bubble jets), walks the deck,
// has its own air and skill, and follows its brain's current goal.
export class Bot {
  readonly avatar: Avatar
  readonly head = new THREE.Vector3()
  readonly air: AirTank
  readonly skill: SkillCooldown
  command: Command | null = null
  commandTarget = new THREE.Vector3()
  commander: string | null = null
  goal: Goal = 'idle'
  /** Went over the side on deck: hidden until the next stage. */
  overboard = false
  private readonly physics = new SwimPhysics()
  private yaw = 0
  private verticalSpeed = 0
  private route: THREE.Vector3[] = []
  private routeTarget = new THREE.Vector3(Infinity, 0, 0)
  private stuckTimer = 0
  private lastDistance = Infinity
  private stroke = Math.random() * 10
  private readonly jets: HandSample[] = [0, 1].map(() => ({ gripHeld: false, trigger: 0, velocity: new THREE.Vector3(), pointDir: new THREE.Vector3(), offset: new THREE.Vector3() }))
  private readonly pose: PoseArray = new Array(21).fill(0)
  private readonly v = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly drift = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()

  constructor(
    readonly member: CrewMember,
    scene: THREE.Object3D,
  ) {
    this.avatar = new Avatar(member.color)
    this.avatar.setInfo({ sessionId: member.id, name: member.name, color: member.color, connected: true, bot: true, character: member.character })
    scene.add(this.avatar.group)
    this.air = new AirTank(member.character === 'deepDiver' ? TUNING.airCapacity * 2 : TUNING.airCapacity)
    this.skill = new SkillCooldown(SKILLS[member.character].cooldown)
  }

  get name(): string {
    return this.member.name
  }

  placeAt(position: THREE.Vector3): void {
    this.head.copy(position)
    this.physics.velocity.set(0, 0, 0)
    this.route = []
    this.overboard = false
    this.avatar.group.visible = true
  }

  dispose(): void {
    this.avatar.group.removeFromParent()
    this.avatar.dispose()
  }

  update(dt: number, world: BotWorld, ctx: BotContext): void {
    this.skill.update(dt)
    this.stroke += dt
    if (this.overboard) {
      this.avatar.group.visible = false
      return
    }
    const target = this.think(world, ctx)
    if (world.env.kind === 'swim') this.swim(dt, world, target)
    else this.walk(dt, world, target)
    this.avatar.water = world.env.kind === 'swim' || this.head.y < world.env.waterY
    this.avatar.apply(this.buildPose())
  }

  /** Pick a goal and turn it into a place to be (null = stay put). */
  private think(world: BotWorld, ctx: BotContext): THREE.Vector3 | null {
    const nearestHuman = this.nearest(ctx.humans.map((h) => h.head))
    const collectibles = world.env.kind === 'swim' ? world.collectibles() : []
    const nearestItem = collectibles.reduce<{ d: number; c: (typeof collectibles)[number] | null }>(
      (best, c) => {
        const d = c.position.distanceTo(this.head)
        return d < best.d ? { d, c } : best
      },
      { d: Infinity, c: null },
    )
    const task = world.task()
    const lowMate = ctx.humans.find((h) => h.air !== undefined && h.air < 0.25)
    this.goal = chooseGoal({
      now: ctx.now,
      character: this.member.character,
      air: world.env.kind === 'swim' ? this.air.fraction : 1,
      canRefill: !!world.refill,
      command: this.command,
      task: task ? { skill: task.skill, ready: task.ready } : null,
      skillReady: this.skill.ready,
      nearestCollectible: nearestItem.d,
      nearestHuman: nearestHuman.d,
      teammateLowOnAir: !!lowMate,
    })

    const abandon = world.abandonShip?.(this.head)
    if (abandon) return abandon

    switch (this.goal) {
      case 'refill':
        return this.v.copy(world.refill!).setY(world.refill!.y + 1)
      case 'command':
        return this.obey(world, ctx)
      case 'shareAir': {
        if (lowMate && lowMate.head.distanceTo(this.head) < 1.6) {
          this.skill.trigger()
          if (lowMate.refill) lowMate.refill()
          else ctx.shareAir(lowMate.id)
          ctx.say(`${this.name} shares its air.`)
        }
        return lowMate?.head ?? null
      }
      case 'task': {
        if (task && task.position.distanceTo(this.head) < 1.3) {
          this.skill.trigger()
          task.act(this.name)
        }
        return task?.position ?? null
      }
      case 'collect': {
        const c = nearestItem.c!
        if (nearestItem.d < 0.6) c.take(this.member.id)
        return c.position
      }
      case 'follow': {
        const human = nearestHuman.p!
        const { angle, distance } = followOffset(this.member.slot)
        this.v.set(human.x + Math.cos(angle) * distance, human.y - 0.2, human.z + Math.sin(angle) * distance)
        // Already close enough: don't fidget.
        return this.v.distanceTo(this.head) > 1.2 || human.distanceTo(this.head) > 4.5 ? this.v : null
      }
      default:
        return null
    }
  }

  private obey(world: BotWorld, ctx: BotContext): THREE.Vector3 | null {
    const cmd = this.command!
    if (cmd.kind === 'useSkill') {
      this.command = null
      const task = world.task()
      if (task && task.skill === this.member.character && task.position.distanceTo(this.head) < 2.5 && this.skill.trigger()) {
        task.act(this.name)
        return null
      }
      const commander = ctx.humans.find((h) => h.id === this.commander)
      if (this.member.character === 'deepDiver' && commander && commander.head.distanceTo(this.head) < 3 && this.skill.trigger()) {
        if (commander.refill) commander.refill()
        else ctx.shareAir(commander.id)
        ctx.say(`${this.name} shares its air.`)
        return null
      }
      ctx.say(`${this.name}: nothing for my skill here.`)
      return null
    }
    if (cmd.kind === 'follow') {
      const commander = ctx.humans.find((h) => h.id === this.commander)
      if (!commander) return null
      return commander.head.distanceTo(this.head) > 1.6 ? commander.head : null
    }
    return this.commandTarget
  }

  private swim(dt: number, world: BotWorld, target: THREE.Vector3 | null): void {
    const env = world.env
    if (env.kind !== 'swim') return
    this.drift.set(0, 0, 0)
    for (const j of this.jets) j.trigger = 0
    const waypoint = target ? this.nextWaypoint(world, target, dt) : null
    if (waypoint) {
      const to = this.v2.subVectors(waypoint, this.head)
      const dist = to.length()
      to.normalize()
      if (dist > 3) {
        // Far: bubble-jet with both hands pointed backwards, like a player.
        const thrust = Math.min(1, dist / 6)
        this.jets.forEach((j, i) => {
          j.trigger = thrust
          j.pointDir.copy(to).negate()
          j.offset.set(i === 0 ? -0.3 : 0.3, -0.3, 0)
        })
      } else {
        this.drift.copy(to).multiplyScalar(Math.min(1, dist / 1.5))
      }
    }
    const result = this.physics.step({ hands: this.jets, drift: this.drift, dt })
    this.head.addScaledVector(this.physics.velocity, dt)
    const push = swimPush(this.head, env, this.v)
    if (push.lengthSq() > 0) {
      this.head.add(push)
      const n = push.normalize()
      const into = this.physics.velocity.dot(n)
      if (into < 0) this.physics.velocity.addScaledVector(n, -into)
    }
    // Air: same rules as a player.
    const inZone = env.refillZones.some((z) => (z.sphere ? z.center.distanceTo(this.head) : Math.hypot(this.head.x - z.center.x, this.head.z - z.center.z)) < z.radius)
    if (inZone) this.air.refill(dt)
    else this.air.drain(dt, result.thrust)
    if (this.air.empty) {
      this.placeAt(world.spawn(this.member.slot))
      this.air.fill()
    }
    if (result.jetting && world.bubbles && Math.random() < dt * 40) {
      for (const side of [-1, 1]) {
        this.v.set(side * 0.3, -0.3, 0.1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).add(this.head)
        world.bubbles.emit(this.v, this.jets[0].pointDir, 3, 2.5, 0.3)
      }
    }
    this.face(this.physics.velocity, dt)
  }

  private walk(dt: number, world: BotWorld, target: THREE.Vector3 | null): void {
    const env = world.env
    if (env.kind !== 'walk') return
    const vel = this.physics.velocity.set(0, 0, 0)
    if (target) {
      this.v2.subVectors(target, this.head).setY(0)
      const d = this.v2.length()
      if (d > 0.4) vel.copy(this.v2).multiplyScalar(Math.min(WALK_SPEED, d * 2) / d)
    }
    this.head.addScaledVector(vel, dt)
    env.constrain(this.head)
    const ground = env.groundHeight(this.head.x, this.head.z)
    this.verticalSpeed -= GRAVITY * dt
    this.head.y += this.verticalSpeed * dt
    if (ground !== null && this.head.y <= ground + 1.6) {
      this.head.y = ground + 1.6
      this.verticalSpeed = 0
    }
    if (this.head.y < env.waterY - 0.6) this.overboard = true
    this.face(vel, dt)
  }

  /** Follow the stage's route to the target, re-planning if it moves or we get stuck. */
  private nextWaypoint(world: BotWorld, target: THREE.Vector3, dt: number): THREE.Vector3 | null {
    if (this.route.length === 0 || target.distanceTo(this.routeTarget) > 1) {
      this.route = world.route(this.head.clone(), target.clone())
      this.routeTarget.copy(target)
      this.stuckTimer = 0
      this.lastDistance = Infinity
    }
    while (this.route.length > 1 && this.route[0].distanceTo(this.head) < ARRIVE) this.route.shift()
    const wp = this.route[0]
    if (!wp) return null
    const d = wp.distanceTo(this.head)
    if (d < ARRIVE * 0.5 && this.route.length === 1) return null
    // Stuck against something: hop up and over it.
    if (d > this.lastDistance - STUCK_SPEED * dt) this.stuckTimer += dt
    else this.stuckTimer = 0
    this.lastDistance = d
    if (this.stuckTimer > STUCK_SECONDS) {
      this.route.unshift(this.head.clone().add(new THREE.Vector3(0, 2, 0)))
      this.stuckTimer = 0
      this.lastDistance = Infinity
    }
    return this.route[0]
  }

  private face(velocity: THREE.Vector3, dt: number): void {
    if (Math.hypot(velocity.x, velocity.z) < 0.2) return
    const want = Math.atan2(-velocity.x, -velocity.z)
    let delta = want - this.yaw
    delta = Math.atan2(Math.sin(delta), Math.cos(delta))
    this.yaw += delta * Math.min(1, dt * 3)
  }

  /** Head, then hands at the sides doing a slow breaststroke. */
  buildPose(): PoseArray {
    const p = this.pose
    this.head.toArray(p, 0)
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).toArray(p, 3)
    const swing = Math.sin(this.stroke * 2.2) * 0.15
    for (const [side, at] of [[-1, 7], [1, 14]] as const) {
      this.v.set(side * (0.28 + swing), -0.35, -0.25 + Math.abs(swing)).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).add(this.head)
      this.v.toArray(p, at)
      this.q.toArray(p, at + 3)
    }
    return p
  }

  private nearest(points: THREE.Vector3[]): { d: number; p: THREE.Vector3 | null } {
    let best: { d: number; p: THREE.Vector3 | null } = { d: Infinity, p: null }
    for (const p of points) {
      const d = p.distanceTo(this.head)
      if (d < best.d) best = { d, p }
    }
    return best
  }
}
