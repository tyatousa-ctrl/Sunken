import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'
import { LooseItem } from '../interaction/LooseItem'
import { SLOTS, type Inventory, type ItemKind } from '../systems/Inventory'
import { ITEM_NAMES, drawItemIcon, makeItem } from '../systems/items'

const COLS = 3
const ROWS = 4
const PANEL_W = 0.24
const PANEL_H = 0.32
const CANVAS_W = 384
const CANVAS_H = 512
/** How close to the panel's face a hand must be to reach into a cell. */
const REACH_DEPTH = 0.1
/** Closes itself when every hand is this far away. */
const AUTO_CLOSE_DISTANCE = 1.5

export interface BackpackContext {
  inventory: Inventory
  audio: AudioSystem
  camera: THREE.Camera
  /** Where taken-out items live (the stage root), and how they settle when let go. */
  itemParent: THREE.Object3D
  makeLoose: (object: THREE.Object3D, kind: ItemKind) => LooseItem
  /** Register a taken-out item so it can be grabbed again. */
  register: (item: LooseItem) => void
  onChange: () => void
}

// The backpack: 12 slots shown as a floating 3×4 grid near the hand that opened it (A/X, or grip
// over your shoulder). Let go of an item over the grid, or over your shoulder, to store it. Grip a
// filled cell to take one out.
export class Backpack implements Interactable {
  readonly panel: THREE.Mesh
  private readonly canvas = document.createElement('canvas')
  private readonly texture: THREE.CanvasTexture
  /** Stored items that have a model we can hand back (keys, map pieces...). */
  private readonly stored = new Map<ItemKind, LooseItem[]>()
  private readonly kinds = new Map<LooseItem, ItemKind>()
  private readonly v = new THREE.Vector3()
  private readonly head = new THREE.Vector3()
  private readonly fwd = new THREE.Vector3()
  private highlight = -1

