import * as THREE from 'three'
import type { Interactable } from '../interaction/GrabSystem'

type Haptics = { hapticActuators?: { pulse?: (value: number, duration: number) => unknown }[] }

const GRIP_ON = 0.6
const GRIP_OFF = 0.4
const TRIGGER_ON = 0.75
const TRIGGER_OFF = 0.35

/** Keyboard-driven stand-in for a controller (desktop testing). */
export interface VirtualPad {
  trigger: number
  grip: number
  stick: THREE.Vector2
  primary: boolean
  secondary: boolean
  stickClick: boolean
}

// One tracked Quest Touch controller: buttons, thumbstick, pose and velocity in rig space, haptics.
export class Hand {
  handedness: XRHandedness = 'none'
  source: XRInputSource | null = null

  trigger = 0
  /** Trigger crossed the "fire" threshold this frame. */
  triggerPressed = false
  squeeze = false
  squeezePressed = false
  squeezeReleased = false
  readonly stick = new THREE.Vector2()
  /** A (right) / X (left). */
  primaryPressed = false
  /** B (right) / Y (left). */
  secondaryPressed = false
  /** Thumbstick clicked in this frame. */
  stickPressed = false

  /** Grip position in rig space, and its smoothed velocity (m/s). */
  readonly localPos = new THREE.Vector3()
  readonly localVel = new THREE.Vector3()

  held: Interactable | null = null
  virtual: VirtualPad | null = null
  /** World point this hand is holding on to (a rock ledge), if any. */
  anchor: THREE.Vector3 | null = null

  private readonly prevLocal = new THREE.Vector3()
  private hasPrev = false
  private triggerDown = false
  private primaryDown = false
  private stickDown = false
  private secondaryDown = false
  private readonly q = new THREE.Quaternion()

  constructor(
    readonly grip: THREE.Object3D,
    readonly ray: THREE.Object3D,
  ) {}

  get connected(): boolean {
    return this.source !== null || this.virtual !== null
  }

  update(dt: number): void {
    const pad = this.source?.gamepad
    const wasSqueezed = this.squeeze
    const v = this.virtual
    if (pad || v) {
      this.trigger = pad ? (pad.buttons[0]?.value ?? 0) : v!.trigger
      const grip = pad ? (pad.buttons[1]?.value ?? 0) : v!.grip
      this.squeeze = this.squeeze ? grip > GRIP_OFF : grip > GRIP_ON
      if (pad) this.stick.set(pad.axes[2] ?? 0, pad.axes[3] ?? 0)
      else this.stick.copy(v!.stick)
      const primary = pad ? (pad.buttons[4]?.pressed ?? false) : v!.primary
      const secondary = pad ? (pad.buttons[5]?.pressed ?? false) : v!.secondary
      this.primaryPressed = primary && !this.primaryDown
      this.secondaryPressed = secondary && !this.secondaryDown
      this.primaryDown = primary
      this.secondaryDown = secondary
      const stick = pad ? (pad.buttons[3]?.pressed ?? false) : v!.stickClick
      this.stickPressed = stick && !this.stickDown
      this.stickDown = stick
    } else {
      this.trigger = 0
      this.squeeze = false
      this.stick.set(0, 0)
      this.primaryPressed = this.secondaryPressed = this.stickPressed = false
    }
    this.squeezePressed = this.squeeze && !wasSqueezed
    this.squeezeReleased = !this.squeeze && wasSqueezed
    const wasTriggered = this.triggerDown
    this.triggerDown = this.triggerDown ? this.trigger > TRIGGER_OFF : this.trigger > TRIGGER_ON
    this.triggerPressed = this.triggerDown && !wasTriggered

    // Virtual hands ride on the camera, so their "local" pose is taken in world space.
    if (this.virtual) this.grip.getWorldPosition(this.localPos)
    else this.localPos.copy(this.grip.position)
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
