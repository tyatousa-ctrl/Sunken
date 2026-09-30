import * as THREE from 'three'
import { mergeStatic } from '../world/merge'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import type { GrabSystem, Interactable } from '../interaction/GrabSystem'
import { CABIN_FRONT_Z, DECK_Y, STERN_Z, type Galleon } from '../world/ship/Galleon'

/** Top of the captain's cabin roof (ship-local y): the quarterdeck. */
export const ROOF_Y = DECK_Y + 2.725
/** The stairs up, starboard of the cabin door (ship-local). */
export const STAIRS = { x0: 0.7, x1: 1.45, zBottom: CABIN_FRONT_Z - 2.7, zTop: CABIN_FRONT_Z }
/** Walkable roof area (ship-local), inside its railing. */
const ROOF = { x: 3.25, zFront: CABIN_FRONT_Z + 0.2, zBack: STERN_Z - 0.2 }
/** The ship's wheel: centre (ship-local), facing forward; the helmsman stands aft of it. */
export const WHEEL_CENTER = new THREE.Vector3(0, ROOF_Y + 1.15, 11.9)
export const WHEEL_RADIUS = 0.75
/** Full lock either way, in wheel turns. */
const WHEEL_TURNS = 1.5
/** Parrot perch and cracker table on the quarterdeck (ship-local, floor level). */
export const PERCH_SPOT = new THREE.Vector3(-1.6, ROOF_Y, 11.3)
export const CRACKER_TABLE = new THREE.Vector3(-2.5, ROOF_Y, 10.6)
/** The swivel gun on its post, starboard of the wheel (ship-local, floor level). */
export const SWIVEL_SPOT = new THREE.Vector3(2.3, ROOF_Y, 11.4)
/** Things on the roof you can't walk through (ship-local circles). */
const ROOF_OBSTACLES = [
  { x: WHEEL_CENTER.x, z: WHEEL_CENTER.z, r: 0.35 },
  { x: PERCH_SPOT.x, z: PERCH_SPOT.z, r: 0.25 },
  { x: CRACKER_TABLE.x, z: CRACKER_TABLE.z, r: 0.45 },
  { x: SWIVEL_SPOT.x, z: SWIVEL_SPOT.z, r: 0.2 },
]

// The quarterdeck on top of the captain's cabin: stairs up from the main deck, a railing round the
// edge, and the helm, a big spoked wheel that steers the ship. Also answers the walking questions:
// the height of the stairs and roof underfoot, and where you may stand up there.
export class Quarterdeck {
  readonly wheel: ShipWheel
  /** The cracker table (things sit on it at y = 0.8). */
  readonly table = new THREE.Group()
  private readonly local = new THREE.Vector3()

