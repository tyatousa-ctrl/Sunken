import * as THREE from 'three'
import type { BoxCollider } from '../movement/environment'
import { applyCaustics, applySurfaceShimmer } from '../world/caustics'
import { SURFACE_Y, sandHeight } from '../world/SeabedScene'

/** The sea cliff's face runs along this z; the open sea is to the south (z larger). */
export const CLIFF_Z = 12
/** The cave: an ellipsoid of air and glowing water inside the cliff. */
export const CAVE = { center: new THREE.Vector3(0, SURFACE_Y, -18), half: new THREE.Vector3(12, 9, 22) }
/** The arch and short tunnel from the open sea into the cave (the "door"). */
export const SOUTH_TUNNEL = { halfX: 1.5, y0: 4.8, y1: 7.2, z0: -0.5, z1: CLIFF_Z + 0.6 }
/** The old ones' way out: a passage from the cave's north end, blocked by a boulder. */
export const NORTH_TUNNEL = { halfX: 1.5, y0: 3.6, y1: 6.4, z0: -52, z1: -35 }
/** A dark side tunnel off the east of the pool, underwater, to a small flooded chamber. */
export const SIDE_TUNNEL = { x0: 9.5, x1: 23, zc: -18, halfZ: 1.2, y0: SURFACE_Y - 4.6, y1: SURFACE_Y - 2.8 }
export const SIDE_CHAMBER = { x0: 23, x1: 29, z0: -21.5, z1: -14.5, y0: SURFACE_Y - 6, y1: SURFACE_Y - 1.6 }
/** Where divers may roam in the open sea: a circle south of the cliff. */
const SEA = { center: new THREE.Vector2(0, 36), radius: 30 }

export interface Shelf {
  name: string
  x0: number
  x1: number
  z0: number
  z1: number
  /** Walkable top (world y). */
  y: number
}

/** Rock shelves above the water: a U round the cave's north end (east, the camp platform, west). */
export const SHELVES: Shelf[] = [
  { name: 'east shelf', x0: 5.5, x1: 11.5, z0: -28, z1: -3, y: SURFACE_Y + 0.7 },
  { name: 'camp platform', x0: -7.5, x1: 7.5, z0: -39.5, z1: -27.5, y: SURFACE_Y + 0.9 },
  { name: 'west ledge', x0: -11.5, x1: -5.5, z0: -28, z1: -7, y: SURFACE_Y + 0.7 },
]

/** Is a point inside the cave ellipsoid, shrunk by `margin`? */
export function inCave(p: THREE.Vector3, margin = 0): boolean {
  const c = CAVE.center
  const h = CAVE.half
  const x = (p.x - c.x) / (h.x - margin)
  const y = (p.y - c.y) / (h.y - margin)
  const z = (p.z - c.z) / (h.z - margin)
  return x * x + y * y + z * z <= 1
}

/** Height of the cave's rock floor under (x, z), or null outside its footprint. */
export function caveFloor(x: number, z: number): number | null {
  const u = (x - CAVE.center.x) / CAVE.half.x
  const w = (z - CAVE.center.z) / CAVE.half.z
  const r = 1 - u * u - w * w
  if (r <= 0) return null
  return CAVE.center.y - CAVE.half.y * Math.sqrt(r)
}

/** Is a point in the dark side tunnel or its chamber? */
export function inSidePassage(p: THREE.Vector3): boolean {
  const t = SIDE_TUNNEL
  const c = SIDE_CHAMBER
  return (p.x > t.x0 + 1 && p.x < t.x1 && Math.abs(p.z - t.zc) < t.halfZ + 0.3) || (p.x >= c.x0 && p.x <= c.x1 && p.z >= c.z0 && p.z <= c.z1)
}

/** The seabed: sand outside, the cave's rock floor inside the cliff. */
export function grottoFloor(x: number, z: number): number {
  const t = SIDE_TUNNEL
  const c = SIDE_CHAMBER
  if (x >= c.x0 && x <= c.x1 + 0.5 && z >= c.z0 - 0.5 && z <= c.z1 + 0.5) return c.y0
  if (x > t.x0 + 1.5 && x < t.x1 && Math.abs(z - t.zc) < t.halfZ + 0.3) return t.y0
  // In the tunnels, their own floors (the cave's curved floor would otherwise rise across them).
  if (Math.abs(x) < NORTH_TUNNEL.halfX + 0.3 && z < NORTH_TUNNEL.z1 && z > NORTH_TUNNEL.z0 - 1) return NORTH_TUNNEL.y0
  if (Math.abs(x) < SOUTH_TUNNEL.halfX + 0.3 && z > SOUTH_TUNNEL.z0 && z < SOUTH_TUNNEL.z1) return SOUTH_TUNNEL.y0
  if (z < CLIFF_Z - 0.3) {
    const floor = caveFloor(x, z)
    if (floor !== null) return Math.max(floor, sandHeight(x, z))
  }
  return sandHeight(x, z)
}

