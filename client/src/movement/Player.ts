import * as THREE from 'three'
import type { Hand } from '../input/Hand'
import type { DesktopControls } from '../input/DesktopControls'
import type { Bubbles } from '../world/Bubbles'
import { AirTank } from './AirTank'
import { SwimPhysics, type HandSample, type SwimResult } from './SwimPhysics'
import type { ComfortVignette } from './ComfortVignette'
import type { PlayerEnvironment, SwimEnvironment, WalkEnvironment } from './environment'

export type TurnMode = 'snap' | 'smooth'

const SNAP_ANGLE = THREE.MathUtils.degToRad(30)
const SMOOTH_TURN_SPEED = 1.6
const HEAD_CLEARANCE = 0.35
const EXHALE_INTERVAL = 4
const WALK_SPEED = 2
const GRAVITY = 9.8
const JUMP_SPEED = 3.6
/** Seated mode raises the view by this much so a seated player stands at crew height. */
const SEATED_LIFT = 0.45

// The local player: turns controller input into movement of the rig. On foot it walks, jumps and
// follows the (possibly tilting, sinking) ground; underwater it swims. It also manages air,
// respawn fades, jet bubbles and jet haptics.
export class Player {
  readonly physics = new SwimPhysics()
  readonly air = new AirTank()
  readonly checkpoint = new THREE.Vector3(0, 0.6, 4)
  refilling = false
  /** Set when a walking player drops into the water; the stage decides what happens. */
  inWater = false
  lastResult: SwimResult = { thrust: [], stroking: false, jetting: false }
  env: PlayerEnvironment | null = null

  /** No movement or turning (passed out). */
  frozen = false
  private turnMode: TurnMode
  private seated: boolean
  private drunkDrift = 0
  private drunkSpeed = 1
  private clock = 0
  private snapArmed = true
  private respawning = 0
  private exhaleTimer = 0
  private verticalSpeed = 0
  private grounded = false
  private bubbles: Bubbles | null = null
  private readonly samples: HandSample[]
  private readonly desktopHands: HandSample[]
  private readonly head = new THREE.Vector3()
  private readonly v1 = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly drift = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly right = new THREE.Vector3()

  constructor(
    private readonly rig: THREE.Group,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly hands: Hand[],
    private readonly vignette: ComfortVignette,
    turnMode: TurnMode,
    seated: boolean,
  ) {
    this.turnMode = turnMode
    this.seated = seated
    this.samples = hands.map(() => emptySample())
    // Desktop Shift-jets: two virtual hands at the hips pointing backwards.
    this.desktopHands = [emptySample(), emptySample()]
  }

  /** Switch environment (stage change). `bubbles` is where jet/exhale bubbles go underwater. */
  enter(env: PlayerEnvironment, spawn: THREE.Vector3, yaw: number, bubbles: Bubbles | null = null): void {
    this.env = env
    this.bubbles = bubbles
    this.checkpoint.copy(spawn)
    this.rig.position.copy(spawn)
    this.rig.rotation.set(0, yaw, 0)
    this.physics.velocity.set(0, 0, 0)
    this.physics.yawRate = 0
    this.verticalSpeed = 0
    this.inWater = false
    this.lastResult = { thrust: this.hands.map(() => 0), stroking: false, jetting: false }
    for (const hand of this.hands) hand.anchor = null
  }

  setTurnMode(mode: TurnMode): void {
    this.turnMode = mode
  }

  setSeated(seated: boolean): void {
    this.seated = seated
  }

  /** Drunk walking: a wobble added to stick input (only while you're moving) and a speed multiplier. */
  setDrunk(drift: number, speed: number): void {
    this.drunkDrift = drift
    this.drunkSpeed = speed
  }

  get speed(): number {
    return this.env?.kind === 'walk' ? Math.hypot(this.physics.velocity.x, this.physics.velocity.z) : this.physics.velocity.length()
  }

  get depth(): number {
    const env = this.env
    const surface = env?.kind === 'swim' ? env.surfaceY : (env?.waterY ?? 0)
    return Math.max(0, surface - this.camera.getWorldPosition(this.head).y)
  }

  refillFull(): void {
    this.air.fill()
  }