  constructor(
    private readonly ship: Galleon,
    grab: GrabSystem,
    audio: AudioSystem,
  ) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.85 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x3b2413, roughness: 0.9 })
    const group = new THREE.Group()

    // Stairs: treads and risers between two stringers, with a handrail on the open side.
    const rise = ROOF_Y - DECK_Y
    const run = STAIRS.zTop - STAIRS.zBottom
    const steps = 11
    const width = STAIRS.x1 - STAIRS.x0
    const midX = (STAIRS.x0 + STAIRS.x1) / 2
    for (let i = 0; i < steps; i++) {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, run / steps + 0.02), wood)
      tread.position.set(midX, DECK_Y + ((i + 1) * rise) / steps - 0.025, STAIRS.zBottom + ((i + 0.5) * run) / steps)
      group.add(tread)
    }
    const slope = Math.atan2(rise, run)
    const length = Math.hypot(rise, run)
    for (const x of [STAIRS.x0, STAIRS.x1]) {
      const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, length), dark)
      stringer.position.set(x, DECK_Y + rise / 2, STAIRS.zBottom + run / 2)
      stringer.rotation.x = -slope
      group.add(stringer)
    }
    const handrail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, length, 8), dark)
    handrail.rotation.x = Math.PI / 2 - slope
    handrail.position.set(STAIRS.x1 + 0.02, DECK_Y + rise / 2 + 0.9, STAIRS.zBottom + run / 2)
    group.add(handrail)
    for (const t of [0.05, 0.5, 0.95]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), dark)
      post.position.set(STAIRS.x1 + 0.02, DECK_Y + rise * t + 0.45, STAIRS.zBottom + run * t)
      group.add(post)
    }

    // Railing round the roof, open where the stairs arrive.
    const railY = ROOF_Y + 1.0
    const rail = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az)
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, len), dark)
      top.position.set((ax + bx) / 2, railY, (az + bz) / 2)
      top.rotation.y = Math.atan2(bx - ax, bz - az)
      group.add(top)
      const posts = Math.max(2, Math.round(len / 0.9))
      for (let i = 0; i <= posts; i++) {
        const u = i / posts
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), dark)
        post.position.set(ax + (bx - ax) * u, ROOF_Y + 0.5, az + (bz - az) * u)
        group.add(post)
      }
    }
    const e = 3.55
    const front = CABIN_FRONT_Z - 0.1
    rail(-e, front, STAIRS.x0 - 0.05, front)
    rail(STAIRS.x1 + 0.05, front, e, front)
    rail(-e, front, -e, STERN_Z + 0.1)
    rail(e, front, e, STERN_Z + 0.1)
    rail(-e, STERN_Z + 0.1, e, STERN_Z + 0.1)

    // Cracker table.
    const table = this.table
    table.position.copy(CRACKER_TABLE)
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.5), wood)
    top.position.y = 0.78
    table.add(top)
    for (const [x, z] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.76, 0.05), wood)
      leg.position.set(x, 0.38, z)
      table.add(leg)
    }
    group.add(table)

    // Perch stand for Polly: a post with a crossbar.
    const perch = new THREE.Group()
    perch.position.copy(PERCH_SPOT)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1.3, 8), dark)
    pole.position.y = 0.65
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), wood)
    bar.rotation.z = Math.PI / 2
    bar.position.y = 1.3
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 12), dark)
    foot.position.y = 0.025
    perch.add(pole, bar, foot)
    group.add(perch)

    // Stairs, railings, table and perch never move: one mesh per material (far fewer draw calls).
    mergeStatic(group)
    ship.shake.add(group)
    this.wheel = grab.add(new ShipWheel(ship.shake, audio))
  }

  /** Stairs height under a ship-local point (null if not over the stairs). */
  stairsHeight(p: THREE.Vector3): number | null {
    if (p.x < STAIRS.x0 - 0.05 || p.x > STAIRS.x1 + 0.05 || p.z < STAIRS.zBottom || p.z > STAIRS.zTop) return null
    return DECK_Y + ((p.z - STAIRS.zBottom) / (STAIRS.zTop - STAIRS.zBottom)) * (ROOF_Y - DECK_Y)
  }

  /** Is a ship-local point over the roof? */
  overRoof(p: THREE.Vector3): boolean {
    return Math.abs(p.x) < ROOF.x + 0.3 && p.z > CABIN_FRONT_Z - 0.15 && p.z < STERN_Z + 0.15
  }

  /**
   * Walkable height (world y) under a world point for feet at height `below` (world), counting only
   * the stairs and the roof; null if neither is under it.
   */
  groundAt(x: number, z: number, below: number | undefined): number | null {
    const p = this.toLocal(this.local.set(x, below ?? DECK_Y, z))
    const stairs = this.stairsHeight(p)
    if (stairs !== null && (below === undefined || p.y > stairs - 0.6)) return this.toWorldY(p.x, stairs, p.z)
    if (below !== undefined && this.overRoof(p) && p.y > ROOF_Y - 0.6) return this.toWorldY(p.x, ROOF_Y, p.z)
    return null
  }

  /**
   * Keep a head inside the quarterdeck or on the stairs, if the feet are up there (ship-local point,
   * changed in place). Returns false if the player is down on the main deck (the deck rules apply).
   */
  constrain(p: THREE.Vector3, feetY: number): boolean {
    const onStairs = p.x > STAIRS.x0 - 0.3 && p.x < STAIRS.x1 + 0.3 && p.z > STAIRS.zBottom && p.z < STAIRS.zTop + 0.3
    const raised = feetY > DECK_Y + 0.35
    // Down on the main deck, or far above (the crow's nest, the rigging): not our business.
    if (!raised || feetY > ROOF_Y + 0.8) return false
    if (feetY > ROOF_Y - 0.4 && this.overRoof(p)) {
      // On the roof: inside the railing; the gap to the stairs is open.
      const inGap = p.x > STAIRS.x0 + 0.1 && p.x < STAIRS.x1 - 0.1
      p.x = THREE.MathUtils.clamp(p.x, -ROOF.x, ROOF.x)
      p.z = THREE.MathUtils.clamp(p.z, inGap ? STAIRS.zTop - 0.3 : ROOF.zFront, ROOF.zBack)
      for (const o of ROOF_OBSTACLES) {
        const dx = p.x - o.x
        const dz = p.z - o.z
        const d = Math.hypot(dx, dz)
        if (d < o.r + 0.2 && d > 1e-4) {
          p.x = o.x + (dx / d) * (o.r + 0.2)
          p.z = o.z + (dz / d) * (o.r + 0.2)
        }
      }
      return true
    }
    if (!onStairs) return false
    // Part way up the stairs: between the stringers.
    p.x = THREE.MathUtils.clamp(p.x, STAIRS.x0 + 0.15, STAIRS.x1 - 0.15)
    p.z = THREE.MathUtils.clamp(p.z, STAIRS.zBottom - 0.2, STAIRS.zTop + 0.3)
    return true
  }

  private toLocal(point: THREE.Vector3): THREE.Vector3 {
    this.ship.shake.updateWorldMatrix(true, false)
    return this.ship.shake.worldToLocal(point)
  }

  private toWorldY(x: number, y: number, z: number): number {
    return this.ship.shake.localToWorld(new THREE.Vector3(x, y, z)).y
  }
}

