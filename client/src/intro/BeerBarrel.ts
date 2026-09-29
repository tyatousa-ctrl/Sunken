import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { GrabSystem, Interactable } from '../interaction/GrabSystem'
import { DECK_Y, halfWidthAt, type Galleon } from '../world/ship/Galleon'

/** Seconds to fill a mug at full trigger. */
const FILL_SECONDS = 2.2
/** Seconds to drain a full mug. */
const DRINK_SECONDS = 1.4
/** Mug within this distance of the headset counts as at the mouth (brief: ~15 cm). */
const MOUTH_DISTANCE = 0.15
const HIGHLIGHT = new THREE.Color(0x2e7896)
const BLACK = new THREE.Color(0x000000)

export const BARREL_POSITION = new THREE.Vector3(-(halfWidthAt(8.3) - 0.55), DECK_Y, 8.3)

export interface BeerContext {
  audio: AudioSystem
  beer: Particles
  camera: THREE.Camera
  /** Called with the fraction of a mug just swallowed. */
  onDrink: (amount: number, hand: Hand) => void
}

// A beer barrel with a brass tap and a stack of pewter mugs. Hold a mug under the tap and pull the
// trigger to fill it (foam rises); raise it to your mouth and tilt to drink.
export class BeerBarrel {
  readonly mugs: Mug[] = []
  readonly spout = new THREE.Object3D()

  constructor(ship: Galleon, grab: GrabSystem, ctx: BeerContext) {
    const barrel = new THREE.Group()
    barrel.position.copy(BARREL_POSITION)
    // Face the tap toward the middle of the deck.
    barrel.rotation.y = Math.PI / 2
    const oak = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.8 })
    const iron = new THREE.MeshStandardMaterial({ color: 0x2c2c2e, roughness: 0.5, metalness: 0.6 })
    const brass = new THREE.MeshStandardMaterial({ color: 0xc59a3c, roughness: 0.35, metalness: 0.7 })
    const profile = [
      [0.0, 0.0], [0.3, 0.0], [0.34, 0.25], [0.36, 0.45], [0.34, 0.65], [0.3, 0.9], [0.0, 0.9],
    ].map(([r, y]) => new THREE.Vector2(r, y))
    barrel.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 18), oak))
    for (const y of [0.1, 0.8]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(y === 0.1 ? 0.315 : 0.305, 0.012, 6, 24), iron)
      hoop.rotation.x = Math.PI / 2
      hoop.position.y = y
      barrel.add(hoop)
    }
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), brass)
    tap.rotation.x = Math.PI / 2
    tap.position.set(0, 0.5, 0.41)
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.014, 0.06, 8), brass)
    nozzle.position.set(0, 0.47, 0.47)
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.02), new THREE.MeshStandardMaterial({ color: 0x1d1d1d }))
    handle.position.set(0, 0.56, 0.45)
    barrel.add(tap, nozzle, handle)
    this.spout.position.set(0, 0.44, 0.47)
    barrel.add(this.spout)
    ship.shake.add(barrel)

    // Four mugs stand on the barrel head, one per player.
    const slots: [number, number][] = [[-0.12, -0.1], [0.12, -0.1], [-0.12, 0.12], [0.12, 0.12]]
    for (const [x, z] of slots) {
      const mug = new Mug(barrel, new THREE.Vector3(x, 0.9, z), this.spout, ctx)
      this.mugs.push(grab.add(mug))
    }
  }
}

export class Mug implements Interactable {
  readonly object = new THREE.Group()
  /** 0 empty – 1 full. */
  fill = 0
  heldBy: Hand | null = null
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
