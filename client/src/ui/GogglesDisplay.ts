import * as THREE from 'three'

export interface GogglesStatus {
  air: number
  depth: number
  refilling: boolean
}

/** Below this much air the goggles shake and tell you to surface. */
const LOW_AIR = 0.2
const SHAKE_EVERY = 3
const SHAKE_SECONDS = 0.6

// A little heads-up readout printed inside the dive goggles' glass, in the top-left of view: the air
// gauge and depth (the mini map sits in the top right, on the same glass). It only shows while the
// mask is on. Below 20% air the glass shakes every 3 seconds with a buzz in both hands, and a red
// "GO TO THE SURFACE!" shows, until you breathe again (or it runs out).
export class GogglesDisplay {
  /** The glass the readouts are printed on (the mini map hangs here too); it's what shakes. */
  readonly glass = new THREE.Group()
  private readonly warnCanvas = document.createElement('canvas')
  private readonly warnTexture: THREE.CanvasTexture
  private readonly warning: THREE.Mesh
  private shakeClock = 0
  private shaking = 0
  private warned = false
  /** Called at each shake (the game buzzes both hands). */
  onShake: () => void = () => {}
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D
  private readonly texture: THREE.CanvasTexture
  private readonly panel: THREE.Mesh
  private sinceDraw = 1
  private blink = 0

  constructor(camera: THREE.Camera) {
    this.canvas.width = 256
    this.canvas.height = 96
    this.ctx = this.canvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.066, 0.025),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
    )
    // Up and to the left, inside the mask's rim, tilted to face the eye: a glance up-left reads it.
    this.panel.position.set(-0.106, 0.076, -0.26)
    this.panel.rotation.set(-0.24, 0.36, 0, 'YXZ')
    this.panel.renderOrder = 1001
    this.panel.frustumCulled = false
    this.panel.visible = false
    ;(this.panel.material as THREE.MeshBasicMaterial).opacity = 0.95
    this.glass.add(this.panel)
    camera.add(this.glass)

    // The low-air warning: top centre of the glass, red.
    this.warnCanvas.width = 512
    this.warnCanvas.height = 96
    this.warnTexture = new THREE.CanvasTexture(this.warnCanvas)
    this.warnTexture.colorSpace = THREE.SRGBColorSpace
    const ctx = this.warnCanvas.getContext('2d')!
    ctx.fillStyle = 'rgba(60, 4, 4, 0.7)'
    roundRect(ctx, 4, 4, 504, 88, 20)
    ctx.fill()
    ctx.strokeStyle = '#ff4d4d'
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 44px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('GO TO THE SURFACE!', 256, 50, 470)
    this.warnTexture.needsUpdate = true
    this.warning = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.019),
      new THREE.MeshBasicMaterial({ map: this.warnTexture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
    )
    this.warning.position.set(0, 0.052, -0.26)
    this.warning.rotation.x = -0.18
    this.warning.renderOrder = 1003
    this.warning.frustumCulled = false
    this.warning.visible = false
    this.glass.add(this.warning)
  }

  /** Low on air, the warning flashing and the glass shaking every few seconds. */
  private lowAir(dt: number, status: GogglesStatus): void {
    const low = status.air < LOW_AIR && status.air > 0 && !status.refilling && status.depth > 0.3
    this.warning.visible = low && Math.floor(this.blink * 2.5) % 3 !== 2
    if (!low) {
      this.shakeClock = 0
      this.shaking = 0
      this.warned = false
      this.glass.position.set(0, 0, 0)
      this.glass.rotation.set(0, 0, 0)
      return
    }
    this.shakeClock -= dt
    if (this.shakeClock <= 0) {
      this.shakeClock = SHAKE_EVERY
      this.shaking = SHAKE_SECONDS
      this.onShake()
      this.warned = true
    }
    this.shaking = Math.max(0, this.shaking - dt)
    const k = this.shaking / SHAKE_SECONDS
    const t = this.blink * 60
    this.glass.position.set(Math.sin(t * 1.3) * 0.004 * k, Math.sin(t * 1.7) * 0.003 * k, 0)
    this.glass.rotation.z = Math.sin(t) * 0.03 * k
  }

  /** Whether the warning has started (for tests and the HUD). */
  get warningOn(): boolean {
    return this.warned
  }

  update(dt: number, visible: boolean, status: GogglesStatus): void {
    this.panel.visible = visible
    this.blink += dt
    this.lowAir(dt, visible ? status : { ...status, air: 1 })
    if (!visible) return
    this.sinceDraw += dt
    if (this.sinceDraw < 0.1) return
    this.sinceDraw = 0

    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    const pct = Math.round(status.air * 100)
    const low = status.air < 0.25
    const critical = status.air < 0.1
    ctx.clearRect(0, 0, w, h)
    // Faint smoked-glass backing so it reads against bright water.
    ctx.fillStyle = 'rgba(4, 20, 30, 0.45)'
    roundRect(ctx, 2, 2, w - 4, h - 4, 14)
    ctx.fill()

    const barColor = critical ? (Math.floor(this.blink * 3) % 2 ? '#ff4d4d' : '#5a1111') : low ? '#ffb347' : '#5fe0ff'
    ctx.fillStyle = 'rgba(95, 224, 255, 0.18)'
    ctx.fillRect(14, 14, w - 28, 30)
    ctx.fillStyle = barColor
    ctx.fillRect(14, 14, (w - 28) * status.air, 30)
    ctx.font = 'bold 24px monospace'
    ctx.lineWidth = 5
    ctx.strokeStyle = '#04141d'
    const label = `AIR ${pct}%${status.refilling ? ' +' : ''}`
    ctx.strokeText(label, 22, 38)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, 22, 38)

    ctx.font = 'bold 26px monospace'
    ctx.fillStyle = '#d8f4ff'
    ctx.fillText(status.depth > 0.3 ? `▼ ${status.depth.toFixed(1)} m` : 'SURFACE', 16, 80)
    if (low) {
      ctx.textAlign = 'right'
      ctx.fillStyle = barColor
      ctx.fillText('LOW', w - 16, 80)
      ctx.textAlign = 'left'
    }
    this.texture.needsUpdate = true
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
