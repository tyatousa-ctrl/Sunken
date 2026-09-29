import * as THREE from 'three'

const MAX_BUBBLES = 900
const HIDDEN_Y = -9999

// Pooled bubble particles in a single draw call. Bubbles rise, wobble and pop after a few seconds.
export class Bubbles {
  readonly points: THREE.Points
  private readonly positions = new Float32Array(MAX_BUBBLES * 3)
  private readonly velocities = new Float32Array(MAX_BUBBLES * 3)
  private readonly life = new Float32Array(MAX_BUBBLES)
  private readonly seeds = new Float32Array(MAX_BUBBLES)
  private next = 0
  private elapsed = 0

  constructor(private readonly ceilingY: number) {
    for (let i = 0; i < MAX_BUBBLES; i++) {
      this.positions[i * 3 + 1] = HIDDEN_Y
      this.seeds[i] = Math.random() * 100
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.035,
        map: makeBubbleTexture(),
        transparent: true,
        depthWrite: false,
        color: 0xe6f7ff,
      }),
    )
    // Particles move every frame; skip bounds-based culling.
    this.points.frustumCulled = false
  }

  /** Emit `count` bubbles at `origin` travelling along `direction` at roughly `speed` m/s. */
  emit(origin: THREE.Vector3, direction: THREE.Vector3, count: number, speed: number, spread = 0.35): void {
    for (let n = 0; n < count; n++) {
      const i = this.next
      this.next = (this.next + 1) % MAX_BUBBLES
      const s = speed * (0.6 + Math.random() * 0.6)
      this.positions[i * 3] = origin.x + (Math.random() - 0.5) * 0.03
      this.positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.03
      this.positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.03
      this.velocities[i * 3] = (direction.x + (Math.random() - 0.5) * spread) * s
      this.velocities[i * 3 + 1] = (direction.y + (Math.random() - 0.5) * spread) * s
      this.velocities[i * 3 + 2] = (direction.z + (Math.random() - 0.5) * spread) * s
      this.life[i] = 2.5 + Math.random() * 2
    }
  }

  update(dt: number): void {
    this.elapsed += dt
    const damping = Math.exp(-2.2 * dt)
    for (let i = 0; i < MAX_BUBBLES; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      const i3 = i * 3
      if (this.life[i] <= 0 || this.positions[i3 + 1] > this.ceilingY) {
        this.life[i] = 0
        this.positions[i3 + 1] = HIDDEN_Y
        continue
      }
      this.velocities[i3] *= damping
      this.velocities[i3 + 1] = this.velocities[i3 + 1] * damping + 1.6 * dt
      this.velocities[i3 + 2] *= damping
      const wobble = Math.sin(this.elapsed * 7 + this.seeds[i]) * 0.12
      this.positions[i3] += (this.velocities[i3] + wobble) * dt
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt
      this.positions[i3 + 2] += (this.velocities[i3 + 2] + Math.cos(this.elapsed * 6 + this.seeds[i]) * 0.1) * dt
    }
    this.points.geometry.attributes.position.needsUpdate = true
  }
}

function makeBubbleTexture(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.2, size * 0.5, size * 0.5, size * 0.48)
  gradient.addColorStop(0, 'rgba(255,255,255,0.08)')
  gradient.addColorStop(0.75, 'rgba(255,255,255,0.35)')
  gradient.addColorStop(0.92, 'rgba(255,255,255,0.95)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.arc(size * 0.36, size * 0.34, size * 0.08, 0, Math.PI * 2)
  ctx.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
