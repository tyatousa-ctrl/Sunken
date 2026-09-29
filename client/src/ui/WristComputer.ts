import * as THREE from 'three'

export interface DiveStatus {
  air: number
  depth: number
  speed: number
  refilling: boolean
}

// Dive computer on the left wrist: air gauge, depth and speed. Mirrored to a DOM readout on desktop.
export class WristComputer {
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D
  private readonly texture: THREE.CanvasTexture
  private readonly dom = document.createElement('div')
  private sinceDraw = 1
  private blink = 0
  private readonly face: THREE.Mesh

  constructor(wrist: THREE.Object3D) {
    this.canvas.width = 320
    this.canvas.height = 160
    this.ctx = this.canvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    const face = (this.face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 0.04),
      new THREE.MeshBasicMaterial({ map: this.texture, fog: false }),
    ))
    // Strapped on top of the left wrist, tilted toward the eyes when you look at your watch.
    face.position.set(0.0, 0.015, 0.075)
    face.rotation.set(-Math.PI / 2.4, 0, 0)
    wrist.add(face)

    this.dom.className = 'dive-dom'
    document.body.appendChild(this.dom)
  }

  /** The dive computer only shows once you're diving. */
  setVisible(visible: boolean): void {
    this.face.visible = visible
    this.dom.style.display = visible ? '' : 'none'
  }

  update(dt: number, status: DiveStatus): void {
    this.blink += dt
    this.sinceDraw += dt
    if (this.sinceDraw < 0.1) return
    this.sinceDraw = 0

    const pct = Math.round(status.air * 100)
    const low = status.air < 0.25
    const critical = status.air < 0.1
    this.dom.textContent = `Air ${pct}%${status.refilling ? ' ↑' : ''} · depth ${status.depth.toFixed(1)} m · ${status.speed.toFixed(1)} m/s`
    this.dom.classList.toggle('low', low)

    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    ctx.fillStyle = '#071a26'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#2d6f8c'
    ctx.lineWidth = 6
    ctx.strokeRect(3, 3, w - 6, h - 6)

    const barColor = critical ? (Math.floor(this.blink * 3) % 2 ? '#ff4d4d' : '#5a1111') : low ? '#ffb347' : '#5fe0ff'
    ctx.fillStyle = '#12303f'
    ctx.fillRect(18, 18, w - 36, 42)
    ctx.fillStyle = barColor
    ctx.fillRect(18, 18, (w - 36) * status.air, 42)
    // Outlined label so it reads on both the filled bar and the empty track.
    ctx.font = 'bold 30px monospace'
    ctx.lineWidth = 6
    ctx.strokeStyle = '#04141d'
    ctx.strokeText(`AIR ${pct}%${status.refilling ? ' +' : ''}`, 26, 50)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(`AIR ${pct}%${status.refilling ? ' +' : ''}`, 26, 50)
    ctx.fillStyle = '#e8f7ff'

    ctx.font = 'bold 34px monospace'
    ctx.fillText(`${status.depth.toFixed(1)}m`, 20, 112)
    ctx.fillText(`${status.speed.toFixed(1)}m/s`, 170, 112)
    ctx.font = '20px monospace'
    ctx.fillStyle = '#8fc9dd'
    ctx.fillText('DEPTH', 20, 142)
    ctx.fillText('SPEED', 170, 142)
    this.texture.needsUpdate = true
  }
}