// The helm: a big eight-spoked wheel. Grip the rim or a handle with one or both hands and turn it;
// it stays where you leave it. `rudder` is -1 (hard to port) … 1 (hard to starboard).
export class ShipWheel implements Interactable {
  readonly group = new THREE.Group()
  /** Wheel angle (radians); positive = turned clockwise as the helmsman sees it = starboard. */
  angle = 0
  /** Set while another crew member steers: the wheel follows them and can't be grabbed. */
  lockedBy: string | null = null
  onGrabbed: () => void = () => {}
  onReleased: () => void = () => {}
  private readonly spin = new THREE.Group()
  private readonly holds = new Map<Hand, number>()
  private readonly materials: THREE.MeshStandardMaterial[] = []
  private readonly v = new THREE.Vector3()
  private clickAngle = 0

  constructor(
    parent: THREE.Object3D,
    private readonly audio: AudioSystem,
  ) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.7 })
    const brass = new THREE.MeshStandardMaterial({ color: 0xc59a3c, roughness: 0.35, metalness: 0.7 })
    this.materials.push(wood)
    // Pedestal, forward of the wheel so nothing stands between it and the helmsman.
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.35, WHEEL_CENTER.y - ROOF_Y, 0.35), new THREE.MeshStandardMaterial({ color: 0x3b2413, roughness: 0.9 }))
    pedestal.position.set(0, -(WHEEL_CENTER.y - ROOF_Y) / 2, -0.25)
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 10), brass)
    axle.rotation.x = Math.PI / 2
    axle.position.z = -0.15
    this.group.add(pedestal, axle)
    // The wheel turns in the x-y plane (it faces along z).
    const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_RADIUS, 0.035, 8, 40), wood)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 16), brass)
    hub.rotation.x = Math.PI / 2
    this.spin.add(rim, hub)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, WHEEL_RADIUS + 0.28, 8), wood)
      spoke.position.set(Math.sin(a) * (WHEEL_RADIUS + 0.28) * 0.5, Math.cos(a) * (WHEEL_RADIUS + 0.28) * 0.5, 0)
      spoke.rotation.z = -a
      this.spin.add(spoke)
      // Turned handle past the rim; the top one ("king spoke") is brass-capped so you can see the centre.
      const handle = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? 0.045 : 0.035, 8, 6), i === 0 ? brass : wood)
      handle.position.set(Math.sin(a) * (WHEEL_RADIUS + 0.28), Math.cos(a) * (WHEEL_RADIUS + 0.28), 0)
      this.spin.add(handle)
    }
    this.group.add(this.spin)
    this.group.position.copy(WHEEL_CENTER)
    parent.add(this.group)
  }

  /** Where the wheel's in its travel: -1 hard to port … 1 hard to starboard. */
  get rudder(): number {
    return THREE.MathUtils.clamp(this.angle / (WHEEL_TURNS * Math.PI * 2), -1, 1)
  }

  get held(): boolean {
    return this.holds.size > 0
  }

  setAngle(angle: number): void {
    this.angle = angle
    this.spin.rotation.z = -angle
  }

  grabGap(point: THREE.Vector3): number {
    if (this.lockedBy) return Infinity
    const p = this.group.worldToLocal(this.v.copy(point))
    // Distance to the rim (a ring in the x-y plane), or to the handle ring just outside it.
    const r = Math.hypot(p.x, p.y)
    const toRim = Math.hypot(r - WHEEL_RADIUS, p.z)
    const toHandles = Math.hypot(r - (WHEEL_RADIUS + 0.28), p.z)
    return Math.min(toRim - 0.04, toHandles - 0.05)
  }

  grab(hand: Hand): void {
    const first = this.holds.size === 0
    this.holds.set(hand, this.handAngle(hand))
    hand.pulse(0.3, 30)
    if (first) this.onGrabbed()
  }

  release(hand: Hand): void {
    this.holds.delete(hand)
    if (this.holds.size === 0) this.onReleased()
  }

  setHighlight(on: boolean): void {
    for (const m of this.materials) m.emissive.setHex(on ? 0x2e7896 : 0x000000)
  }

  update(): void {
    if (this.holds.size === 0) return
    // Each hand turns the wheel by how far it has gone round the hub; two hands average.
    let turn = 0
    for (const [hand, last] of this.holds) {
      const now = this.handAngle(hand)
      let d = now - last
      if (d > Math.PI) d -= Math.PI * 2
      if (d < -Math.PI) d += Math.PI * 2
      turn += d
      this.holds.set(hand, now)
    }
    turn /= this.holds.size
    const limit = WHEEL_TURNS * Math.PI * 2
    const next = THREE.MathUtils.clamp(this.angle + turn, -limit, limit)
    if (Math.abs(next) === limit && Math.abs(this.angle) < limit) for (const hand of this.holds.keys()) hand.pulse(0.8, 60)
    this.setAngle(next)
    // A wooden tick every spoke's worth of turning.
    if (Math.abs(this.angle - this.clickAngle) > Math.PI / 4) {
      this.clickAngle = this.angle
      this.audio.play('click', this.group.getWorldPosition(this.v), 0.4)
      for (const hand of this.holds.keys()) hand.pulse(0.15, 15)
    }
  }

  /** Angle of a hand round the hub, clockwise from the top as the helmsman (aft of it) sees it. */
  private handAngle(hand: Hand): number {
    const p = this.group.worldToLocal(hand.worldPos(this.v))
    // The helmsman looks forward (-z), so their right is +x: clockwise from the top is atan2(x, y).
    return Math.atan2(p.x, p.y)
  }
}
