import * as THREE from 'three'
import { clickables, closedNotes, makeButton } from './Clickables'

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
  /** Has an OK button that folds it away to a small "i" (default: floating signs, i.e. billboards). */
  dismissable?: boolean
}

export interface LabelLine {
  text: string
  /** CSS colour (default cream). */
  color?: string
  /** Pixel size (default 30). */
  size?: number
  bold?: boolean
}

const OK_W = 0.11
const OK_H = 0.05
const INFO = 0.055

// A floating sign: a canvas-textured plane. Text only redraws when it changes, so it's cheap to set
// every frame. Lines are centred; long lines wrap. Floating signs have an OK button: point at it and
// pull the trigger (or click it) and the sign folds away to a small "i" at its lower-left corner, out of
// the way; click the "i" to open it again. Closed signs stay closed (remembered by their title).
export class Label {
  readonly mesh: THREE.Mesh
  private ok: THREE.Mesh | null = null
  private info: THREE.Mesh | null = null
  private id = ''
  private collapsed = false
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
    if (options.dismissable ?? options.billboard ?? false) this.addButtons(options.width, height)
  }

  /** OK (folds it away) and "i" (opens it again), both clickable. */
  private addButtons(width: number, height: number): void {
    const ok = (this.ok = makeButton('OK', OK_W, OK_H, 'rgba(40, 120, 70, 0.95)', '#ffffff'))
    const info = (this.info = makeButton('i', INFO, INFO, 'rgba(30, 90, 140, 0.95)', '#ffffff'))
    ok.position.set(width / 2 - OK_W / 2 - 0.02, -height / 2 + OK_H / 2, 0.003)
    info.position.set(-width / 2 - INFO / 2, -height / 2, 0.003)
    for (const b of [ok, info]) {
      b.layers.set(TEXT_LAYER)
      b.renderOrder = (this.mesh.renderOrder ?? 10) + 1
      ;(b.material as THREE.MeshBasicMaterial).depthTest = !this.options.onTop
      this.mesh.add(b)
    }
    info.visible = false
    clickables.add({ mesh: ok, onClick: () => this.fold(true) })
    clickables.add({ mesh: info, onClick: () => this.fold(false), reopen: () => this.fold(false, false) })
  }

  /** Fold away to the "i" (closed) or open again; remembered unless `remember` is false. */
  private fold(closed: boolean, remember = true): void {
    if (!this.ok || !this.info) return
    this.collapsed = closed
    ;(this.mesh.material as THREE.MeshBasicMaterial).visible = !closed
    this.ok.visible = !closed
    this.info.visible = closed
    if (remember && this.id) {
      if (closed) closedNotes.close(this.id)
      else closedNotes.open(this.id)
    }
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
    // Its title names it (for staying closed); closed before? Stay folded away.
    const id = styled[0]?.text ?? ''
    if (this.ok && id && id !== this.id) {
      this.id = id
      this.fold(closedNotes.has(id), false)
    }
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
    // OK just under the box's bottom-right corner, the "i" off its bottom-left.
    if (this.ok && this.info) {
      const planeH = (this.options.width * H) / W
      const bottom = (0.5 - (top + boxH) / H) * planeH
      this.ok.position.y = bottom - OK_H / 2 - 0.008
      this.info.position.y = bottom - INFO / 2
    }
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
