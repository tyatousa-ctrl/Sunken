import * as THREE from 'three'
import { mergeStatic } from '../merge'

export type FlagKind = 'merchant' | 'pirate' | 'crew'

export interface GalleonOptions {
  hullColor?: number
  sailColor?: number
  flag?: FlagKind
  /** Build the captain's cabin as a room you can swim into (the wreck), not a solid block. */
  hollowCabin?: boolean
  /** Metres of extra deck added amidships (the crew's own ship is twice as long as a wreck). */
  stretch?: number
}

/** Deck outline (x, z) in ship-local metres, starboard side, stern → bow. Mirrored for port. */
const STARBOARD: [number, number][] = [
  [3.6, 13],
  [3.8, 4],
  [3.4, -6],
  [2.0, -11],
  [0.0, -14.5],
]
export const DECK_Y = 2.2
export const RAIL_HEIGHT = 1.0
export const STERN_Z = 13
export const BOW_Z = -14.5
/** The captain's cabin occupies the stern from here back. */
export const CABIN_FRONT_Z = 9.6
/** The main mast's crow's nest: its floor (ship-local y) and radius. Mast heights × this = nest floor. */
const NEST_HEIGHT = 0.525
export const NEST_FLOOR_Y = DECK_Y + 16 * NEST_HEIGHT
export const NEST_RADIUS = 1.0
const HULL_DEPTH = 4

/** Axis-aligned box in ship-local space, for collisions. */
export interface ShipBox {
  center: THREE.Vector3
  half: THREE.Vector3
}

const CABIN_HALF_WIDTH = 3.5
const CABIN_HEIGHT = 2.6
const WALL = 0.15
const DOOR_HALF_WIDTH = 0.55
const DOOR_HEIGHT = 1.9

/** The inside of the captain's cabin (ship-local), for "the diver is in the cabin" checks. */
export const CABIN_INTERIOR: ShipBox = {
  center: new THREE.Vector3(0, DECK_Y + CABIN_HEIGHT / 2, (CABIN_FRONT_Z + STERN_Z) / 2),
  half: new THREE.Vector3(CABIN_HALF_WIDTH - WALL, CABIN_HEIGHT / 2, (STERN_Z - CABIN_FRONT_Z) / 2 - WALL),
}

const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): ShipBox => ({
  center: new THREE.Vector3(cx, cy, cz),
  half: new THREE.Vector3(hx, hy, hz),
})

/** Collision boxes for a wreck with a hollow cabin: hull sections, cabin walls with a doorway, roof. */
export function wreckColliders(): ShipBox[] {
  const hullY = DECK_Y - 2.15
  const midZ = (CABIN_FRONT_Z + STERN_Z) / 2
  const halfDepth = (STERN_Z - CABIN_FRONT_Z) / 2
  const frontZ = CABIN_FRONT_Z + WALL / 2
  const sideHalf = (CABIN_HALF_WIDTH - DOOR_HALF_WIDTH) / 2
  return [
    box(0, hullY, 8.5, 3.7, 2.15, 4.5),
    box(0, hullY, -1, 3.8, 2.15, 5),
    box(0, hullY, -8.5, 2.8, 2.15, 2.5),
    box(0, hullY, -12.75, 1.3, 2.15, 1.75),
    box(0, DECK_Y + CABIN_HEIGHT / 2, STERN_Z - WALL / 2, CABIN_HALF_WIDTH, CABIN_HEIGHT / 2, WALL / 2),
    box(CABIN_HALF_WIDTH - WALL / 2, DECK_Y + CABIN_HEIGHT / 2, midZ, WALL / 2, CABIN_HEIGHT / 2, halfDepth),
    box(-(CABIN_HALF_WIDTH - WALL / 2), DECK_Y + CABIN_HEIGHT / 2, midZ, WALL / 2, CABIN_HEIGHT / 2, halfDepth),
    box(0, DECK_Y + CABIN_HEIGHT + WALL / 2, midZ, CABIN_HALF_WIDTH + 0.15, WALL / 2, halfDepth + 0.15),
    box(-(DOOR_HALF_WIDTH + sideHalf), DECK_Y + CABIN_HEIGHT / 2, frontZ, sideHalf, CABIN_HEIGHT / 2, WALL / 2),
    box(DOOR_HALF_WIDTH + sideHalf, DECK_Y + CABIN_HEIGHT / 2, frontZ, sideHalf, CABIN_HEIGHT / 2, WALL / 2),
    box(0, DECK_Y + (DOOR_HEIGHT + CABIN_HEIGHT) / 2, frontZ, DOOR_HALF_WIDTH, (CABIN_HEIGHT - DOOR_HEIGHT) / 2, WALL / 2),
  ]
}