  update(dt: number, inXr: boolean, desktop: DesktopControls): void {
    const env = this.env
    if (!env) return
    this.clock += dt
    if (env.kind === 'swim') this.updateSwim(dt, inXr, desktop, env)
    else this.updateWalk(dt, inXr, desktop, env)
  }

  // ---- Walking --------------------------------------------------------------------------------

  private updateWalk(dt: number, inXr: boolean, desktop: DesktopControls, env: WalkEnvironment): void {
    this.lastResult.thrust.fill(0)
    this.camera.getWorldDirection(this.forward)
    this.forward.y = 0
    this.forward.normalize()
    this.right.set(-this.forward.z, 0, this.forward.x)

    let x = 0
    let y = 0
    let jump = false
    if (inXr) {
      const left = this.handed('left')
      const right = this.handed('right')
      if (left) [x, y] = deadzone(left.stick)
      // A/X jumps, unless that hand is busy (A/X reloads a held gun).
      jump = this.hands.some((h) => h.connected && h.primaryPressed && !h.held)
      if (right && !this.frozen) this.turn(dt, right.stick.x)
    } else {
      x = desktop.move.x
      y = desktop.move.y
      jump = desktop.jumpPressed
      this.rotateAroundHead(desktop.yawDelta)
      desktop.yawDelta = 0
    }

    if (this.frozen) {
      x = y = 0
      jump = false
    }
    // Drunk: the stick wanders a little, but never moves you if you aren't pushing it.
    if (this.drunkDrift > 0 && Math.hypot(x, y) > 0.1) {
      x += Math.sin(this.clock * 0.9) * this.drunkDrift + Math.sin(this.clock * 2.3) * this.drunkDrift * 0.4
      y += Math.cos(this.clock * 0.7) * this.drunkDrift * 0.6
    }
    const speed = WALK_SPEED * this.drunkSpeed
    const vel = this.physics.velocity
    vel.copy(this.forward).multiplyScalar(-y * speed).addScaledVector(this.right, x * speed)
    this.rig.position.addScaledVector(vel, dt)

    // Keep the head inside the walkable area (rails, cabin walls).
    this.rig.updateMatrixWorld(true)
    const head = this.camera.getWorldPosition(this.head)
    const before = this.v1.copy(head)
    env.constrain(head)
    this.rig.position.x += head.x - before.x
    this.rig.position.z += head.z - before.z

    // Gravity and ground following. The rig stays upright even if the ground tilts (comfort).
    if (jump && this.grounded) {
      this.verticalSpeed = JUMP_SPEED
      this.grounded = false
    }
    this.verticalSpeed -= GRAVITY * dt
    this.rig.position.y += this.verticalSpeed * dt
    const lift = this.seated ? SEATED_LIFT : 0
    const ground = env.groundHeight(head.x, head.z)
    if (ground !== null && this.rig.position.y <= ground + lift && this.verticalSpeed <= 0.5) {
      this.rig.position.y = ground + lift
      this.verticalSpeed = 0
      this.grounded = true
    } else {
      this.grounded = false
    }
    if (this.rig.position.y + 0.2 < env.waterY) this.inWater = true
  }

  // ---- Swimming -------------------------------------------------------------------------------

  private updateSwim(dt: number, inXr: boolean, desktop: DesktopControls, env: SwimEnvironment): void {
    if (this.respawning > 0) {
      this.updateRespawn(dt)
      return
    }

    this.camera.getWorldPosition(this.head)
    const hands = inXr ? this.buildXrSamples() : this.buildDesktopSamples(desktop)
    this.buildDrift(inXr, desktop)

    this.lastResult = this.physics.step({ hands, drift: this.drift, dt })
    this.rig.position.addScaledVector(this.physics.velocity, dt)
    if (this.physics.yawRate !== 0) this.rotateAroundHead(this.physics.yawRate * dt)

    if (inXr) {
      const right = this.handed('right')
      if (right) this.turn(dt, right.stick.x)
      this.applyAnchors(dt)
      this.emitJetFx(dt)
    } else {
      this.rotateAroundHead(desktop.yawDelta)
      desktop.yawDelta = 0
      if (desktop.jet) this.emitDesktopJetFx(dt)
    }
    this.collide(env)
    this.updateAir(dt, env, hands === this.desktopHands ? (desktop.jet ? [1, 1] : [0, 0]) : this.lastResult.thrust)
    this.emitExhale(dt)
  }

