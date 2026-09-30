import * as THREE from 'three'

interface Line {
  text: string
  speaker?: string
  until: number
}

const W = 1024
const H = 300

// Floating subtitle / prompt panel that lazily follows the view (never head-locked, for comfort),
// plus a timer. Mirrored to a DOM caption on desktop.
export class Hud {
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D
  private readonly texture: THREE.CanvasTexture
  readonly panel: THREE.Mesh
  private readonly dom = document.createElement('div')
  private subtitle: Line | null = null
  private readonly queue: Line[] = []
  private prompt = ''
  private timer = ''
  private dirty = true
  private clock = 0
  private readonly head = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private placed = false

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    this.canvas.width = W
    this.canvas.height = H
    this.ctx = this.canvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, (1.1 * H) / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, fog: false }),
    )
    this.panel.renderOrder = 900
    this.panel.visible = false
    scene.add(this.panel)
    this.dom.className = 'hud-dom'
    document.body.appendChild(this.dom)
  }

  /** Queue a spoken line (subtitle). Lines play one after another. */
  say(text: string, seconds = 4, speaker?: string): void {
    this.queue.push({ text, speaker, until: seconds })
  }

  /** Show a line right away, replacing the current one (feedback to something the player just did). */
  now(text: string, seconds = 3, speaker?: string): void {
    this.subtitle = { text, speaker, until: this.clock + seconds }
    this.dirty = true
  }

  /** Persistent instruction line; empty string clears it. */
  setPrompt(text: string): void {
    if (text === this.prompt) return
    this.prompt = text
    this.dirty = true
  }

  setTimer(text: string): void {
    if (text === this.timer) return
    this.timer = text
    this.dirty = true
  }

  clear(): void {
    this.queue.length = 0
    this.subtitle = null
    this.prompt = ''
    this.timer = ''
    this.dirty = true
  }

  /** `inXr`: the floating panel only shows in the headset; desktop uses the DOM caption. */
  update(dt: number, inXr: boolean): void {
    this.clock += dt
    if (this.subtitle && this.clock >= this.subtitle.until) {
      this.subtitle = null
      this.dirty = true
    }
    if (!this.subtitle && this.queue.length) {
      const next = this.queue.shift()!
      this.subtitle = { ...next, until: this.clock + next.until }
      this.dirty = true
    }
    const visible = !!(this.subtitle || this.prompt || this.timer)
    this.panel.visible = visible && inXr
    if (this.dirty) this.redraw()
    if (visible && inXr) this.follow(dt)
  }

  private follow(dt: number): void {
    this.camera.getWorldPosition(this.head)
    this.camera.getWorldDirection(this.forward)
    this.forward.y = 0
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1)
    this.forward.normalize()
    this.target.copy(this.head).addScaledVector(this.forward, 1.5)
    this.target.y -= 0.35
    // Only chase the view once it has drifted well away, then ease over: no head-locked UI.
    if (!this.placed || this.panel.position.distanceTo(this.target) > 0.6) this.placed = false
    if (!this.placed) {
      this.panel.position.lerp(this.target, 1 - Math.exp(-4 * dt))
      if (this.panel.position.distanceTo(this.target) < 0.05) this.placed = true
    }
    this.panel.lookAt(this.head)
  }

  private redraw(): void {
    this.dirty = false
    const ctx = this.ctx
    ctx.clearRect(0, 0, W, H)
    const dom: string[] = []
    let y = 20
    if (this.timer) {
      ctx.fillStyle = 'rgba(120, 10, 10, 0.85)'
      roundRect(ctx, W / 2 - 170, y, 340, 64, 14)
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 40px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(this.timer, W / 2, y + 46)
      dom.push(this.timer)
      y += 80
    }
    if (this.subtitle) {
      const text = this.subtitle.speaker ? `${this.subtitle.speaker}: ${this.subtitle.text}` : this.subtitle.text
      y = this.block(text, y, 'rgba(0,0,0,0.72)', '#ffffff', 'bold 38px system-ui, sans-serif')
      dom.push(text)
    }
    if (this.prompt) {
      this.block(this.prompt, y, 'rgba(10, 50, 70, 0.8)', '#bff1ff', '34px system-ui, sans-serif')
      dom.push(this.prompt)
    }
    this.texture.needsUpdate = true
    this.dom.textContent = dom.join('  ·  ')
    this.dom.style.display = dom.length ? '' : 'none'
  }

  private block(text: string, y: number, bg: string, fg: string, font: string): number {
    const ctx = this.ctx
    ctx.font = font
    ctx.textAlign = 'center'
    const lines = wrap(ctx, text, W - 80)
    const h = lines.length * 46 + 24
    ctx.fillStyle = bg
    roundRect(ctx, 20, y, W - 40, h, 18)
    ctx.fillStyle = fg
    lines.forEach((line, i) => ctx.fillText(line, W / 2, y + 46 + i * 46))
    return y + h + 12
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > width && line) {
      lines.push(line)
      line = word
    } else line = test
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}
