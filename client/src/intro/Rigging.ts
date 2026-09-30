import * as THREE from 'three'
import { DECK_Y, NEST_FLOOR_Y, NEST_RADIUS, type Galleon } from '../world/ship/Galleon'

/** Which mast a net climbs, and which side of it (1: aft of the mast, -1: forward of it). */
export interface RigSpec {
  mastZ: number
  /** The mast's height (its crow's nest scales with it: the main mast is 16 m). */
  height: number
  side: 1 | -1
}

/** The main mast's net, rising aft of the mast (the original rigging). */
export const MAIN_RIG: RigSpec = { mastZ: 0, height: 16, side: 1 }

/** Climbers' heads stay this far behind the net. */
const HOLD_DISTANCE = 0.35

/** Mast-relative shape of a rig: the net's corners (z measured away from the mast, on its side). */
function shapeOf(spec: RigSpec) {
  const k = spec.height / 16
  const nestRadius = NEST_RADIUS * k
  const nestFloor = DECK_Y + (NEST_FLOOR_Y - DECK_Y) * k
  return {
    bottom: { y: DECK_Y + 0.25, z: 3.2 * Math.max(0.85, k), half: 0.9 },
    top: { y: nestFloor + 0.15, z: nestRadius - 0.05, half: 0.5 },
    nestFloor,
    nestRadius,
    inner: 0.32 * k,
    outer: nestRadius - 0.25,
  }
}

/** Deck obstacles (ship-local circles) where a net's lowest part meets the deck. */
export function netObstacles(spec: RigSpec): { x: number; z: number; r: number }[] {
  const { bottom } = shapeOf(spec)
  return [-0.6, 0, 0.6].map((x) => ({ x, z: spec.mastZ + spec.side * (bottom.z - 0.1), r: 0.3 }))
}
export const NET_OBSTACLES = netObstacles(MAIN_RIG)

// A climbing net up a mast and the crow's nest at its top. Grip the net to climb hand over hand; at
// the top, A/X climbs over the rim into the nest (or pull yourself in). From the nest, A/X or gripping
// the net takes you back down. Answers the questions the player's physics asks: is this point on the
// net, what floor is under me, where may I stand up there.
export class Rigging {
  readonly net: THREE.Mesh
  readonly spec: RigSpec
  private readonly shape: ReturnType<typeof shapeOf>
  private readonly local = new THREE.Vector3()
  private readonly v = new THREE.Vector3()