/** The deck outline for a ship with `stretch` metres of straight waist added amidships. */
function profileFor(stretch: number): [number, number][] {
  if (stretch <= 0) return STARBOARD
  return [[3.6, 13], [3.8, 4], [3.8, 4 - stretch], ...STARBOARD.slice(2).map(([x, z]): [number, number] => [x, z - stretch])]
}

/** Where the bow is, for a ship stretched by `stretch`. */
export function bowZ(stretch = 0): number {
  return BOW_Z - stretch
}

/** Where the foremast stands (ship-local z), for a ship stretched by `stretch`. */
export function foremastZ(stretch = 0): number {
  return stretch > 0 ? -20 : -8
}

/** Half the deck width at ship-local z (for a ship stretched by `stretch`). */
export function halfWidthAt(z: number, stretch = 0): number {
  const outline = profileFor(stretch)
  if (z >= outline[0][1]) return outline[0][0]
  for (let i = 0; i < outline.length - 1; i++) {
    const [x0, z0] = outline[i]
    const [x1, z1] = outline[i + 1]
    if (z <= z0 && z >= z1) return x0 + ((z - z0) / (z1 - z0)) * (x1 - x0)
  }
  return 0
}

// A pirate galleon built from primitives. `group` carries the whole ship (sinking and tilting are
// applied there); `shake` sits inside it and only jitters visually, so the deck the player stands
// on never shakes their head.
export class Galleon {
  readonly group = new THREE.Group()
  readonly shake = new THREE.Group()
  readonly foremast = new THREE.Group()
  readonly mainmast = new THREE.Group()
  /** Meshes a pellet or cannonball can hit. */
  readonly hitMeshes: THREE.Mesh[] = []
  /** Muzzle points (ship-local) of the starboard and port cannons. */
  readonly starboardGuns: THREE.Vector3[] = []
  readonly portGuns: THREE.Vector3[] = []
  /** Every deck cannon (ship-local): touch hole at the breech, muzzle, and which side it fires to. */
  readonly cannons: { touchHole: THREE.Vector3; muzzle: THREE.Vector3; side: 1 | -1 }[] = []
  private readonly flag: THREE.Mesh
  private readonly flagTextures = new Map<FlagKind, THREE.Texture>()

  /** Extra waist length (see GalleonOptions.stretch). */
  readonly stretch: number

