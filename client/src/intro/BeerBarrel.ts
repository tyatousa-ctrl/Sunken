import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { GrabSystem, Interactable } from '../interaction/GrabSystem'
import { LooseItem } from '../interaction/LooseItem'
import { Label, type LabelLine } from '../ui/Label'
import { DECK_Y, type Galleon } from '../world/ship/Galleon'
import { deckHalfWidth } from './deck'

/** Seconds to fill a mug at full trigger. */
const FILL_SECONDS = 2.2
/** Seconds to drain a full mug. */
const DRINK_SECONDS = 1.4
/** Mug within this distance of the headset counts as at the mouth (brief: ~15 cm). */
const MOUTH_DISTANCE = 0.15
const HIGHLIGHT = new THREE.Color(0x2e7896)
const BLACK = new THREE.Color(0x000000)

export const BARREL_POSITION = new THREE.Vector3(-(deckHalfWidth(8.3) - 0.6), DECK_Y, 8.3)
/** The table the barrel sits on (station-local: width along the ship, depth across it). */
const TABLE = { width: 1.0, depth: 0.6, height: 0.78 }

export interface BeerContext {
  audio: AudioSystem
  beer: Particles
  camera: THREE.Camera
  /** Called with the fraction of a mug just swallowed. */
  onDrink: (amount: number, hand: Hand) => void
  /** A swig of hot sauce: sobers you right up. */
  onHotSauce: (hand: Hand) => void
  /** A word of explanation the first time something's picked up. */
  hint: (text: string) => void
}

// A beer barrel with a brass tap, on a table with pewter mugs. Hold a mug under the tap and pull
// the trigger to fill it (foam rises); raise it to your mouth and tilt to drink.
export class BeerBarrel {
  readonly mugs: Mug[] = []
  readonly spout = new THREE.Object3D()
  /** How-to sign over the barrel; the step you're on lights up. */
  private readonly sign = new Label({ width: 0.8, canvasWidth: 640, canvasHeight: 440, billboard: true })

