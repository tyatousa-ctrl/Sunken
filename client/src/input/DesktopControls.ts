import * as THREE from 'three'

// Keyboard + mouse fallback for testing without a headset:
// drag to look, WASD to drift, Q/E to sink/rise, hold Shift for bubble jets.
export class DesktopControls {
  readonly move = new THREE.Vector2()
  rise = 0
  jet = false
  /** Accumulated yaw from mouse drag since the last frame (radians). */
  yawDelta = 0

  private readonly keys = new Set<string>()
  private pitch = 0

  constructor(
    element: HTMLElement,
    private readonly camera: THREE.Camera,
  ) {
    window.addEventListener('keydown', (e) => this.keys.add(e.code))
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
    element.addEventListener('pointermove', (e) => {
      if (!(e.buttons & 1)) return
      this.yawDelta -= e.movementX * 0.004
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.004, -1.4, 1.4)
    })
  }

  update(): void {
    const k = this.keys
    this.move.set((k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0), (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0))
    this.rise = (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0)
    this.jet = k.has('ShiftLeft') || k.has('ShiftRight')
    this.camera.rotation.set(this.pitch, 0, 0)
  }
}
