import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'

/** One tile on the menu. */
export interface MenuItem {
  label: string
  /** A second, smaller line (who has a class, what a tile does). */
  sub?: string
  /** Keyboard shortcut shown on the tile (desktop). */
  key: string
  /** Drawn in gold: the class you are now. */
  current?: boolean
  /** Which row it sits in; tiles in a row are spread evenly. */
  row: number
  action: () => void
}

export interface MenuSection {
  row: number
  title: string
}

const TILE_H = 0.1
const ROW_GAP = 0.035
const PANEL_W = 0.78
const TOUCH_REACH = 0.07
/** Walking or swimming this far from where it opened closes it. */
const CLOSE_DISTANCE = 1.8
/** Both thumbstick clicks within this many seconds of each other (the old level-hop chord). */
const CHORD_SECONDS = 0.35

// The in-game menu: click the right thumbstick (Tab on desktop) and a panel appears in front of you.
// Touch a tile with either hand (or press its key). Empty my hands, switch class, hop to a level.
// Click the stick again, touch Close, or move away to put it away.
export class GameMenu {
  private readonly group = new THREE.Group()
  private tiles: { mesh: THREE.Mesh; item: MenuItem }[] = []
  private readonly anchor = new THREE.Vector3()
  private readonly v = new THREE.Vector3()
  private readonly lastClick = new Map<Hand, number>()
  private clock = 0
  private wantToggle = false
  private pickedKey: string | null = null
  /** A hand that picked a tile must leave the panel before it can pick again. */
  private readonly cooling = new Set<Hand>()

  constructor(
    scene: THREE.Scene,
    private readonly audio: AudioSystem,
    /** Builds the tiles fresh each time it opens (classes change hands). */
    private readonly build: () => { sections: MenuSection[]; items: MenuItem[] },
  ) {
    this.group.visible = false
    scene.add(this.group)
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return
      if (e.code === 'Tab' || e.code === 'KeyL') {
        e.preventDefault()
        this.wantToggle = true
        return
      }
      if (this.visible) this.pickedKey = e.key
    })
  }

  get visible(): boolean {
    return this.group.visible
  }

  close(): void {
    this.group.visible = false
  }

  update(dt: number, hands: Hand[], camera: THREE.Camera): void {
    this.clock += dt
    for (const hand of hands) {
      if (!hand.stickPressed) continue
      // Right stick on its own; or both sticks together (the level-hop chord from before).
      const other = hands.find((h) => h !== hand && h.connected)
      const otherAt = other ? this.lastClick.get(other) : undefined
      const chord = !!other && (other.stickDown || (otherAt !== undefined && this.clock - otherAt < CHORD_SECONDS))
      this.lastClick.set(hand, this.clock)
      if (hand.handedness === 'right' || chord) {
        this.lastClick.clear()
        this.wantToggle = true
        break
      }
    }
    if (this.wantToggle) {
      this.wantToggle = false
      if (this.visible) this.close()
      else this.open(camera)
    }
    if (!this.visible) return
    if (camera.getWorldPosition(this.v).distanceTo(this.anchor) > CLOSE_DISTANCE) return this.close()

    let pick: MenuItem | null = null
    const key = this.pickedKey
    this.pickedKey = null
    if (key) pick = this.tiles.find((t) => t.item.key.toLowerCase() === key.toLowerCase())?.item ?? null
    for (const hand of hands) {
      if (!hand.connected || hand.virtual) continue
      const p = hand.worldPos(this.v)
      const tile = this.tiles.find((t) => this.touching(t.mesh, p))
      if (!tile) {
        this.cooling.delete(hand)
        continue
      }
      if (this.cooling.has(hand) || pick) continue
      this.cooling.add(hand)
      hand.pulse(0.5, 50)
      pick = tile.item
    }
    if (pick) {
      this.audio.play('click')
      this.close()
      pick.action()
    }
  }

  /** Half a metre in front of your face, a little below eye level, facing you. */
  private open(camera: THREE.Camera): void {
    this.layout()
    const head = camera.getWorldPosition(new THREE.Vector3())
    const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0)
    if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1)
    forward.normalize()
    this.group.position.copy(head).addScaledVector(forward, 0.5).add(new THREE.Vector3(0, -0.12, 0))
    this.group.lookAt(head.x, this.group.position.y, head.z)
    this.anchor.copy(head)
    this.group.visible = true
    this.audio.play('pop', undefined, 0.5)
  }

  private touching(mesh: THREE.Mesh, point: THREE.Vector3): boolean {
    const local = mesh.worldToLocal(point.clone())
    const g = mesh.geometry as THREE.PlaneGeometry
    const { width, height } = g.parameters
    return Math.abs(local.z) < TOUCH_REACH && Math.abs(local.x) < width / 2 && Math.abs(local.y) < height / 2
  }

  private layout(): void {
    for (const child of [...this.group.children]) {
      const mesh = child as THREE.Mesh
      const material = mesh.material as THREE.MeshBasicMaterial
      material.map?.dispose()
      material.dispose()
      mesh.geometry.dispose()
      this.group.remove(child)
    }
    this.tiles = []
    const { sections, items } = this.build()
    const rows = [...new Set(items.map((i) => i.row))].sort((a, b) => a - b)
    let y = 0
    for (const row of rows) {
      const section = sections.find((s) => s.row === row)
      if (section) {
        const title = makeTile({ title: section.title, color: '#f2b64a', width: PANEL_W, height: 0.045, plain: true })
        title.position.set(0, y, 0)
        this.group.add(title)
        y -= 0.045 + 0.01
      }
      const inRow = items.filter((i) => i.row === row)
      const width = (PANEL_W - (inRow.length - 1) * 0.02) / inRow.length
      inRow.forEach((item, i) => {
        const mesh = makeTile({ title: item.label, sub: item.sub, key: item.key, width, height: TILE_H, gold: item.current })
        mesh.position.set(-PANEL_W / 2 + width / 2 + i * (width + 0.02), y - TILE_H / 2, 0)
        this.group.add(mesh)
        this.tiles.push({ mesh, item })
      })
      y -= TILE_H + ROW_GAP
    }
    // Centre the panel vertically on where it opens.
    for (const child of this.group.children) child.position.y -= y / 2
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')
}