/** The shelf under a point, if any. */
export function shelfAt(x: number, z: number, margin = 0): Shelf | null {
  return SHELVES.find((s) => x > s.x0 - margin && x < s.x1 + margin && z > s.z0 - margin && z < s.z1 + margin) ?? null
}

const inBox = (p: THREE.Vector3, halfX: number, y0: number, y1: number, z0: number, z1: number) =>
  Math.abs(p.x) <= halfX && p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1
const clampBox = (p: THREE.Vector3, halfX: number, y0: number, y1: number, z0: number, z1: number, out: THREE.Vector3) =>
  out.set(THREE.MathUtils.clamp(p.x, -halfX, halfX), THREE.MathUtils.clamp(p.y, y0, y1), THREE.MathUtils.clamp(p.z, z0, z1))

const nearest = new THREE.Vector3()
const candidate = new THREE.Vector3()

/**
 * Keep a diver's head (a sphere of `clearance`) inside the water it's allowed in: the open sea south
 * of the cliff, the arch tunnel, the cave, and the north passage. Adds the correction to `push`.
 */
export function containInGrotto(head: THREE.Vector3, clearance: number, push: THREE.Vector3): void {
  const c = clearance
  const st = SOUTH_TUNNEL
  const nt = NORTH_TUNNEL
  const seaDist = Math.hypot(head.x - SEA.center.x, head.z - SEA.center.y)
  if (head.z >= CLIFF_Z + c && seaDist <= SEA.radius - c) return
  if (inBox(head, st.halfX - c, st.y0 + c, st.y1 - c, st.z0, st.z1)) return
  if (inCave(head, c)) return
  if (inBox(head, nt.halfX - c, nt.y0 + c, nt.y1 - c, nt.z0, nt.z1)) return
  const side = SIDE_TUNNEL
  const room = SIDE_CHAMBER
  if (head.x >= side.x0 && head.x <= side.x1 + c && Math.abs(head.z - side.zc) <= side.halfZ - c && head.y >= side.y0 + c && head.y <= side.y1 - c) return
  if (head.x >= room.x0 + c && head.x <= room.x1 - c && head.z >= room.z0 + c && head.z <= room.z1 - c && head.y >= room.y0 + c && head.y <= room.y1 - c) return

  // Outside all of them: move to whichever is closest.
  let best = Infinity
  const consider = (p: THREE.Vector3) => {
    const d = p.distanceTo(head)
    if (d < best) {
      best = d
      nearest.copy(p)
    }
  }
  // Open sea: in front of the cliff and inside the circle.
  candidate.copy(head)
  candidate.z = Math.max(candidate.z, CLIFF_Z + c)
  const dx = candidate.x - SEA.center.x
  const dz = candidate.z - SEA.center.y
  const r = Math.hypot(dx, dz)
  if (r > SEA.radius - c) {
    candidate.x = SEA.center.x + (dx / r) * (SEA.radius - c)
    candidate.z = SEA.center.y + (dz / r) * (SEA.radius - c)
  }
  consider(candidate)
  consider(clampBox(head, st.halfX - c, st.y0 + c, st.y1 - c, st.z0, st.z1, candidate))
  consider(clampBox(head, nt.halfX - c, nt.y0 + c, nt.y1 - c, nt.z0, nt.z1, candidate))
  consider(candidate.set(
    THREE.MathUtils.clamp(head.x, side.x0, side.x1 + c),
    THREE.MathUtils.clamp(head.y, side.y0 + c, side.y1 - c),
    THREE.MathUtils.clamp(head.z, side.zc - side.halfZ + c, side.zc + side.halfZ - c),
  ))
  consider(candidate.set(
    THREE.MathUtils.clamp(head.x, room.x0 + c, room.x1 - c),
    THREE.MathUtils.clamp(head.y, room.y0 + c, room.y1 - c),
    THREE.MathUtils.clamp(head.z, room.z0 + c, room.z1 - c),
  ))
  // Cave: pull the point in toward the centre until it's inside (a close-enough nearest point).
  const cc = CAVE.center
  const h = CAVE.half
  const u = (head.x - cc.x) / (h.x - c)
  const v = (head.y - cc.y) / (h.y - c)
  const w = (head.z - cc.z) / (h.z - c)
  const k = 1 / Math.sqrt(u * u + v * v + w * w)
  consider(candidate.set(cc.x + u * k * (h.x - c), cc.y + v * k * (h.y - c), cc.z + w * k * (h.z - c)))
  push.add(nearest.sub(head))
}