  constructor(options: GalleonOptions = {}) {
    this.group.add(this.shake)
    const stretch = (this.stretch = options.stretch ?? 0)
    const outline = outlinePoints(stretch)
    const wood = new THREE.MeshStandardMaterial({ color: options.hullColor ?? 0x5b3a21, roughness: 0.85, side: THREE.DoubleSide })
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x3b2413, roughness: 0.9 })
    const trim = new THREE.MeshStandardMaterial({ color: 0xc9a13b, roughness: 0.6, metalness: 0.2 })
    const sail = new THREE.MeshStandardMaterial({ color: options.sailColor ?? 0xe8dcc0, roughness: 0.95, side: THREE.DoubleSide })
    const iron = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.5, metalness: 0.6 })

    // Hull, deck, rails, cabin and cannons never move relative to the ship: merged into a few meshes.
    const structure = new THREE.Group()
    const hull = new THREE.Mesh(makeHullGeometry(outline), wood)
    const wale = new THREE.Mesh(makeWaleGeometry(outline), trim)
    const deck = new THREE.Mesh(makeDeckGeometry(outline), new THREE.MeshStandardMaterial({ map: makePlankTexture(), roughness: 0.9 }))
    structure.add(hull, wale, deck, makeRails(darkWood, outline), options.hollowCabin ? makeHollowCabin(wood, darkWood, trim) : makeCabin(wood, darkWood, trim))
    this.shake.add(structure)

    this.buildMast(this.mainmast, 0, 16, 5.5, darkWood, sail)
    this.buildMast(this.foremast, foremastZ(stretch), 13, 4.5, darkWood, sail)
    this.shake.add(this.mainmast, this.foremast)

    // A stretched ship carries more guns along her longer waist.
    for (const z of stretch > 0 ? [-4, 2, 6.5, -12, -28] : [-4, 2, 6.5]) {
      for (const side of [1, -1]) {
        const cannon = makeCannon(iron, darkWood)
        const x = side * (halfWidthAt(z, stretch) - 0.55)
        cannon.position.set(x, DECK_Y, z)
        cannon.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2
        structure.add(cannon)
        const muzzle = new THREE.Vector3(side * (halfWidthAt(z, stretch) + 0.6), DECK_Y + 0.55, z)
        ;(side > 0 ? this.starboardGuns : this.portGuns).push(muzzle)
        // The barrel's breech end is 0.4 m inboard of the carriage centre; the touch hole sits on top.
        this.cannons.push({ touchHole: new THREE.Vector3(x - side * 0.3, DECK_Y + 0.69, z), muzzle: muzzle.clone(), side: side as 1 | -1 })
      }
    }

    this.flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.1, 6, 1).translate(0.9, 0, 0),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1 }),
    )
    this.flag.position.set(0.1, 16.3, 0)
    this.flag.rotation.y = Math.PI / 2
    this.mainmast.add(this.flag)
    this.hitMeshes.push(this.flag)
    this.setFlag(options.flag ?? 'crew')
    this.hitMeshes.push(...mergeStatic(structure))
  }

  /** For ships only ever seen whole (the distant enemy, the wreck): merge everything but the flag. */
  mergeAll(): void {
    this.hitMeshes.length = 0
    this.hitMeshes.push(...mergeStatic(this.shake, [this.flag]), this.flag)
  }

  setFlag(kind: FlagKind): void {
    let texture = this.flagTextures.get(kind)
    if (!texture) {
      texture = makeFlagTexture(kind)
      this.flagTextures.set(kind, texture)
    }
    ;(this.flag.material as THREE.MeshStandardMaterial).map = texture
    ;(this.flag.material as THREE.MeshStandardMaterial).needsUpdate = true
  }

  /** Ripple the flag and sails a little. */
  update(elapsed: number): void {
    const pos = this.flag.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      pos.setZ(i, Math.sin(elapsed * 4 + x * 3) * 0.08 * x)
    }
    pos.needsUpdate = true
  }

  private buildMast(mast: THREE.Group, z: number, height: number, yardWidth: number, wood: THREE.Material, sailMat: THREE.Material): void {
    // Pivot at deck level so a shot-away mast topples from its foot.
    mast.position.set(0, DECK_Y, z)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, height, 10), wood)
    pole.position.y = height / 2
    mast.add(pole)
    this.hitMeshes.push(pole)
    for (const [y, w, h] of [
      // Lowest sail's foot stays well above head height on deck.
      [height * 0.5, yardWidth, height * 0.28],
      [height * 0.85, yardWidth * 0.75, height * 0.2],
    ]) {
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, w + 0.6, 6), wood)
      yard.rotation.z = Math.PI / 2
      yard.position.y = y
      mast.add(yard)
      const sail = new THREE.Mesh(makeSailGeometry(w, h), sailMat)
      sail.position.set(0, y - h / 2 - 0.05, -0.05)
      mast.add(sail)
      this.hitMeshes.push(sail)
    }
    // Crow's nest: a floor and a waist-high rim, above the lower yard and below the upper sail.
    const r = NEST_RADIUS * (height / 16)
    const floorY = height * NEST_HEIGHT
    // Double-sided so the rim's inside shows when you're standing in it.
    const inside = (wood as THREE.MeshStandardMaterial).clone()
    inside.side = THREE.DoubleSide
    const tub = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, 1.0, 16, 1, true), inside)
    tub.position.y = floorY + 0.45
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.9, 0.08, 16), wood)
    floor.position.y = floorY - 0.04
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 20), wood)
    rim.rotation.x = Math.PI / 2
    rim.position.y = floorY + 0.95
    mast.add(tub, floor, rim)
  }
}

