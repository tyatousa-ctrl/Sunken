import * as THREE from 'three'
import { Hand, type VirtualPad } from './Hand'
import type { SpellShape } from '../systems/gesture'

// Keyboard + mouse fallback for testing without a headset. Drag to look; WASD to walk/drift;
// Space jumps on deck (rises underwater), Q sinks; Shift fires bubble jets.
// A virtual right hand floats in front of the camera: F = trigger, E = grip (toggle), R = A button
// (reload / backpack), B = B button (skill), M = thumbstick click (map), 1/2/3 = cast a spell.
export class DesktopControls {
  readonly move = new THREE.Vector2()
  rise = 0
  jet = false
  jumpPressed = false
  /** Spell cast by number key this frame (desktop has no hand to draw with). */
  spell: SpellShape | null = null
  /** Accumulated yaw from mouse drag since the last frame (radians). */
  yawDelta = 0
  readonly hand: Hand

  private readonly keys = new Set<string>()
  private readonly pressed = new Set<string>()
  private pitch = 0
  private readonly pad: VirtualPad = { trigger: 0, grip: 0, stick: new THREE.Vector2(), primary: false, secondary: false, stickClick: false }

  constructor(
    element: HTMLElement,
    private readonly camera: THREE.Camera,
  ) {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code)
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
    element.addEventListener('pointermove', (e) => {
      if (!(e.buttons & 1)) return
      this.yawDelta -= e.movementX * 0.004
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.004, -1.4, 1.4)
    })

    // The virtual hand hangs off the camera, lower right, pointing where you look.
    const grip = new THREE.Group()
    grip.position.set(0.22, -0.2, -0.45)
    camera.add(grip)
    this.hand = new Hand(grip, grip)
    this.hand.handedness = 'right'
  }

  /** Enable or disable the virtual hand (off while a headset is in use). */
  setActive(active: boolean): void {
    this.hand.virtual = active ? this.pad : null
  }

  update(): void {
    const k = this.keys
    this.move.set((k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0), (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0))
    this.rise = (k.has('Space') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0)
    this.jumpPressed = this.pressed.has('Space')
    this.jet = k.has('ShiftLeft') || k.has('ShiftRight')
    this.camera.rotation.set(this.pitch, 0, 0)

    this.pad.trigger = k.has('KeyF') || this.pressed.has('KeyF') ? 1 : 0
    if (this.pressed.has('KeyE')) this.pad.grip = this.pad.grip > 0.5 ? 0 : 1
    // Count a tap even if the key went down and up between two frames.
    const held = (code: string) => k.has(code) || this.pressed.has(code)
    this.pad.primary = held('KeyR')
    this.pad.secondary = held('KeyB')
    this.pad.stickClick = held('KeyM')
    this.spell = this.pressed.has('Digit1') ? 'circle' : this.pressed.has('Digit2') ? 'triangle' : this.pressed.has('Digit3') ? 'zigzag' : null
    this.pressed.clear()
  }
}