  constructor(ship: Galleon, grab: GrabSystem, ctx: BeerContext) {
    // A small tavern table by the rail. The barrel lies on its side in a cradle on the table, tap
    // end over the table's inboard edge (so a mug fits under it); the mugs stand beside it.
    const station = new THREE.Group()
    station.position.copy(BARREL_POSITION)
    // Local +z faces the middle of the deck; local x runs along the ship.
    station.rotation.y = Math.PI / 2
    const oak = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.8 })
    const plank = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.85 })
    const iron = new THREE.MeshStandardMaterial({ color: 0x2c2c2e, roughness: 0.5, metalness: 0.6 })
    const brass = new THREE.MeshStandardMaterial({ color: 0xc59a3c, roughness: 0.35, metalness: 0.7 })

    const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.width, 0.05, TABLE.depth), plank)
    top.position.y = TABLE.height - 0.025
    station.add(top)
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, TABLE.height - 0.05, 0.06), plank)
        leg.position.set(x * (TABLE.width / 2 - 0.06), (TABLE.height - 0.05) / 2, z * (TABLE.depth / 2 - 0.06))
        station.add(leg)
      }
    }

    // Barrel on its side, axis across the table (local z), on two chocks.
    const R = 0.26
    const LENGTH = 0.66
    const cx = -0.24
    const cy = TABLE.height + 0.03 + R
    for (const z of [-0.18, 0.18]) {
      const chock = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.06), plank)
      chock.position.set(cx, TABLE.height + 0.04, z)
      station.add(chock)
    }
    const body = new THREE.Group()
    body.position.set(cx, cy, -LENGTH / 2)
    body.rotation.x = Math.PI / 2
    const profile = [
      [0.0, 0.0], [0.87, 0.0], [0.94, 0.25], [1.0, 0.5], [0.94, 0.75], [0.87, 1.0], [0.0, 1.0],
    ].map(([r, y]) => new THREE.Vector2(r * R, y * LENGTH))
    body.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 18), oak))
    for (const y of [0.1, 0.9]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(R * 0.9, 0.01, 6, 24), iron)
      hoop.rotation.x = Math.PI / 2
      hoop.position.y = y * LENGTH
      body.add(hoop)
    }
    station.add(body)

    // Tap low on the inboard end, sticking out past the table edge.
    const endZ = LENGTH / 2
    const tapY = cy - R * 0.55
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), brass)
    tap.rotation.x = Math.PI / 2
    tap.position.set(cx, tapY, endZ + 0.07)
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.014, 0.06, 8), brass)
    nozzle.position.set(cx, tapY - 0.03, endZ + 0.13)
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.02), new THREE.MeshStandardMaterial({ color: 0x1d1d1d }))
    handle.position.set(cx, tapY + 0.06, endZ + 0.11)
    station.add(tap, nozzle, handle)
    this.spout.position.set(cx, tapY - 0.06, endZ + 0.13)
    station.add(this.spout)
    ship.shake.add(station)
    this.sign.mesh.position.set(0, 1.85, 0)
    station.add(this.sign.mesh)

    // Four mugs stand on the table beside the barrel, one per player.
    const slots: [number, number][] = [[0.14, -0.12], [0.34, -0.12], [0.14, 0.12], [0.34, 0.12]]
    for (const [x, z] of slots) {
      const mug = new Mug(station, new THREE.Vector3(x, TABLE.height, z), this.spout, ctx)
      this.mugs.push(grab.add(mug))
    }

    // A bottle of hot sauce standing on top of the barrel: one swig and your head clears.
    const bottle = makeHotSauce()
    bottle.position.set(cx, cy + R, 0)
    station.add(bottle)
    let atMouthSince = -1
    let lastSwig = -10
    let hinted = false
    const up = new THREE.Vector3()
    const head = new THREE.Vector3()
    const neck = new THREE.Vector3()
    const base = new THREE.Vector3()
    const near = new THREE.Vector3()
    const mouthDrop = new THREE.Vector3(0, -0.07, 0)
    const segment = new THREE.Line3()
    grab.add(
      new LooseItem(bottle, {
        radius: 0.09,
        settle: 'home',
        onGrab: () => {
          if (!hinted) ctx.hint('Hot sauce! Raise it to your mouth and tip it back for a swig. It clears your head.')
          hinted = true
          return false
        },
        whileHeld: (hand) => {
          const now = performance.now() / 1000
          up.set(0, 1, 0).applyQuaternion(bottle.getWorldQuaternion(new THREE.Quaternion()))
          // Any part of the bottle (base to neck) at your mouth, a little below your eyes, tipped back.
          const mouth = ctx.camera.getWorldPosition(head).add(mouthDrop)
          bottle.localToWorld(neck.set(0, 0.2, 0))
          const along = segment.set(bottle.getWorldPosition(base), neck).closestPointToPoint(mouth, true, near)
          const atMouth = along.distanceTo(mouth) < MOUTH_DISTANCE + 0.05 && up.y < 0.45
          if (!atMouth) {
            atMouthSince = -1
            return
          }
          if (atMouthSince < 0) atMouthSince = now
          if (now - atMouthSince > 0.4 && now - lastSwig > 3) {
            lastSwig = now
            ctx.audio.play('gulp', head, 0.8)
            hand.pulse(1, 250)
            ctx.onHotSauce(hand)
          }
        },
      }),
    )
    this.updateSign()
  }

  /** Keep the sign facing you and highlight the next step. */
  update(camera: THREE.Camera): void {
    this.updateSign()
    this.sign.face(camera)
  }

  private updateSign(): void {
    const mug = this.mugs.find((m) => m.heldBy)
    const step = !mug ? 0 : mug.fill < 0.98 && !mug.drank ? 1 : 2
    const line = (i: number, text: string): LabelLine =>
      i === step ? { text: `▶ ${text}`, color: '#ffd27a', size: 30, bold: true } : { text, size: 27, color: '#d9e2e6' }
    this.sign.set([
      { text: 'Grog', size: 44, bold: true, color: '#f2b64a' },
      line(0, '1. Grip a mug (or point at one and grip)'),
      line(1, '2. Hold it under the brass tap and pull the trigger to fill'),
      line(2, '3. Raise it to your mouth and tip it back to drink'),
    ])
  }
}

export class Mug implements Interactable {
  readonly object = new THREE.Group()
  /** 0 empty – 1 full. */
  fill = 0
  heldBy: Hand | null = null
  /** Has been drunk from since it was picked up (keeps the sign on step 3 while you sip). */
  drank = false
  private readonly beer: THREE.Mesh
  private readonly foam: THREE.Mesh
  private readonly materials: THREE.MeshStandardMaterial[] = []
  private readonly homeParent: THREE.Object3D
  private readonly homePos: THREE.Vector3
  private returning = 0
  private gulpTimer = 0
  private pourTimer = 0
  private readonly v = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly up = new THREE.Vector3()