function makeTile(o: { title: string; sub?: string; key?: string; color?: string; width: number; height: number; gold?: boolean; plain?: boolean }): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(1400 * o.width)
  canvas.height = Math.round(1400 * o.height)
  const ctx = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height
  if (!o.plain) {
    ctx.fillStyle = o.gold ? 'rgba(74, 52, 8, 0.95)' : 'rgba(7, 26, 38, 0.92)'
    ctx.beginPath()
    ctx.roundRect(4, 4, W - 8, H - 8, 20)
    ctx.fill()
    ctx.strokeStyle = o.gold ? '#ffd35a' : '#2d6f8c'
    ctx.lineWidth = o.gold ? 8 : 5
    ctx.stroke()
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = o.color ?? (o.gold ? '#ffe08a' : '#e8f7ff')
  const big = Math.round(H * (o.plain ? 0.62 : o.sub ? 0.34 : 0.4))
  ctx.font = `bold ${big}px system-ui, sans-serif`
  fit(ctx, o.title, W - 30, big)
  ctx.fillText(o.title, W / 2, o.sub ? H * 0.38 : H / 2)
  if (o.sub) {
    const small = Math.round(H * 0.2)
    ctx.font = `${small}px system-ui, sans-serif`
    ctx.fillStyle = o.gold ? '#ffe9b0' : '#9fc6d8'
    fit(ctx, o.sub, W - 30, small)
    ctx.fillText(o.sub, W / 2, H * 0.72)
  }
  if (o.key) {
    ctx.font = `${Math.round(H * 0.18)}px system-ui, sans-serif`
    ctx.fillStyle = 'rgba(200, 230, 245, 0.5)'
    ctx.textAlign = 'left'
    ctx.fillText(o.key, 16, H * 0.2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.width, o.height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, fog: false }))
  mesh.renderOrder = 950
  return mesh
}

/** Shrink the font until the text fits the width. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number, size: number): void {
  let s = size
  while (s > 10 && ctx.measureText(text).width > width) {
    s -= 2
    ctx.font = ctx.font.replace(/\d+px/, `${s}px`)
  }
}
