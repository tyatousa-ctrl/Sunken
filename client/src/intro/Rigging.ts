import * as THREE from 'three'
import { DECK_Y, NEST_FLOOR_Y, NEST_RADIUS, type Galleon } from '../world/ship/Galleon'

// Ship-local corners of the rigging net: a rope net rising from the deck just aft of the main mast
// up to the crow's nest rim, clear of the sails (they hang forward of the mast).
const BOTTOM = { y: DECK_Y + 0.25, z: 3.2, half: 0.9 }
const TOP = { y: NEST_FLOOR_Y + 0.15, z: NEST_RADIUS - 0.05, half: 0.5 }
/** Standing on the nest floor: this far from the mast's centre. */
const NEST_INNER = 0.32
const NEST_OUTER = NEST_RADIUS - 0.25
/** Climbers' heads stay this far behind the net. */
const HOLD_DISTANCE = 0.35

/** Deck obstacles (ship-local circles) where the net's lowest part meets the deck. */
export const NET_OBSTACLES = [-0.6, 0, 0.6].map((x) => ({ x, z: BOTTOM.z - 0.1, r: 0.3 }))

// The climbing net up the main mast and the crow's nest at its top. Grip the net to climb hand over
// hand; at the top, A/X climbs over the rim into the nest (or pull yourself in). From the nest, A/X
// or gripping the net takes you back down. Answers the questions the player's physics asks: is this
// point on the net, what floor is under me, where may I stand up there.
export class Rigging {
  readonly net: THREE.Mesh
  private readonly local = new THREE.Vector3()
  private readonly v = new THREE.Vector3()

  constructor(private readonly ship: Galleon) {
    const corners = [
      [-BOTTOM.half, BOTTOM.y, BOTTOM.z],
      [BOTTOM.half, BOTTOM.y, BOTTOM.z],
      [TOP.half, TOP.y, TOP.z],
      [-TOP.half, TOP.y, TOP.z],
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
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, BOTTOM.half * 2 + 0.1, 8), new THREE.MeshStandardMaterial({ color: 0x4a2f1b, roughness: 0.85 }))
    bar.rotation.z = Math.PI / 2
    bar.position.set(0, BOTTOM.y, BOTTOM.z)
    ship.shake.add(bar)
  }

  /**
   * Is a world point on the net (within `reach` of it)? Used for hands (small reach: grip it) and
   * for the body (larger reach: hanging on it without falling).
   */
  onNet(point: THREE.Vector3, reach: number): boolean {
    const p = this.toLocal(point)
    const v = (p.y - BOTTOM.y) / (TOP.y - BOTTOM.y)
    if (v < -0.05 || v > 1.08) return false
    const clamped = THREE.MathUtils.clamp(v, 0, 1)
    const half = THREE.MathUtils.lerp(BOTTOM.half, TOP.half, clamped) + 0.1
    if (Math.abs(p.x) > half + reach) return false
    // Distance to the slanted plane, measured along z and corrected for the slope.
    const netZ = THREE.MathUtils.lerp(BOTTOM.z, TOP.z, v)
    const slope = (TOP.z - BOTTOM.z) / (TOP.y - BOTTOM.y)
    return Math.abs(p.z - netZ) / Math.sqrt(1 + slope * slope) < reach
  }

  /**
   * How far (world) to move a climber's head so it stays just behind the net, on the deck side,
   * as the net leans in toward the mast (hands pulling straight down would drift off it).
   */
  holdOffset(head: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const p = this.toLocal(head)
    const v = THREE.MathUtils.clamp((p.y - BOTTOM.y) / (TOP.y - BOTTOM.y), 0, 1)
    const netZ = THREE.MathUtils.lerp(BOTTOM.z, TOP.z, v)
    const half = THREE.MathUtils.lerp(BOTTOM.half, TOP.half, v)
    target.set(THREE.MathUtils.clamp(p.x, -half, half) - p.x, 0, netZ + HOLD_DISTANCE - p.z)
    return target.applyQuaternion(this.ship.shake.getWorldQuaternion(new THREE.Quaternion()))
  }

  /** Straight up the net (world), for keyboard climbing. */
  upTheNet(target: THREE.Vector3): THREE.Vector3 {
    target.set(0, TOP.y - BOTTOM.y, TOP.z - BOTTOM.z).normalize()
    return target.applyQuaternion(this.ship.shake.getWorldQuaternion(new THREE.Quaternion()))
  }

  /** Near the top of the net: high enough to climb over the rim into the nest. */
  nearTop(head: THREE.Vector3): boolean {
    const p = this.toLocal(head)
    return p.y > NEST_FLOOR_Y + 0.3 && p.y < NEST_FLOOR_Y + 2.6 && Math.hypot(p.x, p.z) < NEST_RADIUS + 1.3 && this.onNet(head, 1.1)
  }

  /** Is this head (world) up in the nest? */
  inNest(head: THREE.Vector3): boolean {
    const p = this.toLocal(head)
    return p.y > NEST_FLOOR_Y + 0.4 && Math.hypot(p.x, p.z) < NEST_RADIUS + 0.1
  }

  /** The nest floor (world y) under a point, if the point is up there; else null. */
  nestFloorAt(x: number, z: number, below: number): number | null {
    const p = this.toLocal(this.v.set(x, below, z))
    if (p.y < NEST_FLOOR_Y - 0.6 || Math.hypot(p.x, p.z) > NEST_RADIUS) return null
    return this.ship.shake.localToWorld(this.v.set(p.x, NEST_FLOOR_Y, p.z)).y
  }

  /** Keep a head in the nest between the mast and the rim (ship-local point, changed in place). */
  constrainInNest(p: THREE.Vector3): void {
    const r = Math.hypot(p.x, p.z)
    if (r < 1e-4) {
      p.z = NEST_INNER
      return
    }
    const clamped = THREE.MathUtils.clamp(r, NEST_INNER, NEST_OUTER)
    p.x *= clamped / r
    p.z *= clamped / r
  }

  /** Where to stand after climbing in: on the nest floor, on the net's side (world, feet). */
  nestSpot(target: THREE.Vector3): THREE.Vector3 {
    return this.ship.shake.localToWorld(target.set(0, NEST_FLOOR_Y, 0.55))
  }

  /** Where your head is after climbing out: hanging on the top of the net (world). */
  netTopHang(target: THREE.Vector3): THREE.Vector3 {
    const v = 0.82
    return this.ship.shake.localToWorld(target.set(0, THREE.MathUtils.lerp(BOTTOM.y, TOP.y, v) + 0.2, THREE.MathUtils.lerp(BOTTOM.z, TOP.z, v) + 0.4))
  }

  /** At the foot of the net, on deck (world, feet): where someone climbing is sent down to. */
  footOfNet(target: THREE.Vector3): THREE.Vector3 {
    return this.ship.shake.localToWorld(target.set(0, DECK_Y, BOTTOM.z + 0.6))
  }

  private toLocal(point: THREE.Vector3): THREE.Vector3 {
    this.ship.shake.updateWorldMatrix(true, false)
    return this.ship.shake.worldToLocal(this.local.copy(point))
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