  constructor(
    parent: THREE.Object3D,
    position: THREE.Vector3,
    private readonly spout: THREE.Object3D,
    private readonly ctx: BeerContext,
  ) {
    const pewter = new THREE.MeshStandardMaterial({ color: 0x9a9fa3, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide })
    this.materials.push(pewter)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.13, 16, 1, true), pewter)
    body.position.y = 0.065
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), pewter)
    bottom.rotation.x = -Math.PI / 2
    bottom.position.y = 0.002
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 12, Math.PI), pewter)
    handle.position.set(0.05, 0.065, 0)
    handle.rotation.z = -Math.PI / 2
    this.beer = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.047, 1, 16), new THREE.MeshStandardMaterial({ color: 0xc98a1c, roughness: 0.2, transparent: true, opacity: 0.9 }))
    this.foam = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.018, 16), new THREE.MeshStandardMaterial({ color: 0xfff6e0, roughness: 1 }))
    this.object.add(body, bottom, handle, this.beer, this.foam)
    parent.add(this.object)
    this.object.position.copy(position)
    this.homeParent = parent
    this.homePos = position.clone()
    this.updateLiquid()
  }

  grabGap(point: THREE.Vector3): number {
    if (this.heldBy) return Infinity
    return point.distanceTo(this.object.localToWorld(this.v.set(0, 0.065, 0))) - 0.08
  }

  grab(hand: Hand): void {
    this.heldBy = hand
    this.drank = false
    this.returning = 0
    hand.grip.attach(this.object)
    hand.pulse(0.25, 25)
  }

  release(hand: Hand): void {
    if (hand !== this.heldBy) return
    this.heldBy = null
    this.homeParent.attach(this.object)
    this.returning = 0.35
  }

  /** Put the mug down right away (the drinker passed out, the ship went down). */
  dropNow(): void {
    if (this.heldBy) this.heldBy.held = null
    this.heldBy = null
    this.homeParent.add(this.object)
    this.object.position.copy(this.homePos)
    this.object.rotation.set(0, 0, 0)
    this.returning = 0
  }

  setHighlight(on: boolean): void {
    for (const m of this.materials) m.emissive.copy(on ? HIGHLIGHT : BLACK)
  }

  update(dt: number): void {
    if (this.returning > 0) {
      this.returning = Math.max(0, this.returning - dt)
      const k = 1 - Math.exp(-14 * dt)
      this.object.position.lerp(this.homePos, k)
      this.object.quaternion.slerp(new THREE.Quaternion(), k)
      if (this.returning === 0) this.dropNow()
      return
    }
    const hand = this.heldBy
    if (!hand) return

    const mouth = this.object.localToWorld(this.v.set(0, 0.13, 0))
    this.up.set(0, 1, 0).transformDirection(this.object.matrixWorld)
    const upright = this.up.y > 0.8
    const nearFace = mouth.distanceTo(this.ctx.camera.getWorldPosition(this.v2)) < MOUTH_DISTANCE

    // Filling: mouth of the mug just under the spout, trigger pulled.
    const spout = this.spout.getWorldPosition(this.v2)
    const dx = Math.hypot(mouth.x - spout.x, mouth.z - spout.z)
    const below = spout.y - mouth.y
    if (upright && dx < 0.07 && below > -0.02 && below < 0.25 && hand.trigger > 0.2 && this.fill < 1) {
      this.fill = Math.min(1, this.fill + (dt / FILL_SECONDS) * hand.trigger)
      this.ctx.beer.emit({ position: spout, velocity: new THREE.Vector3(0, -1.5, 0), spread: 0.05, color: 0xd99a2a, size: 0.015, life: 0.2, count: 2 })
      this.pourTimer -= dt
      if (this.pourTimer <= 0) {
        this.pourTimer = 0.5
        this.ctx.audio.play('pour', spout, 0.6)
      }
      hand.pulse(0.05, 20)
    }

    // Drinking: at the mouth and tipped up.
    if (nearFace && this.up.y < 0.6 && this.fill > 0) {
      const amount = Math.min(this.fill, dt / DRINK_SECONDS)
      this.fill -= amount
      this.drank = true
      this.ctx.onDrink(amount, hand)
      this.gulpTimer -= dt
      if (this.gulpTimer <= 0) {
        this.gulpTimer = 0.45
        this.ctx.audio.play('gulp', mouth, 0.8)
        hand.pulse(0.15, 40)
      }
    } else if (this.up.y < 0 && this.fill > 0 && mouth.distanceTo(this.ctx.camera.getWorldPosition(this.v2)) > 0.35) {
      // Turned upside down well away from the face: it pours out on the deck.
      this.fill = Math.max(0, this.fill - dt * 0.8)
      this.ctx.beer.emit({ position: mouth, velocity: new THREE.Vector3(0, -1, 0), spread: 0.3, color: 0xd99a2a, size: 0.02, life: 0.4, count: 2 })
    }
    this.updateLiquid()
  }

  private updateLiquid(): void {
    const level = Math.max(0.001, this.fill) * 0.115
    this.beer.visible = this.foam.visible = this.fill > 0.01
    this.beer.scale.y = level
    this.beer.position.y = 0.006 + level / 2
    this.foam.position.y = 0.006 + level + 0.009
  }
}

/** A little red bottle of hot sauce with a white label and a green cap (origin at its base). */
function makeHotSauce(): THREE.Group {
  const group = new THREE.Group()
  const glass = new THREE.MeshStandardMaterial({ color: 0xb3161b, roughness: 0.25, metalness: 0.1 })
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.035, 0.13, 14), glass)
  body.position.y = 0.065
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.032, 0.03, 14), glass)
  shoulder.position.y = 0.145
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.04, 10), glass)
  neck.position.y = 0.18
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.022, 10), new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.5 }))
  cap.position.y = 0.21
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f4ecd8'
  ctx.fillRect(0, 0, 256, 64)
  ctx.fillStyle = '#b3161b'
  ctx.font = 'bold 34px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText('HOT SAUCE', 128, 44)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0355, 0.05, 16, 1, true), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }))
  label.position.y = 0.065
  group.add(body, shoulder, neck, cap, label)
  return group
}
