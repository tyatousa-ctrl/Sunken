import * as THREE from 'three'

export interface GogglesStatus {
  air: number
  depth: number
  refilling: boolean
}

// A little heads-up readout printed inside the dive mask's glass, in the top-left corner of view:
// the air gauge and depth (the mini map sits in the top right). It only shows while the mask is on.
export class GogglesDisplay {
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
    camera.add(this.panel)
  }

  update(dt: number, visible: boolean, status: GogglesStatus): void {
    this.panel.visible = visible
    if (!visible) return
    this.blink += dt
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
