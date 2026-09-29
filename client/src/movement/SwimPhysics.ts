import { Vector3 } from 'three'
import { TUNING as T } from './tuning'

export interface HandSample {
  /** Grip held on empty water (not holding an item or a ledge). */
  gripHeld: boolean
  /** Analog trigger 0–1. */
  trigger: number
  /** Hand velocity relative to the body, in world orientation (m/s). */
  velocity: Vector3
  /** Unit vector the hand points along, world space. */
  pointDir: Vector3
  /** Hand position relative to the head, world orientation (m). */
  offset: Vector3
}

export interface SwimInput {
  hands: HandSample[]
  /** Thumbstick drift, world space, length 0–1. */
  drift: Vector3
  dt: number
}

export interface SwimResult {
  /** Effective jet thrust 0–1 per hand, same order as the input. */
  thrust: number[]
  stroking: boolean
  jetting: boolean
}

// Neutral-buoyancy diver physics: no gravity, water drag, arm strokes, bubble jets, thumbstick drift.
export class SwimPhysics {
  readonly velocity = new Vector3()
  yawRate = 0

  private readonly accel = new Vector3()
  private readonly tmp = new Vector3()

  step(input: SwimInput): SwimResult {
    const { hands, dt } = input
    const accel = this.accel.set(0, 0, 0)
    const thrust = hands.map((h) => (h.trigger > T.jetDeadzone ? Math.min(h.trigger, 1) : 0))
    const jetCount = thrust.filter((t) => t > 0).length
    const jetScale = jetCount >= 2 ? T.dualJetMultiplier / jetCount : 1
    let stroking = false

    hands.forEach((hand, i) => {
      // Jets push the diver opposite to where the palm points.
      if (thrust[i] > 0) accel.addScaledVector(hand.pointDir, -T.jetAccel * thrust[i] * jetScale)

      // Strokes pull water: force opposite to the hand's motion through it.
      if (hand.gripHeld && hand.velocity.length() > T.strokeThreshold) {
        this.tmp.copy(hand.velocity).multiplyScalar(-T.strokeStrength)
        if (this.tmp.length() > T.strokeAccelCap) this.tmp.setLength(T.strokeAccelCap)
        // A stroke can't push you faster than swim speed in its own direction: it fades out as you get there.
        const alongStroke = this.velocity.dot(this.tmp) / this.tmp.length()
        accel.addScaledVector(this.tmp, Math.max(0, 1 - alongStroke / T.swimMaxSpeed))
        stroking = true
      }
    })

    accel.addScaledVector(input.drift, T.driftSpeed * T.drag)

    this.velocity.addScaledVector(accel, dt)
    this.velocity.multiplyScalar(Math.exp(-T.drag * dt))

    const cap = jetCount > 0 ? T.jetMaxSpeed : T.swimMaxSpeed
    const speed = this.velocity.length()
    if (speed > cap) this.velocity.setLength(cap + (speed - cap) * Math.exp(-T.overspeedDrag * dt))
    if (this.velocity.length() > T.jetMaxSpeed) this.velocity.setLength(T.jetMaxSpeed)

    this.updateSpin(hands, thrust, dt)
    return { thrust, stroking, jetting: jetCount > 0 }
  }

  private updateSpin(hands: HandSample[], thrust: number[], dt: number): void {
    let torque = 0
    const opposed =
      hands.length >= 2 && thrust[0] > 0 && thrust[1] > 0 && hands[0].pointDir.dot(hands[1].pointDir) < T.spinOpposedDot
    if (opposed) {
      hands.forEach((hand, i) => {
        // Yaw torque = (offset × force).y, with force = -pointDir · thrust.
        const fx = -hand.pointDir.x * thrust[i]
        const fz = -hand.pointDir.z * thrust[i]
        torque += hand.offset.z * fx - hand.offset.x * fz
      })
    }
    this.yawRate += torque * T.spinGain * dt
    this.yawRate *= Math.exp(-T.spinDamping * dt)
    this.yawRate = Math.max(-T.maxYawRate, Math.min(T.maxYawRate, this.yawRate))
  }
}