  private handed(side: XRHandedness): Hand | undefined {
    return this.hands.find((h) => h.connected && h.handedness === side)
  }

  private buildXrSamples(): HandSample[] {
    this.hands.forEach((hand, i) => {
      const s = this.samples[i]
      s.gripHeld = hand.connected && hand.squeeze && !hand.held && !hand.anchor
      s.trigger = hand.connected && !hand.held ? hand.trigger : 0
      s.velocity.copy(hand.localVel).applyQuaternion(this.rig.quaternion)
      hand.pointDir(s.pointDir)
      hand.worldPos(s.offset).sub(this.head)
    })
    return this.samples
  }

  private buildDesktopSamples(desktop: DesktopControls): HandSample[] {
    this.camera.getWorldDirection(this.forward)
    this.right.crossVectors(this.forward, this.camera.up).normalize()
    this.desktopHands.forEach((s, i) => {
      s.gripHeld = false
      s.trigger = desktop.jet ? 1 : 0
      s.pointDir.copy(this.forward).negate()
      s.offset.copy(this.right).multiplyScalar(i === 0 ? 0.25 : -0.25)
    })
    return this.desktopHands
  }

  private buildDrift(inXr: boolean, desktop: DesktopControls): void {
    // Thumbstick drift follows where you look (including up/down); right stick Y rises/sinks.
    this.camera.getWorldDirection(this.forward)
    this.right.crossVectors(this.forward, this.camera.up).normalize()
    let x = 0
    let y = 0
    let rise = 0
    if (inXr) {
      const left = this.handed('left')
      const right = this.handed('right')
      if (left) [x, y] = deadzone(left.stick)
      if (right) rise = -deadzone(right.stick)[1]
    } else {
      x = desktop.move.x
      y = desktop.move.y
      rise = desktop.rise
    }
    this.drift.copy(this.forward).multiplyScalar(-y).addScaledVector(this.right, x)
    this.drift.y += rise
    if (this.drift.lengthSq() > 1) this.drift.normalize()
  }

  private turn(dt: number, x: number): void {
    if (this.turnMode === 'smooth') {
      if (Math.abs(x) > 0.2) this.rotateAroundHead(-x * SMOOTH_TURN_SPEED * dt)
      return
    }
    if (this.snapArmed && Math.abs(x) > 0.7) {
      this.rotateAroundHead(-Math.sign(x) * SNAP_ANGLE)
      this.snapArmed = false
    } else if (Math.abs(x) < 0.3) {
      this.snapArmed = true
    }
  }

  /** Hands holding a rock or the seabed pull the diver so the hand stays put. */
  private applyAnchors(dt: number): void {
    const anchored = this.hands.filter((h) => h.connected && h.anchor)
    if (anchored.length === 0) return
    this.rig.updateMatrixWorld(true)
    const shift = this.v1.set(0, 0, 0)
    for (const hand of anchored) shift.add(hand.anchor!).sub(hand.worldPos(this.v2))
    shift.divideScalar(anchored.length)
    this.rig.position.add(shift)
    // Keep the momentum of the pull so letting go carries you on.
    const pullVelocity = shift.divideScalar(Math.max(dt, 1e-3))
    if (pullVelocity.length() > 3) pullVelocity.setLength(3)
    this.physics.velocity.lerp(pullVelocity, 0.5)
  }

  private rotateAroundHead(angle: number): void {
    if (angle === 0) return
    this.rig.updateMatrixWorld(true)
    const before = this.camera.getWorldPosition(this.v1)
    this.rig.rotation.y += angle
    this.rig.updateMatrixWorld(true)
    const after = this.camera.getWorldPosition(this.v2)
    this.rig.position.add(before.sub(after))
  }