function outlinePoints(stretch = 0): THREE.Vector2[] {
  const profile = profileFor(stretch)
  const starboard = profile.map(([x, z]) => new THREE.Vector2(x, z))
  const port = profile.slice(0, -1)
    .reverse()
    .map(([x, z]) => new THREE.Vector2(-x, z))
  return [...starboard, ...port]
}

function makeHullGeometry(outline: THREE.Vector2[]): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: HULL_DEPTH, steps: 4, bevelEnabled: false, curveSegments: 1 })
  // Shape (x, z) → extruded downward from the deck.
  geometry.rotateX(Math.PI / 2)
  const pos = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    // Taper towards the keel so the hull reads as a boat, not a box.
    const depth = -pos.getY(i) / HULL_DEPTH
    pos.setX(i, pos.getX(i) * (1 - 0.45 * depth * depth))
    pos.setZ(i, pos.getZ(i) * (1 - 0.1 * depth))
  }
  geometry.translate(0, DECK_Y + 0.3, 0)
  // Drop the flat top cap: it would sit 30 cm above the deck like a false floor, hiding the planks
  // (and anything lying on them). The sides stay, rising above the deck as a low bulwark.
  const open = withoutTopCap(geometry, DECK_Y + 0.3)
  open.computeVertexNormals()
  return open
}

/** A copy of a (non-indexed) geometry without the triangles lying flat at height `y`. */
function withoutTopCap(geometry: THREE.BufferGeometry, y: number): THREE.BufferGeometry {
  const src = geometry.index ? geometry.toNonIndexed() : geometry
  const pos = src.attributes.position as THREE.BufferAttribute
  const uv = src.attributes.uv as THREE.BufferAttribute | undefined
  const keptPos: number[] = []
  const keptUv: number[] = []
  for (let t = 0; t < pos.count; t += 3) {
    const flatTop = [0, 1, 2].every((k) => Math.abs(pos.getY(t + k) - y) < 1e-4)
    if (flatTop) continue
    for (let k = 0; k < 3; k++) {
      keptPos.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k))
      if (uv) keptUv.push(uv.getX(t + k), uv.getY(t + k))
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(keptPos, 3))
  if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(keptUv, 2))
  return out
}

function makeWaleGeometry(outline: THREE.Vector2[]): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x * 1.03, p.y * 1.01)))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false })
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, DECK_Y - 0.5, 0)
  return geometry
}

function makeDeckGeometry(outline: THREE.Vector2[]): THREE.BufferGeometry {
  // Mirror z so that rotating by -90° puts the shape flat with its face up.
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x * 0.98, -p.y * 0.99)))
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, DECK_Y, 0)
  // Planks run bow to stern: map UVs from deck coordinates.
  const pos = geometry.attributes.position as THREE.BufferAttribute
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4)
  return geometry
}

function makeRails(material: THREE.Material, points: THREE.Vector2[]): THREE.Group {
  const rails = new THREE.Group()
  const post = new THREE.CylinderGeometry(0.05, 0.05, RAIL_HEIGHT, 6)
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    // The stern edge is the cabin's back wall; no rail there.
    if (a.y >= STERN_Z && b.y >= STERN_Z) continue
    const length = a.distanceTo(b)
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, length), material)
    top.position.set((a.x + b.x) / 2, DECK_Y + RAIL_HEIGHT, (a.y + b.y) / 2)
    top.rotation.y = Math.atan2(b.x - a.x, b.y - a.y)
    rails.add(top)
    const steps = Math.max(1, Math.round(length / 1.4))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const p = new THREE.Mesh(post, material)
      p.position.set(a.x + (b.x - a.x) * t, DECK_Y + RAIL_HEIGHT / 2, a.y + (b.y - a.y) * t)
      rails.add(p)
    }
  }
  return rails
}

