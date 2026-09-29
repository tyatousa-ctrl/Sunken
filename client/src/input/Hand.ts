import * as THREE from 'three'
import type { Grabbable } from '../interaction/GrabSystem'

type Haptics = { hapticActuators?: { pulse?: (value: number, duration: number) => unknown }[] }

const GRIP_ON = 0.6
const GRIP_OFF = 0.4

// One tracked Quest Touch controller: buttons, thumbstick, pose and velocity in rig space, haptics.
export class Hand {
  handedness: XRHandedness = 'none'
  source: XRInputSource | null = null

  trigger = 0
  squeeze = false
  squeezePressed = false
  squeezeReleased = false
  readonly stick = new THREE.Vector2()
  /** A (right) / X (left). */
  primaryPressed = false
  /** B (right) / Y (left). */
  secondaryPressed = false

  /** Grip position in rig space, and its smoothed velocity (m/s). */
  readonly localPos = new THREE.Vector3()
  readonly localVel = new THREE.Vector3()

  held: Grabbable | null = null
  /** World point this hand is holding on to (a rock ledge), if any. */
  anchor: THREE.Vector3 | null = null

  private readonly prevLocal = new THREE.Vector3()
  private hasPrev = false
  private primaryDown = false
  private secondaryDown = false
  private readonly q = new THREE.Quaternion()

  constructor(
    readonly grip: THREE.XRGripSpace,
    readonly ray: THREE.XRTargetRaySpace,
  ) {}

  get connected(): boolean {
    return this.source !== null
  }

  update(dt: number): void {
    const pad = this.source?.gamepad
    const wasSqueezed = this.squeeze
    if (pad) {
      this.trigger = pad.buttons[0]?.value ?? 0
      const grip = pad.buttons[1]?.value ?? 0
      this.squeeze = this.squeeze ? grip > GRIP_OFF : grip > GRIP_ON
      this.stick.set(pad.axes[2] ?? 0, pad.axes[3] ?? 0)
      const primary = pad.buttons[4]?.pressed ?? false
      const secondary = pad.buttons[5]?.pressed ?? false
      this.primaryPressed = primary && !this.primaryDown
      this.secondaryPressed = secondary && !this.secondaryDown
      this.primaryDown = primary
      this.secondaryDown = secondary
    } else {
      this.trigger = 0
      this.squeeze = false
      this.stick.set(0, 0)
      this.primaryPressed = this.secondaryPressed = false
    }
    this.squeezePressed = this.squeeze && !wasSqueezed
    this.squeezeReleased = !this.squeeze && wasSqueezed

    this.localPos.copy(this.grip.position)
    if (this.hasPrev && dt > 0 && this.connected) {
      const raw = this.prevLocal.sub(this.localPos).multiplyScalar(-1 / dt)
      this.localVel.lerp(raw, 0.5)
    } else {
      this.localVel.set(0, 0, 0)
    }
    this.prevLocal.copy(this.localPos)
    this.hasPrev = this.connected
  }

  worldPos(target: THREE.Vector3): THREE.Vector3 {
    return this.grip.getWorldPosition(target)
  }

  /** Direction the controller points (its target ray), world space. */
  pointDir(target: THREE.Vector3): THREE.Vector3 {
    return target.set(0, 0, -1).applyQuaternion(this.ray.getWorldQuaternion(this.q))
  }

  pulse(intensity: number, ms: number): void {
    const actuator = (this.source?.gamepad as (Gamepad & Haptics) | undefined)?.hapticActuators?.[0]
    actuator?.pulse?.(Math.min(1, intensity), ms)
  }
}
