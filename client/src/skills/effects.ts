import * as THREE from 'three'
import type { Particles } from '../fx/Particles'

const TRAIL_SECONDS = 15

// Navigator: a trail of glowing motes from the diver to the next clue, for 15 s.
export class NavigatorTrail {
  private remaining = 0
  private emitTimer = 0
  private path: THREE.Vector3[] = []

  constructor(private readonly glow: Particles) {}

  get active(): boolean {
    return this.remaining > 0
  }

  show(path: THREE.Vector3[]): void {
    this.path = path.map((p) => p.clone())
    this.remaining = TRAIL_SECONDS
  }

  /** Keep the start of the trail at the diver as they move. */
  update(dt: number, from: THREE.Vector3, path: () => THREE.Vector3[]): void {
    if (this.remaining <= 0) return
    this.remaining -= dt
    this.emitTimer -= dt
    if (this.emitTimer > 0) return
    this.emitTimer = 0.35
    this.path = path()
    let a = from.clone()
    for (const b of this.path) {
      const length = a.distanceTo(b)
      for (let d = 0.5; d < length; d += 0.9) {
        const p = a.clone().lerp(b, d / length)
        this.glow.emit({ position: p, velocity: new THREE.Vector3(0, 0.05, 0), color: 0x9ff5ff, size: 0.12, endSize: 0.05, life: 1.2, alpha: 0.9 })
      }
      a = b.clone()
    }
  }
}

type FishPhase = 'gather' | 'fetch' | 'return' | 'done'

// Fish Whisperer: a school of bream swims out, fetches a treasure, and brings it back.
export class FishSchool {
  readonly mesh: THREE.InstancedMesh
  private phase: FishPhase = 'done'
  private readonly center = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private t = 0
  private onArrive: (() => void) | null = null
  private carried: THREE.Object3D | null = null
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly s = new THREE.Vector3(1, 1, 1)
  private readonly p = new THREE.Vector3()
  private readonly count = 14

  constructor(parent: THREE.Object3D) {
    const body = new THREE.ConeGeometry(0.05, 0.22, 6)
    body.rotateX(-Math.PI / 2)
    this.mesh = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0xb9c6cc, metalness: 0.6, roughness: 0.3 }), this.count)
    this.mesh.visible = false
    this.mesh.frustumCulled = false
    parent.add(this.mesh)
  }

  get busy(): boolean {
    return this.phase !== 'done'
  }

  /** Swim from the diver to `item`, then carry it back to wherever `home()` is. */
  fetch(from: THREE.Vector3, item: THREE.Object3D, arrive: () => void): void {
    this.center.copy(from)
    this.carried = item
    item.getWorldPosition(this.target)
    this.onArrive = arrive
    this.phase = 'gather'
    this.t = 0
    this.mesh.visible = true
  }

  update(dt: number, home: THREE.Vector3): void {
    if (this.phase === 'done') return
    this.t += dt
    const speed = 3
    if (this.phase === 'gather' && this.t > 1) this.phase = 'fetch'
    if (this.phase === 'fetch') {
      if (this.moveCenter(this.target, speed * dt)) this.phase = 'return'
    } else if (this.phase === 'return') {
      this.carried?.position.copy(this.center)
      if (this.moveCenter(home, speed * dt)) {
        this.phase = 'done'
        this.mesh.visible = false
        this.onArrive?.()
        return
      }
    }
    // Each fish circles the school's centre.
    for (let i = 0; i < this.count; i++) {
      const a = this.t * 2.5 + (i / this.count) * Math.PI * 2
      const r = 0.35 + (i % 3) * 0.12
      this.p.set(Math.cos(a) * r, Math.sin(a * 1.7 + i) * 0.15, Math.sin(a) * r).add(this.center)
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -a)
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s))
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  private moveCenter(goal: THREE.Vector3, step: number): boolean {
    const d = this.center.distanceTo(goal)
    if (d <= step) {
      this.center.copy(goal)
      return true
    }
    this.center.lerp(goal, step / d)
    return false
  }
}
