import * as THREE from 'three'

/** The render layer for floating notes, signs and pop-ups: the menu's "Notes & signs" shows or hides it. */
export const TEXT_LAYER = 5

export interface LabelOptions {
  /** Width in metres; height follows the canvas aspect. */
  width: number
  /** Canvas size in pixels (default 512 × 256). */
  canvasWidth?: number
  canvasHeight?: number
  /** Turn to face the viewer around the vertical axis every frame (see `face`). */
  billboard?: boolean
  /** Draw on top of everything (for small labels that sit close to geometry). */
  onTop?: boolean
}

export interface LabelLine {
  text: string
  /** CSS colour (default cream). */
  color?: string
  /** Pixel size (default 30). */
  size?: number
  bold?: boolean
}

// A floating sign: a canvas-textured plane. Text only redraws when it changes, so it's cheap to set
// every frame. Lines are centred; long lines wrap.
export class Label {
  readonly mesh: THREE.Mesh
  private readonly canvas = document.createElement('canvas')
  private readonly texture: THREE.CanvasTexture
  private key = ''
  private readonly v = new THREE.Vector3()
  private readonly w = new THREE.Vector3()

  constructor(private readonly options: LabelOptions) {
    this.canvas.width = options.canvasWidth ?? 512
    this.canvas.height = options.canvasHeight ?? 256
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4
    const height = (options.width * this.canvas.height) / this.canvas.width
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(options.width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, fog: false, depthWrite: false, depthTest: !options.onTop }),
    )
    this.mesh.renderOrder = options.onTop ? 760 : 10
    // All floating words (signs, how-tos, button guides) can be switched off together from the menu.
    this.mesh.layers.set(TEXT_LAYER)
  }

  set visible(on: boolean) {
    this.mesh.visible = on
  }

  get visible(): boolean {
    return this.mesh.visible
  }

  /** Set the text (plain strings or styled lines). No-op if unchanged. */
  set(lines: (string | LabelLine)[]): void {
    const styled = lines.map((l) => (typeof l === 'string' ? { text: l } : l))
    const key = JSON.stringify(styled)
    if (key === this.key) return
    this.key = key
    const ctx = this.canvas.getContext('2d')!
    const W = this.canvas.width
    const H = this.canvas.height
    ctx.clearRect(0, 0, W, H)
    if (styled.length === 0) {
      this.texture.needsUpdate = true
      return
    }
    // Wrap, then fit everything vertically.
    const rows: { text: string; font: string; color: string; size: number }[] = []
    for (const line of styled) {
      const size = line.size ?? 30
      const font = `${line.bold ? 'bold ' : ''}${size}px system-ui, sans-serif`
      ctx.font = font
      let current = ''
      for (const word of line.text.split(' ')) {
        const test = current ? `${current} ${word}` : word
        if (current && ctx.measureText(test).width > W - 40) {
          rows.push({ text: current, font, color: line.color ?? '#f6ecd2', size })
          current = word
        } else current = test
      }
      rows.push({ text: current, font, color: line.color ?? '#f6ecd2', size })
    }
    const total = rows.reduce((sum, r) => sum + r.size * 1.25, 0)
    const pad = 16
    const boxH = Math.min(H, total + pad * 2)
    const top = (H - boxH) / 2
    ctx.fillStyle = 'rgba(12, 22, 30, 0.72)'
    ctx.beginPath()
    ctx.roundRect(2, top, W - 4, boxH, 22)
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const scale = Math.min(1, (H - pad * 2) / total)
    let y = top + pad
    for (const row of rows) {
      const step = row.size * 1.25 * scale
      ctx.font = row.font.replace(`${row.size}px`, `${Math.round(row.size * scale)}px`)
      ctx.fillStyle = row.color
      ctx.fillText(row.text, W / 2, y + step / 2, W - 24)
      y += step
    }
    this.texture.needsUpdate = true
  }

  /** Turn (around world up) to face the viewer. Call each frame for billboard labels. */
  face(camera: THREE.Camera): void {
    if (!this.options.billboard || !this.mesh.visible) return
    camera.getWorldPosition(this.v)
    this.mesh.getWorldPosition(this.w)
    const yaw = Math.atan2(this.v.x - this.w.x, this.v.z - this.w.z)
    const parent = this.mesh.parent
    this.mesh.rotation.set(0, yaw, 0)
    if (parent) {
      // Undo the parent's world yaw so the label turns in world space.
      const q = parent.getWorldQuaternion(new THREE.Quaternion())
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ')
      this.mesh.rotation.y = yaw - e.y
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.texture.dispose()
  }
}