/** Keep a walker's head within the cave walls (horizontally, at the head's height). */
export function constrainWalker(head: THREE.Vector3, margin = 0.5): void {
  const c = CAVE.center
  const h = CAVE.half
  const v = (head.y - c.y) / h.y
  const s = Math.sqrt(Math.max(0.05, 1 - v * v))
  const ax = h.x * s - margin
  const az = h.z * s - margin
  const u = (head.x - c.x) / ax
  const w = (head.z - c.z) / az
  const r = Math.hypot(u, w)
  if (r > 1) {
    head.x = c.x + (u / r) * ax
    head.z = c.z + (w / r) * az
  }
}

/** Solid shelves for swimmers (the rock under each walkable top). */
export function shelfColliders(): BoxCollider[] {
  return SHELVES.map((s) => {
    const depth = 3
    const matrix = new THREE.Matrix4().makeTranslation((s.x0 + s.x1) / 2, s.y - depth / 2, (s.z0 + s.z1) / 2)
    return { matrix, inverse: matrix.clone().invert(), half: new THREE.Vector3((s.x1 - s.x0) / 2, depth / 2, (s.z1 - s.z0) / 2) }
  })
}

// ---- Looks ------------------------------------------------------------------------------------

/** Pale limestone lit blue from the glowing water below: dancing reflections on walls and ceiling. */
function caveRock(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0x4d5864, roughness: 0.9, flatShading: true, side: THREE.BackSide, emissive: 0x0a2244 })
  // Light bounced up off the glowing water ripples across the ceiling (and faintly the upper walls).
  applyCaustics(material, 0.38, { facing: 'down', tint: [0.3, 0.65, 1.0] })
  return material
}