function makeCabin(wood: THREE.Material, dark: THREE.Material, trim: THREE.Material): THREE.Group {
  const cabin = new THREE.Group()
  const depth = STERN_Z - CABIN_FRONT_Z
  const width = halfWidthAt(STERN_Z) * 2 - 0.2
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, 2.6, depth), wood)
  body.position.set(0, DECK_Y + 1.3, CABIN_FRONT_Z + depth / 2)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.15, depth + 0.3), dark)
  roof.position.set(0, DECK_Y + 2.65, CABIN_FRONT_Z + depth / 2)
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.08), dark)
  door.position.set(0, DECK_Y + 0.95, CABIN_FRONT_Z - 0.02)
  cabin.add(body, roof, door)
  // One window to starboard; the port side of the wall holds the dart board and its slate.
  const window = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.06), trim)
  window.position.set(2.2, DECK_Y + 1.5, CABIN_FRONT_Z - 0.02)
  cabin.add(window)
  return cabin
}

/** The wreck's cabin: walls, roof and an open doorway (the door's long gone). */
function makeHollowCabin(wood: THREE.Material, dark: THREE.Material, trim: THREE.Material): THREE.Group {
  const cabin = new THREE.Group()
  for (const b of wreckColliders().slice(4)) {
    const isRoof = b.center.y > DECK_Y + CABIN_HEIGHT
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.half.x * 2, b.half.y * 2, b.half.z * 2), isRoof ? dark : wood)
    mesh.position.copy(b.center)
    cabin.add(mesh)
  }
  const window = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.06), trim)
  window.position.set(2.2, DECK_Y + 1.5, CABIN_FRONT_Z - 0.02)
  cabin.add(window)
  return cabin
}

function makeCannon(iron: THREE.Material, wood: THREE.Material): THREE.Group {
  const cannon = new THREE.Group()
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.9), wood)
  carriage.position.y = 0.25
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 1.5, 10), iron)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.55, -0.35)
  cannon.add(carriage, barrel)
  return cannon
}

function makeSailGeometry(width: number, height: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, height, 8, 6)
  const pos = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / width + 0.5
    const v = pos.getY(i) / height + 0.5
    // Billow forward, fullest in the middle.
    pos.setZ(i, -Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * width * 0.12)
  }
  geometry.computeVertexNormals()
  return geometry
}

function makePlankTexture(): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const planks = 8
  for (let i = 0; i < planks; i++) {
    const shade = 150 + Math.floor(Math.random() * 30)
    ctx.fillStyle = `rgb(${shade}, ${Math.floor(shade * 0.75)}, ${Math.floor(shade * 0.48)})`
    ctx.fillRect((i * size) / planks, 0, size / planks, size)
    ctx.fillStyle = 'rgba(40, 25, 10, 0.8)'
    ctx.fillRect((i * size) / planks, 0, 3, size)
    // Butt joints at staggered heights.
    ctx.fillRect((i * size) / planks, ((i * 0.37) % 1) * size, size / planks, 3)
  }
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = `rgba(60, 35, 15, ${Math.random() * 0.12})`
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 6 + Math.random() * 30)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function makeFlagTexture(kind: FlagKind): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 160
  const ctx = canvas.getContext('2d')!
  if (kind === 'merchant') {
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? '#f4f1e8' : '#2f5e9e'
      ctx.fillRect(0, i * 32, 256, 32)
    }
  } else if (kind === 'crew') {
    // Our own colours: Sicilian red and gold halves with a black triskelion-ish sun.
    ctx.fillStyle = '#c8322b'
    ctx.fillRect(0, 0, 256, 160)
    ctx.fillStyle = '#e8b930'
    ctx.beginPath()
    ctx.moveTo(256, 0)
    ctx.lineTo(256, 160)
    ctx.lineTo(0, 160)
    ctx.fill()
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath()
    ctx.arc(128, 80, 26, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillStyle = '#0d0d0d'
    ctx.fillRect(0, 0, 256, 160)
    ctx.fillStyle = '#f2efe6'
    ctx.beginPath()
    ctx.arc(128, 66, 28, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(112, 84, 32, 18)
    ctx.fillStyle = '#0d0d0d'
    ctx.beginPath()
    ctx.arc(117, 64, 7, 0, Math.PI * 2)
    ctx.arc(139, 64, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#f2efe6'
    ctx.lineWidth = 12
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(78, 110)
    ctx.lineTo(178, 146)
    ctx.moveTo(178, 110)
    ctx.lineTo(78, 146)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