  private collide(env: SwimEnvironment): void {
    this.rig.updateMatrixWorld(true)
    const head = this.camera.getWorldPosition(this.head)
    const push = this.v1.set(0, 0, 0)

    const floor = env.floorHeight(head.x, head.z) + HEAD_CLEARANCE
    if (head.y < floor) push.y += floor - head.y
    const ceiling = env.surfaceY - HEAD_CLEARANCE
    if (head.y > ceiling) push.y += ceiling - head.y

    for (const rock of env.rocks) {
      const offset = this.v2.subVectors(head, rock.center)
      const min = rock.radius + HEAD_CLEARANCE
      const dist = offset.length()
      if (dist < min && dist > 1e-4) push.addScaledVector(offset, (min - dist) / dist)
    }

    const horizontal = Math.hypot(head.x, head.z)
    if (horizontal > env.radius) {
      push.x -= (head.x / horizontal) * (horizontal - env.radius)
      push.z -= (head.z / horizontal) * (horizontal - env.radius)
    }

    if (push.lengthSq() === 0) return
    this.rig.position.add(push)
    // Cancel the velocity component that drove us into the obstacle.
    const normal = push.normalize()
    const into = this.physics.velocity.dot(normal)
    if (into < 0) this.physics.velocity.addScaledVector(normal, -into)
  }

  private updateAir(dt: number, env: SwimEnvironment, thrust: number[]): void {
    const head = this.camera.getWorldPosition(this.head)
    this.refilling = env.refillZones.some((z) => Math.hypot(head.x - z.center.x, head.z - z.center.z) < z.radius)
    if (this.refilling) this.air.refill(dt)
    else this.air.drain(dt, thrust)
    if (this.air.empty) this.respawning = 3
  }

  /** Out of air: fade out, float back to the checkpoint with a full tank, fade in. Never a permadeath. */
  private updateRespawn(dt: number): void {
    const before = this.respawning
    this.respawning = Math.max(0, this.respawning - dt)
    if (before > 1.5 && this.respawning <= 1.5) {
      this.rig.position.copy(this.checkpoint)
      this.physics.velocity.set(0, 0, 0)
      this.physics.yawRate = 0
      this.air.fill()
      for (const hand of this.hands) hand.anchor = null
    }
    // 3 → 1.5 s: fade out; 1.5 → 0 s: fade in.
    this.vignette.fade = this.respawning > 1.5 ? (3 - this.respawning) / 1.5 : this.respawning / 1.5
  }

  private emitJetFx(dt: number): void {
    if (!this.bubbles) return
    this.hands.forEach((hand, i) => {
      const thrust = this.lastResult.thrust[i] ?? 0
      if (thrust <= 0) return
      const origin = hand.worldPos(this.v1)
      const dir = hand.pointDir(this.v2)
      origin.addScaledVector(dir, 0.06)
      this.bubbles!.emit(origin, dir, Math.ceil(thrust * 90 * dt), 1.5 + thrust * 2.5, 0.3)
      hand.pulse(0.1 + thrust * 0.35, Math.ceil(dt * 1000) + 10)
    })
  }

  private emitDesktopJetFx(dt: number): void {
    if (!this.bubbles) return
    this.camera.getWorldDirection(this.v2).negate()
    const origin = this.camera.getWorldPosition(this.v1).addScaledVector(this.v2, 0.4)
    origin.y -= 0.5
    this.bubbles.emit(origin, this.v2, Math.ceil(120 * dt), 3, 0.3)
  }

  /** Regulator exhale: a burst of bubbles from the head every few seconds. */
  private emitExhale(dt: number): void {
    this.exhaleTimer += dt
    if (!this.bubbles || this.exhaleTimer < EXHALE_INTERVAL) return
    this.exhaleTimer = 0
    const origin = this.camera.getWorldPosition(this.v1)
    this.camera.getWorldDirection(this.v2)
    origin.addScaledVector(this.v2, 0.12)
    origin.y -= 0.05
    this.bubbles.emit(origin, this.v2.set(0, 1, 0), 22, 0.5, 1.2)
  }
}

function emptySample(): HandSample {
  return {
    gripHeld: false,
    trigger: 0,
    velocity: new THREE.Vector3(),
    pointDir: new THREE.Vector3(0, 0, -1),
    offset: new THREE.Vector3(),
  }
}

function deadzone(stick: THREE.Vector2): [number, number] {
  return stick.length() < 0.15 ? [0, 0] : [stick.x, stick.y]
}
