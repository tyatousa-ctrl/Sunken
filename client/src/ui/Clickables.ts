import * as THREE from 'three'
import type { Hand } from '../input/Hand'

/** Something you can point at and click: an OK button, an "i". */
export interface Clickable {
  readonly mesh: THREE.Mesh
  onClick(): void
  /** The menu's "Reopen closed instructions". */
  reopen?(): void
  /** Set once it's been seen in the scene (so a stage's leftovers can be dropped after it's gone). */
  seen?: boolean
}

/** Every clickable in the game (they tidy themselves away with their stage). */
export const clickables = new Set<Clickable>()

/** Pointing further than this doesn't reach. */
const REACH = 6
/** A mouse press that moves less than this (px) is a click, not a drag-to-look. */
const CLICK_SLOP = 6

// Point and click for floating buttons: aim a controller's pointer at one and pull the trigger (the
// trigger's then used up, so it doesn't also fire a gun or strike a match). On desktop, click it with
// the mouse. Whatever you're pointing at swells a little.
export class UiPointer {
  private readonly raycaster = new THREE.Raycaster()
  private readonly origin = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private hovered: Clickable | null = null
  private pendingClick: THREE.Vector2 | null = null
  private downAt: THREE.Vector2 | null = null

  constructor(canvas: HTMLElement) {
    this.raycaster.layers.enableAll()
    this.raycaster.far = REACH
    canvas.addEventListener('pointerdown', (e) => (this.downAt = new THREE.Vector2(e.clientX, e.clientY)))
    canvas.addEventListener('pointerup', (e) => {
      if (!this.downAt || this.downAt.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > CLICK_SLOP) return
      const r = canvas.getBoundingClientRect()
      this.pendingClick = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    })
  }

  update(hands: Hand[], camera: THREE.Camera, inXr: boolean): void {
    const targets = this.live(camera)
    let hovered: Clickable | null = null
    if (inXr) {
      for (const hand of hands) {
        if (!hand.connected || hand.virtual || hand.held) continue
        hand.ray.getWorldPosition(this.origin)
        hand.pointDir(this.dir)
        this.raycaster.set(this.origin, this.dir)
        const hit = this.pick(targets)
        if (!hit) continue
        hovered = hit
        if (hand.triggerPressed) {
          hand.triggerPressed = false
          hand.pulse(0.4, 40)
          hit.onClick()
        }
      }
    } else if (this.pendingClick) {
      this.raycaster.setFromCamera(this.pendingClick, camera)
      this.raycaster.far = REACH
      this.pick(targets)?.onClick()
    }
    this.pendingClick = null
    if (hovered !== this.hovered) {
      if (this.hovered) this.hovered.mesh.scale.setScalar(1)
      if (hovered) hovered.mesh.scale.setScalar(1.25)
      this.hovered = hovered
    }
  }

  /** Clickables actually on screen now: in the scene, shown, on a layer the camera draws. */
  private live(camera: THREE.Camera): Clickable[] {
    const out: Clickable[] = []
    for (const c of clickables) {
      if (!isAttached(c.mesh)) {
        // Not built into the scene yet, or its stage has gone (then drop it).
        if (c.seen) clickables.delete(c)
        continue
      }
      c.seen = true
      let shown = camera.layers.test(c.mesh.layers)
      for (let o: THREE.Object3D | null = c.mesh; o && shown; o = o.parent) if (!o.visible) shown = false
      if (shown) out.push(c)
    }
    return out
  }

  private pick(targets: Clickable[]): Clickable | null {
    let best: Clickable | null = null
    let bestD = Infinity
    for (const c of targets) {
      const hit = this.raycaster.intersectObject(c.mesh, false)[0]
      if (hit && hit.distance < bestD) {
        bestD = hit.distance
        best = c
      }
    }
    return best
  }
}

/** A small round button with a word or letter on it (OK, i). */
export function makeButton(text: string, width: number, height: number, bg: string, fg: string): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = Math.round((256 * height) / width)
  const ctx = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height
  ctx.fillStyle = bg
  ctx.beginPath()
  ctx.roundRect(3, 3, W - 6, H - 6, Math.min(W, H) / 2 - 3)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.fillStyle = fg
  ctx.font = `bold ${Math.round(H * 0.6)}px ${text === 'i' ? 'Georgia, serif' : 'system-ui, sans-serif'}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, W / 2, H / 2 + 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, fog: false, depthWrite: false }))
  mesh.renderOrder = 20
  return mesh
}

/** Instructions closed with OK: remembered on this device (by the sign's title). */
const KEY = 'sunken-sicily.closed-notes'
let closed: Set<string> | null = null
function load(): Set<string> {
  if (closed) return closed
  try {
    closed = new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[])
  } catch {
    closed = new Set()
  }
  return closed
}
function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...load()]))
  } catch {
    // Private mode: closed for this visit only.
  }
}
export const closedNotes = {
  has: (id: string) => load().has(id),
  close: (id: string) => {
    load().add(id)
    save()
  },
  open: (id: string) => {
    load().delete(id)
    save()
  },
  /** Open every closed note again (the menu). */
  reopenAll: () => {
    load().clear()
    save()
    for (const c of clickables) c.reopen?.()
  },
}

/** Still hanging off a scene somewhere (walking up through hidden parents too). */
function isAttached(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o
  while (p) {
    if ((p as THREE.Scene).isScene) return true
    p = p.parent
  }
  return false
}
