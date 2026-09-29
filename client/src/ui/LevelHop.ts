import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Stage } from '../core/Stage'
import type { Hand } from '../input/Hand'

export interface HopTarget {
  label: string
  make: () => Stage
}

const TILE_W = 0.24
const TILE_H = 0.12
const TOUCH_REACH = 0.1
/** Both thumbstick clicks within this many seconds of each other open the panel. */
const CHORD_SECONDS = 0.35

// Level hop, for testing: click both thumbsticks together (L on desktop) and a row of tiles appears in
// front of you (Deck, Level 1, 2, 3, Sandbox). Touch one (or press its number on the keyboard) to go
// straight there. Only you move; in a crew everyone else stays where they are.
export class LevelHop {
  private readonly group = new THREE.Group()
  private readonly tiles: { mesh: THREE.Mesh; target: HopTarget }[] = []
  private targets: HopTarget[] = []
  private readonly lastClick = new Map<Hand, number>()
  private clock = 0
  private readonly v = new THREE.Vector3()
  private picked: HopTarget | null = null

  constructor(
    scene: THREE.Scene,
    private readonly audio: AudioSystem,
  ) {
    this.group.visible = false
    scene.add(this.group)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyL' && !isTyping(e)) this.visible ? this.close() : (this.wantOpen = true)
      const n = /^Digit([1-9])$/.exec(e.code)?.[1]
      if (n && this.visible && !isTyping(e)) this.picked = this.targets[Number(n) - 1] ?? null
    })
  }

  private wantOpen = false

  get visible(): boolean {
    return this.group.visible
  }

  setTargets(targets: HopTarget[]): void {
    this.targets = targets
    for (const t of this.tiles) {
      this.group.remove(t.mesh)
      ;(t.mesh.material as THREE.MeshBasicMaterial).map?.dispose()
    }
    this.tiles.length = 0
    const title = makeTile('Go to… (testing)', '#f2b64a', 0.5, 0.06)
    title.position.set(0, TILE_H / 2 + 0.06, 0)
    this.group.add(title)
    targets.forEach((target, i) => {
      const mesh = makeTile(`${i + 1}  ${target.label}`, '#e8f7ff', TILE_W, TILE_H)
      const col = i % 3
      const row = Math.floor(i / 3)
      mesh.position.set((col - 1) * (TILE_W + 0.03), -row * (TILE_H + 0.03), 0)
      this.group.add(mesh)
      this.tiles.push({ mesh, target })
    })
  }

  close(): void {
    this.group.visible = false
  }

  /** Watch for the thumbstick chord, and touches on the tiles. `go` switches stage. */
  update(dt: number, hands: Hand[], camera: THREE.Camera, go: (make: () => Stage) => void): void {
    this.clock += dt
    for (const hand of hands) {
      if (!hand.stickPressed) continue
      this.lastClick.set(hand, this.clock)
      const other = hands.find((h) => h !== hand && h.connected)
      const otherAt = other ? this.lastClick.get(other) : undefined
      if (other && (other.stickDown || (otherAt !== undefined && this.clock - otherAt < CHORD_SECONDS))) {
        this.lastClick.clear()
        if (this.visible) this.close()
        else this.wantOpen = true
      }
    }
    if (this.wantOpen) {
      this.wantOpen = false
      this.open(camera)
    }
    if (!this.visible) return
    let pick = this.picked
    this.picked = null
    if (!pick) {
      for (const { mesh, target } of this.tiles) {
        mesh.getWorldPosition(this.v)
        const hand = hands.find((h) => h.connected && !h.virtual && h.worldPos(new THREE.Vector3()).distanceTo(this.v) < TOUCH_REACH)
        if (hand) {
          hand.pulse(0.5, 50)
          pick = target
          break
        }
      }
    }
    if (pick) {
      this.close()
      this.audio.play('click')
      go(pick.make)
    }
  }

  /** Half a metre in front of your face, a little below eye level, facing you. */
  private open(camera: THREE.Camera): void {
    const head = camera.getWorldPosition(new THREE.Vector3())
    const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0)
    if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1)
    forward.normalize()
    this.group.position.copy(head).addScaledVector(forward, 0.5).add(new THREE.Vector3(0, -0.2, 0))
    this.group.lookAt(head.x, this.group.position.y, head.z)
    this.group.visible = true
    this.audio.play('pop', undefined, 0.5)
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')
}

function makeTile(text: string, color: string, width: number, height: number): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = Math.round((512 * height) / width)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(7, 26, 38, 0.92)'
  ctx.beginPath()
  ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 24)
  ctx.fill()
  ctx.strokeStyle = '#2d6f8c'
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.fillStyle = color
  ctx.font = `bold ${Math.round(canvas.height * 0.3)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, fog: false }))
  mesh.renderOrder = 900
  return mesh
}
