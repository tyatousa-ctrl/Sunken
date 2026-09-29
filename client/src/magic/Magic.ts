import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { RefillZone } from '../movement/environment'
import { recognize, type Point, type SpellShape } from '../systems/gesture'
import type { Hud } from '../ui/Hud'

const MAX_STROKE_SECONDS = 1.5
const ARM_TIMEOUT = 6
const ORB_SECONDS = 60
const DOME_SECONDS = 20
const DOME_RADIUS = 2.2
const CURRENT_SECONDS = 12
const CURRENT_LENGTH = 25
const CURRENT_RADIUS = 1.8
const CURRENT_SPEED = 3.5
const MAX_ORBS = 2

export const SPELL_NAMES: Record<SpellShape, string> = { circle: 'Light Orb', triangle: 'Air Bubble', zigzag: 'Current' }

interface Orb {
  group: THREE.Group
  light: THREE.PointLight
  follow: () => THREE.Vector3 | null
  remaining: number
}
interface Dome {
  mesh: THREE.Mesh
  zone: RefillZone
  remaining: number
}
interface Current {
  from: THREE.Vector3
  dir: THREE.Vector3
  remaining: number
  emit: number
}

export interface MagicContext {
  root: THREE.Object3D
  camera: THREE.Camera
  audio: AudioSystem
  hud: Hud
  glow: Particles
  /** Refill zones of the level (air domes are added here while they last). */
  refillZones: RefillZone[]
  /** Spend one rune; false if there are none. */
  spendRune: () => boolean
  /** Tell the crew (multiplayer). */
  broadcast: (kind: SpellShape, at: THREE.Vector3, dir: THREE.Vector3) => void
  /** Accessibility: pick spells from cards instead of drawing them. */
  menu: () => boolean
}

// Rune magic. Press Y (left controller) to ready a spell, then hold the trigger and draw a circle,
// triangle or zigzag in the air and let go. Each cast spends a rune from the backpack (mana, max 3).
//   Circle: a Light Orb follows you for 60 s.  Triangle: an Air Bubble dome refills everyone inside
//   for 20 s.  Zigzag: a Current carries divers along a 25 m line for 12 s.
export class Magic {
  private armed: Hand | null = null
  private armTimer = 0
  private drawing = false
  private strokeTime = 0
  private readonly stroke: Point[] = []
  private readonly trail: THREE.Line
  private readonly trailPoints: THREE.Vector3[] = []
  private readonly orbs: Orb[] = []
  private readonly domes: Dome[] = []
  private readonly currents: Current[] = []
  private readonly cards: THREE.Mesh[] = []
  private readonly cardGroup = new THREE.Group()
  private readonly v = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()