/** Build the cliff, the tunnels, the cave shell, both water surfaces and the shelves. */
export function buildGrotto(root: THREE.Object3D): { caveWater: THREE.Mesh; seaSurface: THREE.Mesh } {
  // The cliff face, with the arch cut through it.
  const cliffShape = new THREE.Shape([new THREE.Vector2(-90, -3), new THREE.Vector2(90, -3), new THREE.Vector2(90, 34), new THREE.Vector2(-90, 34)])
  const hole = new THREE.Path()
  const st = SOUTH_TUNNEL
  hole.moveTo(-st.halfX, st.y0)
  hole.lineTo(st.halfX, st.y0)
  hole.lineTo(st.halfX, st.y1 - 0.5)
  hole.absarc(0, st.y1 - 0.5, st.halfX, 0, Math.PI, false)
  hole.lineTo(-st.halfX, st.y0)
  cliffShape.holes.push(hole)
  const cliffMat = new THREE.MeshStandardMaterial({ color: 0x8a7d6c, roughness: 1, flatShading: true })
  applyCaustics(cliffMat, 0.5)
  const cliff = new THREE.Mesh(new THREE.ShapeGeometry(cliffShape, 6), cliffMat)
  cliff.position.z = CLIFF_Z
  root.add(cliff)

  // Tunnels: four rock walls each, open at both ends.
  const tunnelMat = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 1, side: THREE.DoubleSide })
  applyCaustics(tunnelMat, 0.3)
  for (const t of [SOUTH_TUNNEL, NORTH_TUNNEL]) {
    const len = t.z1 - t.z0
    const midZ = (t.z0 + t.z1) / 2
    const w = t.halfX * 2
    const h = t.y1 - t.y0
    for (const [px, py, rx, ry, sw, sh] of [
      [0, t.y0, -Math.PI / 2, 0, w, len],
      [0, t.y1, Math.PI / 2, 0, w, len],
      [-t.halfX, (t.y0 + t.y1) / 2, 0, Math.PI / 2, len, h],
      [t.halfX, (t.y0 + t.y1) / 2, 0, -Math.PI / 2, len, h],
    ]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), tunnelMat)
      wall.position.set(px, py, midZ)
      wall.rotation.set(rx, ry, 0)
      root.add(wall)
    }
  }

  // The cave: a bumpy ellipsoid seen from inside, with holes where the tunnels come in.
  const sphere = new THREE.SphereGeometry(1, 72, 44).toNonIndexed()
  const pos = sphere.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const bump = (p: THREE.Vector3) => 1 + 0.03 * Math.abs(Math.sin(p.x * 9.1 + p.y * 4.3) * Math.cos(p.z * 7.7 - p.y * 3.1) + 0.5 * Math.sin(p.x * 21 + p.z * 17))
  const kept: number[] = []
  for (let t = 0; t < pos.count; t += 3) {
    const tri: THREE.Vector3[] = []
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, t + k)
      const b = bump(v)
      tri.push(new THREE.Vector3(v.x * CAVE.half.x * b, v.y * CAVE.half.y * b, v.z * CAVE.half.z * b).add(CAVE.center))
    }
    const centroid = tri[0].clone().add(tri[1]).add(tri[2]).divideScalar(3)
    const opening = (tn: typeof SOUTH_TUNNEL, south: boolean) =>
      Math.abs(centroid.x) < tn.halfX + 0.25 && centroid.y > tn.y0 - 0.25 && centroid.y < tn.y1 + 0.25 && (south ? centroid.z > CAVE.center.z : centroid.z < CAVE.center.z)
    if (opening(SOUTH_TUNNEL, true) || opening(NORTH_TUNNEL, false)) continue
    // The side tunnel's mouth in the east wall.
    const st2 = SIDE_TUNNEL
    if (centroid.x > 6 && Math.abs(centroid.z - st2.zc) < st2.halfZ + 0.25 && centroid.y > st2.y0 - 0.25 && centroid.y < st2.y1 + 0.25) continue
    for (const p of tri) kept.push(p.x, p.y, p.z)
  }
  const shell = new THREE.BufferGeometry()
  shell.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3))
  shell.computeVertexNormals()
  root.add(new THREE.Mesh(shell, caveRock()))

  // The grotto's water: glowing blue, lit from below by the sun pouring in through the arch.
  const caveWaterMat = new THREE.MeshBasicMaterial({ color: 0x2f9df0, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false })
  applySurfaceShimmer(caveWaterMat)
  const caveWater = new THREE.Mesh(new THREE.CircleGeometry(1, 64), caveWaterMat)
  caveWater.rotation.x = -Math.PI / 2
  caveWater.scale.set(CAVE.half.x, CAVE.half.z, 1)
  caveWater.position.set(CAVE.center.x, SURFACE_Y, CAVE.center.z)
  caveWater.renderOrder = 5
  root.add(caveWater)

  // The open sea's surface, south of the cliff only.
  const seaMat = new THREE.MeshBasicMaterial({ color: 0x5fb8e6, side: THREE.DoubleSide })
  applySurfaceShimmer(seaMat)
  const seaSurface = new THREE.Mesh(new THREE.PlaneGeometry(180, 90), seaMat)
  seaSurface.rotation.x = -Math.PI / 2
  seaSurface.position.set(0, SURFACE_Y, CLIFF_Z + 45)
  root.add(seaSurface)

  // Shelves: flat-topped rock with a rough lip.
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x6b6f72, roughness: 1, flatShading: true })
  applyCaustics(shelfMat, 0.35, { facing: 'down', tint: [0.3, 0.65, 1.0] })
  for (const s of SHELVES) {
    const depth = 3.2
    const slab = new THREE.Mesh(new THREE.BoxGeometry(s.x1 - s.x0, depth, s.z1 - s.z0), shelfMat)
    slab.position.set((s.x0 + s.x1) / 2, s.y - depth / 2, (s.z0 + s.z1) / 2)
    root.add(slab)
  }
  buildSidePassage(root)
  addStalactites(root)
  return { caveWater, seaSurface }
}

