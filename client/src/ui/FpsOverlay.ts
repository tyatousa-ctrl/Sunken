import * as THREE from 'three'

// FPS debug overlay: a DOM badge on desktop, and a small panel on the left wrist in VR
// (DOM is invisible inside an immersive session).
export class FpsOverlay {
  private readonly dom = document.createElement('div')
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D
  private readonly texture: THREE.CanvasTexture
  private readonly panel: THREE.Mesh
  private frames = 0
  private lastSample = 0
  private visible: boolean

  constructor(private readonly renderer: THREE.WebGLRenderer, wrist: THREE.Object3D, visible: boolean) {
    this.dom.className = 'fps-dom'
    document.body.appendChild(this.dom)

    this.canvas.width = 256
    this.canvas.height = 96
    this.ctx = this.canvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 0.03),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, fog: false }),
    )
    // Sits just above the back of the left hand, tilted toward the face.
    this.panel.position.set(0, 0.04, 0.02)
    this.panel.rotation.x = -Math.PI / 4
    this.panel.renderOrder = 10
    wrist.add(this.panel)

    this.visible = visible
    this.applyVisibility()
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.applyVisibility()
  }

  update(nowMs: number): void {
    this.frames++
    const elapsed = nowMs - this.lastSample
    if (elapsed < 500) return
    const fps = Math.round((this.frames * 1000) / elapsed)
    this.frames = 0
    this.lastSample = nowMs
    if (!this.visible) return

    const info = this.renderer.info.render
    const text = `${fps} fps`
    const detail = `${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris`
    this.dom.textContent = `${text} · ${detail}`

    const ctx = this.ctx
    ctx.clearRect(0, 0, 256, 96)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(0, 0, 256, 96)
    ctx.fillStyle = fps >= 72 ? '#7dffa8' : fps >= 60 ? '#ffd166' : '#ff6b6b'
    ctx.font = 'bold 44px monospace'
    ctx.fillText(text, 12, 48)
    ctx.fillStyle = '#cfe8ff'
    ctx.font = '22px monospace'
    ctx.fillText(detail, 12, 82)
    this.texture.needsUpdate = true
  }

  private applyVisibility(): void {
    this.dom.style.display = this.visible ? '' : 'none'
    this.panel.visible = this.visible
  }
}