  constructor(
    private readonly ship: Galleon,
    spec: RigSpec = MAIN_RIG,
  ) {
    this.spec = spec
    const shape = (this.shape = shapeOf(spec))
    const { bottom, top } = shape
    const z = (rel: number) => spec.mastZ + spec.side * rel
    const corners = [
      [-bottom.half, bottom.y, z(bottom.z)],
      [bottom.half, bottom.y, z(bottom.z)],
      [top.half, top.y, z(top.z)],
      [-top.half, top.y, z(top.z)],
    ]
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    geometry.computeVertexNormals()
    this.net = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ map: makeNetTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }),
    )
    ship.shake.add(this.net)

    // A wooden bar along the foot of the net, lashed to the deck.
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, bottom.half * 2 + 0.1, 8), new THREE.MeshStandardMaterial({ color: 0x4a2f1b, roughness: 0.85 }))
    bar.rotation.z = Math.PI / 2
    bar.position.set(0, bottom.y, z(bottom.z))
    ship.shake.add(bar)
  }

  /** The nest's floor height (ship-local y). */
  get nestFloorY(): number {
    return this.shape.nestFloor
  }

  /**
   * Is a world point on the net (within `reach` of it)? Used for hands (small reach: grip it) and
   * for the body (larger reach: hanging on it without falling).
   */
  onNet(point: THREE.Vector3, reach: number): boolean {
    const { bottom, top } = this.shape
    const p = this.toLocal(point)
    const v = (p.y - bottom.y) / (top.y - bottom.y)
    if (v < -0.05 || v > 1.08) return false
    const clamped = THREE.MathUtils.clamp(v, 0, 1)
    const half = THREE.MathUtils.lerp(bottom.half, top.half, clamped) + 0.1
    if (Math.abs(p.x) > half + reach) return false
    // Distance to the slanted plane, measured along z and corrected for the slope.
    const netZ = THREE.MathUtils.lerp(bottom.z, top.z, v)
    const slope = (top.z - bottom.z) / (top.y - bottom.y)
    return Math.abs(p.z - netZ) / Math.sqrt(1 + slope * slope) < reach
  }

  /**
   * How far (world) to move a climber's head so it stays just behind the net, on the deck side,
   * as the net leans in toward the mast (hands pulling straight down would drift off it).
   */
  holdOffset(head: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const { bottom, top } = this.shape
    const p = this.toLocal(head)
    const v = THREE.MathUtils.clamp((p.y - bottom.y) / (top.y - bottom.y), 0, 1)
    const netZ = THREE.MathUtils.lerp(bottom.z, top.z, v)
    const half = THREE.MathUtils.lerp(bottom.half, top.half, v)
    target.set(THREE.MathUtils.clamp(p.x, -half, half) - p.x, 0, (netZ + HOLD_DISTANCE - p.z) * this.spec.side)
    return target.applyQuaternion(this.ship.shake.getWorldQuaternion(new THREE.Quaternion()))
  }

  /** Straight up the net (world), for keyboard climbing. */
  upTheNet(target: THREE.Vector3): THREE.Vector3 {
    const { bottom, top } = this.shape
    target.set(0, top.y - bottom.y, (top.z - bottom.z) * this.spec.side).normalize()
    return target.applyQuaternion(this.ship.shake.getWorldQuaternion(new THREE.Quaternion()))
  }

  /** Near the top of the net: high enough to climb over the rim into the nest. */
  nearTop(head: THREE.Vector3): boolean {
    const p = this.toLocal(head)
    const { nestFloor, nestRadius } = this.shape
    return p.y > nestFloor + 0.3 && p.y < nestFloor + 2.6 && Math.hypot(p.x, p.z) < nestRadius + 1.3 && this.onNet(head, 1.1)
  }

  /** Close beside the nest (hanging off its rim, e.g. on a rope): near enough to climb in. */
  besideNest(head: THREE.Vector3): boolean {
    const p = this.toLocal(head)
    const { nestFloor, nestRadius } = this.shape
    return p.y > nestFloor - 1 && p.y < nestFloor + 3.5 && Math.hypot(p.x, p.z) < nestRadius + 1.8
  }

  /** Is this head (world) up in the nest? */
  inNest(head: THREE.Vector3): boolean {
    const p = this.toLocal(head)
    return p.y > this.shape.nestFloor + 0.4 && Math.hypot(p.x, p.z) < this.shape.nestRadius + 0.1
  }

  /** The nest floor (world y) under a point, if the point is up there; else null. */
  nestFloorAt(x: number, z: number, below: number): number | null {
    const p = this.toLocal(this.v.set(x, below, z))
    if (p.y < this.shape.nestFloor - 0.6 || Math.hypot(p.x, p.z) > this.shape.nestRadius) return null
    return this.ship.shake.localToWorld(this.v.set(p.x, this.shape.nestFloor, this.spec.mastZ + this.spec.side * p.z)).y
  }

  /** Keep a head in the nest between the mast and the rim (ship-local point, changed in place). */
  constrainInNest(p: THREE.Vector3): void {
    const { inner, outer } = this.shape
    const dz = p.z - this.spec.mastZ
    const r = Math.hypot(p.x, dz)
    if (r < 1e-4) {
      p.z = this.spec.mastZ + this.spec.side * inner
      return
    }
    const clamped = THREE.MathUtils.clamp(r, inner, outer)
    p.x *= clamped / r
    p.z = this.spec.mastZ + (dz * clamped) / r
  }

  /** Where to stand after climbing in: on the nest floor, on the net's side (world, feet). */
  nestSpot(target: THREE.Vector3): THREE.Vector3 {
    return this.ship.shake.localToWorld(target.set(0, this.shape.nestFloor, this.spec.mastZ + this.spec.side * 0.55 * (this.spec.height / 16)))
  }

  /** Where your head is after climbing out: hanging on the top of the net (world). */
  netTopHang(target: THREE.Vector3): THREE.Vector3 {
    const { bottom, top } = this.shape
    const v = 0.82
    return this.ship.shake.localToWorld(target.set(0, THREE.MathUtils.lerp(bottom.y, top.y, v) + 0.2, this.spec.mastZ + this.spec.side * (THREE.MathUtils.lerp(bottom.z, top.z, v) + 0.4)))
  }

  /** At the foot of the net, on deck (world, feet): where someone climbing is sent down to. */
  footOfNet(target: THREE.Vector3): THREE.Vector3 {
    return this.ship.shake.localToWorld(target.set(0, DECK_Y, this.spec.mastZ + this.spec.side * (this.shape.bottom.z + 0.6)))
  }

  /** Mast-relative ship-local point: z measured from the mast, positive on the net's side. */
  private toLocal(point: THREE.Vector3): THREE.Vector3 {
    this.ship.shake.updateWorldMatrix(true, false)
    this.ship.shake.worldToLocal(this.local.copy(point))
    this.local.z = (this.local.z - this.spec.mastZ) * this.spec.side
    return this.local
  }
}

/** Tarred rope in a diamond-ish square mesh, transparent between the ropes. */
function makeNetTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 1024
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 256, 1024)
  ctx.strokeStyle = '#6b5234'
  ctx.lineCap = 'round'
  // Ratlines across (rungs) and shrouds up.
  ctx.lineWidth = 7
  for (let y = 16; y < 1024; y += 48) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(256, y)
    ctx.stroke()
  }
  ctx.lineWidth = 10
  for (let x = 6; x < 256; x += 49) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 1024)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