  constructor(
    scene: THREE.Object3D,
    private readonly ctx: BackpackContext,
  ) {
    this.canvas.width = CANVAS_W
    this.canvas.height = CANVAS_H
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, PANEL_H),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, fog: false, side: THREE.DoubleSide, depthTest: false }),
    )
    this.panel.renderOrder = 800
    this.panel.visible = false
    scene.add(this.panel)
    this.redraw()
  }

  get isOpen(): boolean {
    return this.panel.visible
  }

  /** Remember what kind of item a loose object is, so it can be stored. */
  track(item: LooseItem, kind: ItemKind): void {
    this.kinds.set(item, kind)
  }

  toggle(hand: Hand): void {
    if (this.isOpen) this.close()
    else this.open(hand)
  }

  open(hand: Hand): void {
    // Float just in front of the hand, turned to face the diver.
    this.ctx.camera.getWorldPosition(this.head)
    hand.worldPos(this.v)
    this.fwd.subVectors(this.head, this.v).normalize()
    // At the hand, nudged up and slightly away from the face so it doesn't fill the view.
    this.panel.position.copy(this.v).addScaledVector(this.fwd, -0.04)
    this.panel.position.y += 0.06
    this.panel.lookAt(this.head)
    this.panel.visible = true
    this.redraw()
    this.ctx.audio.play('pop', this.panel.position, 0.6)
    hand.pulse(0.2, 25)
  }

  close(): void {
    this.panel.visible = false
    this.highlight = -1
  }

  /** Is the hand reaching over its own shoulder (behind the head, around shoulder height)? */
  overShoulder(hand: Hand): boolean {
    this.ctx.camera.getWorldPosition(this.head)
    this.ctx.camera.getWorldDirection(this.fwd)
    this.fwd.y = 0
    this.fwd.normalize()
    hand.worldPos(this.v).sub(this.head)
    return this.v.dot(this.fwd) < -0.05 && this.v.y > -0.3 && this.v.length() < 0.6
  }

  /**
   * Try to put a released item in the backpack (released over the open grid or over the shoulder).
   * Returns true if it went in.
   */
  tryStore(item: LooseItem, hand: Hand): boolean {
    const kind = this.kinds.get(item)
    if (!kind) return false
    const overGrid = this.isOpen && this.cellAt(hand.worldPos(this.v)) >= 0
    if (!overGrid && !this.overShoulder(hand)) return false
    if (this.ctx.inventory.add(kind) < 0) {
      this.ctx.audio.play('click', undefined, 0.5)
      return false
    }
    item.enabled = false
    item.object.visible = false
    const list = this.stored.get(kind) ?? []
    list.push(item)
    this.stored.set(kind, list)
    hand.pulse(0.3, 30)
    this.ctx.audio.play('pop', undefined, 0.7)
    this.redraw()
    this.ctx.onChange()
    return true
  }

  /** Items picked up straight into the bag (coins, gems). */
  refresh(): void {
    this.redraw()
  }

  /** Remove a stored item's model (e.g. a key used from the bag). */
  consume(kind: ItemKind): boolean {
    if (!this.ctx.inventory.use(kind)) return false
    this.stored.get(kind)?.pop()
    this.redraw()
    this.ctx.onChange()
    return true
  }

  grabGap(point: THREE.Vector3): number {
    if (!this.isOpen) return Infinity
    const cell = this.cellAt(point)
    return cell >= 0 && this.ctx.inventory.slots[cell] ? 0 : Infinity
  }

  grab(hand: Hand): void {
    const cell = this.cellAt(hand.worldPos(this.v))
    hand.held = null
    const kind = cell >= 0 ? this.ctx.inventory.take(cell) : null
    if (!kind) return
    // Hand back the stored model if there is one; otherwise make a fresh one (coins, gems).
    let item = this.stored.get(kind)?.pop()
    if (!item) {
      const object = makeItem(kind)
      this.ctx.itemParent.add(object)
      item = this.ctx.makeLoose(object, kind)
      this.kinds.set(item, kind)
      this.ctx.register(item)
    }
    item.enabled = true
    item.object.visible = true
    item.goHome()
    this.ctx.itemParent.add(item.object)
    item.object.position.copy(hand.worldPos(this.v))
    hand.held = item
    item.grab(hand)
    this.redraw()
    this.ctx.onChange()
  }

  release(): void {}

  setHighlight(): void {}

  tick(hands: Hand[]): void {
    if (!this.isOpen) return
    let nearest = Infinity
    let over = -1
    for (const hand of hands) {
      if (!hand.connected) continue
      hand.worldPos(this.v)
      nearest = Math.min(nearest, this.v.distanceTo(this.panel.position))
      const cell = this.cellAt(this.v)
      if (cell >= 0) over = cell
    }
    if (nearest > AUTO_CLOSE_DISTANCE) this.close()
    if (over !== this.highlight) {
      this.highlight = over
      this.redraw()
    }
  }

  private cellAt(point: THREE.Vector3): number {
    const local = this.panel.worldToLocal(this.v.copy(point))
    if (Math.abs(local.z) > REACH_DEPTH || Math.abs(local.x) > PANEL_W / 2 || Math.abs(local.y) > PANEL_H / 2) return -1
    const col = Math.min(COLS - 1, Math.floor(((local.x + PANEL_W / 2) / PANEL_W) * COLS))
    const row = Math.min(ROWS - 1, Math.floor(((PANEL_H / 2 - local.y) / PANEL_H) * ROWS))
    return row * COLS + col
  }

  private redraw(): void {
    const ctx = this.canvas.getContext('2d')!
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.fillStyle = 'rgba(40, 26, 14, 0.88)'
    ctx.beginPath()
    ctx.roundRect(0, 0, CANVAS_W, CANVAS_H, 22)
    ctx.fill()
    const cw = CANVAS_W / COLS
    const ch = CANVAS_H / ROWS
    for (let i = 0; i < SLOTS; i++) {
      const x = (i % COLS) * cw
      const y = Math.floor(i / COLS) * ch
      ctx.fillStyle = i === this.highlight ? 'rgba(95, 224, 255, 0.35)' : 'rgba(255, 240, 210, 0.08)'
      ctx.beginPath()
      ctx.roundRect(x + 6, y + 6, cw - 12, ch - 12, 12)
      ctx.fill()
      const slot = this.ctx.inventory.slots[i]
      if (!slot) continue
      drawItemIcon(ctx, slot.kind, x + cw / 2, y + ch / 2 - 10, 64)
      ctx.fillStyle = '#f3e7c9'
      ctx.font = 'bold 20px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(slot.count > 1 ? `${ITEM_NAMES[slot.kind]} ×${slot.count}` : ITEM_NAMES[slot.kind], x + cw / 2, y + ch - 16)
    }
    this.texture.needsUpdate = true
  }
}
