import * as THREE from 'three'

export interface ParticleOptions {
  max: number
  blending?: THREE.Blending
  /** Constant acceleration (m/s²), e.g. gravity or smoke rise. */
  gravity?: number
  /** Velocity decay per second. */
  drag?: number
}

export interface EmitOptions {
  position: THREE.Vector3
  velocity?: THREE.Vector3
  /** Random extra speed in every direction (m/s). */
  spread?: number
  count?: number
  color: THREE.ColorRepresentation
  /** Particle size in metres at birth and death. */
  size: number
  endSize?: number
  life: number
  alpha?: number
}

// Pooled billboard particles in one draw call, with per-particle colour, size and alpha
// (smoke, fire, muzzle flashes, splashes, splinters).
export class Particles {
  readonly points: THREE.Points
  private readonly count: number
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly col: Float32Array
  private readonly alpha: Float32Array
  private readonly size: Float32Array
  private readonly startSize: Float32Array
  private readonly endSize: Float32Array
  private readonly startAlpha: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private next = 0
  private readonly color = new THREE.Color()
  private readonly uniforms = { uHalfHeight: { value: 600 }, uMap: { value: softDot() } }

  constructor(private readonly options: ParticleOptions) {
    const n = (this.count = options.max)
    this.pos = new Float32Array(n * 3)
    this.vel = new Float32Array(n * 3)
    this.col = new Float32Array(n * 3)
    this.alpha = new Float32Array(n)
    this.size = new Float32Array(n)
    this.startSize = new Float32Array(n)
    this.endSize = new Float32Array(n)
    this.startAlpha = new Float32Array(n)
    this.life = new Float32Array(n)
    this.maxLife = new Float32Array(n)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float alpha;
        attribute float size;
        attribute vec3 color;
        uniform float uHalfHeight;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = alpha <= 0.0 ? 0.0 : size * projectionMatrix[1][1] * uHalfHeight / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: options.blending ?? THREE.NormalBlending,
    })
    this.points = new THREE.Points(geometry, material)
    this.points.frustumCulled = false
  }

  emit(o: EmitOptions): void {
    const count = o.count ?? 1
    const spread = o.spread ?? 0
    this.color.set(o.color)
    for (let k = 0; k < count; k++) {
      const i = this.next
      this.next = (this.next + 1) % this.count
      const i3 = i * 3
      this.pos[i3] = o.position.x
      this.pos[i3 + 1] = o.position.y
      this.pos[i3 + 2] = o.position.z
      this.vel[i3] = (o.velocity?.x ?? 0) + (Math.random() - 0.5) * 2 * spread
      this.vel[i3 + 1] = (o.velocity?.y ?? 0) + (Math.random() - 0.5) * 2 * spread
      this.vel[i3 + 2] = (o.velocity?.z ?? 0) + (Math.random() - 0.5) * 2 * spread
      this.col[i3] = this.color.r
      this.col[i3 + 1] = this.color.g
      this.col[i3 + 2] = this.color.b
      const life = o.life * (0.7 + Math.random() * 0.6)
      this.life[i] = this.maxLife[i] = life
      this.startSize[i] = o.size * (0.8 + Math.random() * 0.4)
      this.endSize[i] = o.endSize ?? o.size
      this.startAlpha[i] = o.alpha ?? 1
      this.alpha[i] = this.startAlpha[i]
      this.size[i] = this.startSize[i]
    }
  }

  /** `halfHeight` is half the render target height in pixels (per eye in XR). */
  update(dt: number, halfHeight: number): void {
    this.uniforms.uHalfHeight.value = halfHeight
    const g = this.options.gravity ?? 0
    const damping = Math.exp(-(this.options.drag ?? 0) * dt)
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.alpha[i] = 0
        continue
      }
      const i3 = i * 3
      this.vel[i3] *= damping
      this.vel[i3 + 1] = this.vel[i3 + 1] * damping + g * dt
      this.vel[i3 + 2] *= damping
      this.pos[i3] += this.vel[i3] * dt
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt
      const t = 1 - this.life[i] / this.maxLife[i]
      this.size[i] = this.startSize[i] + (this.endSize[i] - this.startSize[i]) * t
      // Quick fade-in, long fade-out.
      this.alpha[i] = this.startAlpha[i] * Math.min(1, t * 8) * (1 - t)
    }
    const attrs = this.points.geometry.attributes
    attrs.position.needsUpdate = true
    attrs.alpha.needsUpdate = true
    attrs.size.needsUpdate = true
    attrs.color.needsUpdate = true
  }

  dispose(): void {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}

let dotTexture: THREE.Texture | null = null
function softDot(): THREE.Texture {
  if (dotTexture) return dotTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  dotTexture = new THREE.CanvasTexture(canvas)
  return dotTexture
}
