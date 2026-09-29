import * as THREE from 'three'
import type { Hand } from '../input/Hand'
import type { DesktopControls } from '../input/DesktopControls'
import type { Bubbles } from '../world/Bubbles'
import { sandHeight, SANDBOX_RADIUS, SURFACE_Y, VENT_POSITION, VENT_RADIUS, type RockCollider } from '../world/SeabedScene'
import { AirTank } from './AirTank'
import { SwimPhysics, type HandSample, type SwimResult } from './SwimPhysics'
import type { ComfortVignette } from './ComfortVignette'

export type TurnMode = 'snap' | 'smooth'

const SNAP_ANGLE = THREE.MathUtils.degToRad(30)
const SMOOTH_TURN_SPEED = 1.6
const HEAD_CLEARANCE = 0.35
const EXHALE_INTERVAL = 4

// The local diver: turns controller input into movement of the rig, keeps the head out of
// rocks and sand, and manages air, respawn fades, jet bubbles and jet haptics.
export class Player {
  readonly physics = new SwimPhysics()
  readonly air = new AirTank()
  readonly checkpoint = new THREE.Vector3(0, 0.6, 4)
  refilling = false
  lastResult: SwimResult = { thrust: [], stroking: false, jetting: false }

  private turnMode: TurnMode
  private snapArmed = true
  private respawning = 0
  private exhaleTimer = 0
  private readonly samples: HandSample[]
  private readonly head = new THREE.Vector3()
  private readonly v1 = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly drift = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly desktopHands: HandSample[]

  constructor(
    private readonly rig: THREE.Group,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly hands: Hand[],
    private readonly rocks: RockCollider[],
    private readonly bubbles: Bubbles,
    private readonly vignette: ComfortVignette,
    turnMode: TurnMode,
  ) {
    this.turnMode = turnMode
    this.samples = hands.map(() => emptySample())
    // Desktop Shift-jets: two virtual hands at the hips pointing backwards.
    this.desktopHands = [emptySample(), emptySample()]
    rig.position.copy(this.checkpoint)
  }

  setTurnMode(mode: TurnMode): void {
    this.turnMode = mode
  }

  get speed(): number {
    return this.physics.velocity.length()
  }

  get depth(): number {
    return SURFACE_Y - this.camera.getWorldPosition(this.head).y
  }

  refillFull(): void {
    this.air.fill()
  }

  update(dt: number, inXr: boolean, desktop: DesktopControls): void {
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
      this.handleTurning(dt)
      this.applyAnchors(dt)
      this.emitJetFx(dt)
    } else {
      this.rotateAroundHead(desktop.yawDelta)
      desktop.yawDelta = 0
      if (desktop.jet) this.emitDesktopJetFx(dt)
    }
    this.collide()
    this.updateAir(dt, hands === this.desktopHands ? (desktop.jet ? [1, 1] : [0, 0]) : this.lastResult.thrust)
    this.emitExhale(dt)
  }

  private buildXrSamples(): HandSample[] {
    this.hands.forEach((hand, i) => {
      const s = this.samples[i]
      s.gripHeld = hand.connected && hand.squeeze && !hand.held && !hand.anchor
      s.trigger = hand.connected ? hand.trigger : 0
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
      const left = this.hands.find((h) => h.connected && h.handedness === 'left')
      const right = this.hands.find((h) => h.connected && h.handedness === 'right')
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

  private handleTurning(dt: number): void {
    const right = this.hands.find((h) => h.connected && h.handedness === 'right')
    if (!right) return
    const x = right.stick.x
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

  private collide(): void {
    this.rig.updateMatrixWorld(true)
    const head = this.camera.getWorldPosition(this.head)
    const push = this.v1.set(0, 0, 0)

    const floor = sandHeight(head.x, head.z) + HEAD_CLEARANCE
    if (head.y < floor) push.y += floor - head.y
    const ceiling = SURFACE_Y - HEAD_CLEARANCE
    if (head.y > ceiling) push.y += ceiling - head.y

    for (const rock of this.rocks) {
      const offset = this.v2.subVectors(head, rock.center)
      const min = rock.radius + HEAD_CLEARANCE
      const dist = offset.length()
      if (dist < min && dist > 1e-4) push.addScaledVector(offset, (min - dist) / dist)
    }

    const horizontal = Math.hypot(head.x, head.z)
    if (horizontal > SANDBOX_RADIUS) {
      push.x -= (head.x / horizontal) * (horizontal - SANDBOX_RADIUS)
      push.z -= (head.z / horizontal) * (horizontal - SANDBOX_RADIUS)
    }

    if (push.lengthSq() === 0) return
    this.rig.position.add(push)
    // Cancel the velocity component that drove us into the obstacle.
    const normal = push.normalize()
    const into = this.physics.velocity.dot(normal)
    if (into < 0) this.physics.velocity.addScaledVector(normal, -into)
  }

  private updateAir(dt: number, thrust: number[]): void {
    const head = this.camera.getWorldPosition(this.head)
    const ventDist = Math.hypot(head.x - VENT_POSITION.x, head.z - VENT_POSITION.z)
    this.refilling = ventDist < VENT_RADIUS
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
    this.hands.forEach((hand, i) => {
      const thrust = this.lastResult.thrust[i] ?? 0
      if (thrust <= 0) return
      const origin = hand.worldPos(this.v1)
      const dir = hand.pointDir(this.v2)
      origin.addScaledVector(dir, 0.06)
      this.bubbles.emit(origin, dir, Math.ceil(thrust * 90 * dt), 1.5 + thrust * 2.5, 0.3)
      hand.pulse(0.1 + thrust * 0.35, Math.ceil(dt * 1000) + 10)
    })
  }

  private emitDesktopJetFx(dt: number): void {
    this.camera.getWorldDirection(this.v2).negate()
    const origin = this.camera.getWorldPosition(this.v1).addScaledVector(this.v2, 0.4)
    origin.y -= 0.5
    this.bubbles.emit(origin, this.v2, Math.ceil(120 * dt), 3, 0.3)
  }

  /** Regulator exhale: a burst of bubbles from the head every few seconds. */
  private emitExhale(dt: number): void {
    this.exhaleTimer += dt
    if (this.exhaleTimer < EXHALE_INTERVAL) return
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