  constructor(private readonly ctx: MagicContext) {
    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.9, fog: false }))
    this.trail.frustumCulled = false
    this.trail.renderOrder = 820
    ctx.root.add(this.trail)
    ;(['circle', 'triangle', 'zigzag'] as SpellShape[]).forEach((shape, i) => {
      const card = makeCard(`${['◯', '△', '⋀⋁'][i]} ${SPELL_NAMES[shape]}`)
      card.userData.shape = shape
      card.position.set((i - 1) * 0.2, 0.12, 0)
      this.cards.push(card)
      this.cardGroup.add(card)
    })
    this.cardGroup.visible = false
    ctx.root.add(this.cardGroup)
  }

  get isArmed(): boolean {
    return this.armed !== null
  }

  /** Y pressed on this hand: ready a spell (or open the spell cards). */
  arm(hand: Hand): void {
    if (this.armed === hand) {
      this.disarm()
      return
    }
    this.armed = hand
    hand.busy = true
    this.armTimer = ARM_TIMEOUT
    this.stroke.length = 0
    this.drawing = false
    if (this.ctx.menu()) {
      hand.worldPos(this.v)
      this.ctx.camera.getWorldPosition(this.v2)
      this.cardGroup.position.copy(this.v).lerp(this.v2, 0.3)
      this.cardGroup.lookAt(this.v2)
      this.cardGroup.visible = true
      this.ctx.hud.now('Touch a spell with your other hand.', 3)
    } else {
      this.ctx.hud.now('Spell ready: hold the trigger, draw a circle, triangle or zigzag, and let go.', 4)
    }
    hand.pulse(0.3, 40)
  }

  /** Cast straight away (desktop keys, or a card). */
  castNow(shape: SpellShape): void {
    this.disarm()
    this.tryCast(shape)
  }

  update(dt: number, hands: Hand[]): void {
    this.updateCasting(dt, hands)
    this.updateSpells(dt)
  }

  /** Extra push on a diver at `p` from any current they're in (world velocity change per second). */
  flowAt(p: THREE.Vector3, velocity: THREE.Vector3): THREE.Vector3 {
    const push = this.v2.set(0, 0, 0)
    for (const c of this.currents) {
      const along = this.v.subVectors(p, c.from).dot(c.dir)
      if (along < 0 || along > CURRENT_LENGTH) continue
      const off = this.v.subVectors(p, c.from).addScaledVector(c.dir, -along).length()
      if (off > CURRENT_RADIUS) continue
      const speedAlong = velocity.dot(c.dir)
      if (speedAlong < CURRENT_SPEED) push.addScaledVector(c.dir, (CURRENT_SPEED - speedAlong) * 2.5)
    }
    return push
  }

  /** A spell someone else in the crew cast. */
  castRemote(kind: SpellShape, at: THREE.Vector3, dir: THREE.Vector3, follow: () => THREE.Vector3 | null): void {
    this.spawn(kind, at, dir, follow)
  }

  private updateCasting(dt: number, hands: Hand[]): void {
    const hand = this.armed
    if (!hand) return
    this.armTimer -= dt
    if (this.armTimer <= 0) {
      this.disarm()
      return
    }
    if (this.cardGroup.visible) {
      // Menu mode: touch a card with the other hand.
      const other = hands.find((h) => h !== hand && h.connected) ?? hand
      const at = other.worldPos(this.v)
      const card = this.cards.find((c) => c.getWorldPosition(this.v2).distanceTo(at) < 0.09)
      if (card) this.castNow(card.userData.shape as SpellShape)
      return
    }
    if (hand.trigger > 0.6 && !this.drawing) {
      this.drawing = true
      this.strokeTime = 0
      this.stroke.length = 0
      this.trailPoints.length = 0
    }
    if (this.drawing) {
      this.strokeTime += dt
      const world = hand.worldPos(new THREE.Vector3())
      // Record in the view plane, so a shape drawn in front of you reads the same whichever way you face.
      const local = this.ctx.camera.worldToLocal(world.clone())
      if (this.strokeTime < MAX_STROKE_SECONDS) {
        this.stroke.push({ x: local.x, y: local.y })
        this.trailPoints.push(world)
        this.trail.geometry.setFromPoints(this.trailPoints)
      }
      if (hand.trigger < 0.3) {
        const { shape } = recognize(this.stroke)
        this.disarm()
        if (shape) this.tryCast(shape)
        else this.ctx.hud.now('The rune magic fizzles. Try a clear circle, triangle or zigzag.', 3)
      }
    }
  }

  private tryCast(shape: SpellShape): void {
    if (!this.ctx.spendRune()) {
      this.ctx.hud.now('No runes left to power a spell. Find tide runes to recharge.', 3)
      return
    }
    const head = this.ctx.camera.getWorldPosition(new THREE.Vector3())
    const dir = this.ctx.camera.getWorldDirection(new THREE.Vector3())
    this.spawn(shape, head, dir, () => this.ctx.camera.getWorldPosition(new THREE.Vector3()))
    this.ctx.broadcast(shape, head, dir)
    this.ctx.hud.now(`${SPELL_NAMES[shape]}!`, 2)
  }

  private spawn(kind: SpellShape, at: THREE.Vector3, dir: THREE.Vector3, follow: () => THREE.Vector3 | null): void {
    this.ctx.audio.play('pop', at, 0.8)
    this.ctx.glow.emit({ position: at.clone().addScaledVector(dir, 0.5), spread: 0.8, color: 0x9ff5ff, size: 0.12, life: 1, count: 30 })
    if (kind === 'circle') {
      if (this.orbs.length >= MAX_ORBS) this.removeOrb(this.orbs[0])
      const group = new THREE.Group()
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0xcff7ff, fog: false }))
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.25, fog: false, depthWrite: false }))
      const light = new THREE.PointLight(0xaeefff, 3, 12, 1.5)
      group.add(ball, halo, light)
      group.position.copy(at)
      this.ctx.root.add(group)
      this.orbs.push({ group, light, follow, remaining: ORB_SECONDS })
    } else if (kind === 'triangle') {
      const center = at.clone().addScaledVector(dir, 1.2)
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(DOME_RADIUS, 24, 16),
        new THREE.MeshStandardMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.18, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
      )
      mesh.position.copy(center)
      this.ctx.root.add(mesh)
      const zone: RefillZone = { center, radius: DOME_RADIUS, sphere: true }
      this.ctx.refillZones.push(zone)
      this.domes.push({ mesh, zone, remaining: DOME_SECONDS })
    } else {
      const flat = dir.clone().setY(dir.y * 0.4).normalize()
      this.currents.push({ from: at.clone().addScaledVector(flat, 0.5), dir: flat, remaining: CURRENT_SECONDS, emit: 0 })
    }
  }

  private updateSpells(dt: number): void {
    for (const orb of [...this.orbs]) {
      orb.remaining -= dt
      const head = orb.follow()
      if (head) orb.group.position.lerp(this.v.copy(head).add(new THREE.Vector3(0.25, 0.35, 0)), Math.min(1, dt * 3))
      orb.light.intensity = 3 * Math.min(1, orb.remaining / 3)
      if (orb.remaining <= 0) this.removeOrb(orb)
    }
    for (const dome of [...this.domes]) {
      dome.remaining -= dt
      ;(dome.mesh.material as THREE.MeshStandardMaterial).opacity = 0.18 * Math.min(1, dome.remaining / 2)
      if (Math.random() < dt * 20) this.ctx.glow.emit({ position: dome.zone.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, -1, (Math.random() - 0.5) * 3)), velocity: new THREE.Vector3(0, 0.8, 0), color: 0xe6f7ff, size: 0.05, life: 2, alpha: 0.6 })
      if (dome.remaining <= 0) {
        dome.mesh.removeFromParent()
        dome.mesh.geometry.dispose()
        const i = this.ctx.refillZones.indexOf(dome.zone)
        if (i >= 0) this.ctx.refillZones.splice(i, 1)
        this.domes.splice(this.domes.indexOf(dome), 1)
      }
    }
    for (const c of [...this.currents]) {
      c.remaining -= dt
      c.emit -= dt
      if (c.emit <= 0) {
        c.emit = 0.08
        const along = Math.random() * CURRENT_LENGTH * 0.3
        this.ctx.glow.emit({ position: c.from.clone().addScaledVector(c.dir, along).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5)), velocity: c.dir.clone().multiplyScalar(6), color: 0x9ff5ff, size: 0.06, life: 3, alpha: 0.7 })
      }
      if (c.remaining <= 0) this.currents.splice(this.currents.indexOf(c), 1)
    }
  }

  /** Is one of the Light Orbs (yours or a crewmate's) within `radius` of a point (world)? */
  orbWithin(point: THREE.Vector3, radius: number): boolean {
    return this.orbs.some((o) => o.group.getWorldPosition(this.orbPos).distanceTo(point) < radius)
  }

  private readonly orbPos = new THREE.Vector3()

  private removeOrb(orb: Orb): void {
    orb.group.removeFromParent()
    orb.light.dispose()
    this.orbs.splice(this.orbs.indexOf(orb), 1)
  }

  private disarm(): void {
    if (this.armed) this.armed.busy = false
    this.armed = null
    this.drawing = false
    this.cardGroup.visible = false
    this.trailPoints.length = 0
    this.trail.geometry.setFromPoints([])
  }
}

function makeCard(label: string): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(8, 30, 46, 0.9)'
  ctx.beginPath()
  ctx.roundRect(2, 2, 252, 92, 18)
  ctx.fill()
  ctx.strokeStyle = '#7fe9ff'
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.fillStyle = '#e8f7ff'
  ctx.font = 'bold 30px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(label, 128, 60)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.0675), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, fog: false }))
  card.renderOrder = 850
  return card
}