/** The dark side tunnel and its little flooded chamber: black rock, a few glowing specks. */
function buildSidePassage(root: THREE.Object3D): void {
  const rock = new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 1, side: THREE.DoubleSide })
  const t = SIDE_TUNNEL
  const len = t.x1 - t.x0
  const midX = (t.x0 + t.x1) / 2
  const h = t.y1 - t.y0
  const w = t.halfZ * 2
  const plane = (sw: number, sh: number, x: number, y: number, z: number, rx: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), rock)
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, 0)
    root.add(m)
  }
  plane(len, w, midX, t.y0, t.zc, -Math.PI / 2, 0) // floor
  plane(len, w, midX, t.y1, t.zc, Math.PI / 2, 0) // roof
  plane(len, h, midX, (t.y0 + t.y1) / 2, t.zc - t.halfZ, 0, 0) // north wall
  plane(len, h, midX, (t.y0 + t.y1) / 2, t.zc + t.halfZ, 0, Math.PI) // south wall
  // The chamber: a box of rock, open only where the tunnel comes in.
  const c = SIDE_CHAMBER
  const cw = c.x1 - c.x0
  const cd = c.z1 - c.z0
  const ch = c.y1 - c.y0
  const cx = (c.x0 + c.x1) / 2
  const cz = (c.z0 + c.z1) / 2
  const cy = (c.y0 + c.y1) / 2
  plane(cw, cd, cx, c.y0, cz, -Math.PI / 2, 0)
  plane(cw, cd, cx, c.y1, cz, Math.PI / 2, 0)
  plane(cw, ch, cx, cy, c.z0, 0, 0)
  plane(cw, ch, cx, cy, c.z1, 0, Math.PI)
  plane(cd, ch, c.x1, cy, cz, 0, -Math.PI / 2)
  // West wall, round the tunnel mouth: above, below and either side of it.
  plane(cd, c.y1 - t.y1, c.x0, (t.y1 + c.y1) / 2, cz, 0, Math.PI / 2)
  plane(cd, t.y0 - c.y0, c.x0, (c.y0 + t.y0) / 2, cz, 0, Math.PI / 2)
  plane(t.zc - t.halfZ - c.z0, h, c.x0, (t.y0 + t.y1) / 2, (c.z0 + t.zc - t.halfZ) / 2, 0, Math.PI / 2)
  plane(c.z1 - t.zc - t.halfZ, h, c.x0, (t.y0 + t.y1) / 2, (c.z1 + t.zc + t.halfZ) / 2, 0, Math.PI / 2)
  // Glowing specks (tiny sea creatures) on the walls: enough to see the shape of the place, no more.
  const specks = new THREE.InstancedMesh(new THREE.SphereGeometry(0.025, 5, 4), new THREE.MeshBasicMaterial({ color: 0x5ff5e0, fog: false }), 70)
  const m = new THREE.Matrix4()
  let seed = 5
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 70; i++) {
    const inRoom = i >= 30
    const x = inRoom ? c.x0 + rand() * cw : t.x0 + 2 + rand() * (len - 2)
    const z = inRoom ? (rand() < 0.5 ? c.z0 + 0.05 : c.z1 - 0.05) : rand() < 0.5 ? t.zc - t.halfZ + 0.05 : t.zc + t.halfZ - 0.05
    const y = inRoom ? c.y0 + rand() * ch : t.y0 + rand() * h
    specks.setMatrixAt(i, m.makeTranslation(x, y, z))
  }
  root.add(specks)
}

/** Stalactites hanging from the cave roof, well above head height over the shelves. */
function addStalactites(root: THREE.Object3D): void {
  const count = 160
  // The same rock as the roof they grow from.
  const material = new THREE.MeshStandardMaterial({ color: 0x4d5864, roughness: 0.9, emissive: 0x0a2244 })
  applyCaustics(material, 0.3, { facing: 'down', tint: [0.3, 0.65, 1.0] })
  const cone = new THREE.ConeGeometry(0.2, 1, 9).rotateX(Math.PI).translate(0, -0.5, 0)
  const mesh = new THREE.InstancedMesh(cone, material, count)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const sc = new THREE.Vector3()
  const at = new THREE.Vector3()
  let seed = 17
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  let n = 0
  for (let tries = 0; tries < 2000 && n < count; tries++) {
    const u = (rand() * 2 - 1) * 0.92
    const w = (rand() * 2 - 1) * 0.95
    const r = 1 - u * u - w * w
    if (r <= 0.02) continue
    const x = CAVE.center.x + u * CAVE.half.x
    const z = CAVE.center.z + w * CAVE.half.z
    // Rooted well up inside the (bumpy) roof, so none float free of it.
    const roof = CAVE.center.y + CAVE.half.y * Math.sqrt(r) + 0.7
    const length = 1.4 + rand() * rand() * 3.2
    // Tips stay well clear of anyone standing on a shelf (and of the water).
    if (roof - length < SURFACE_Y + 3.6) continue
    q.identity()
    const thick = 0.8 + rand() * 1.1
    mesh.setMatrixAt(n++, m.compose(at.set(x, roof, z), q, sc.set(thick, length, thick)))
  }
  mesh.count = n
  root.add(mesh)
}
