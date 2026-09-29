import * as THREE from 'three'
import { applyCaustics, applySurfaceShimmer } from '../world/caustics'
import { SURFACE_Y } from '../world/SeabedScene'
import { makeAmphora } from '../level2/Reef'

/** The vault's floor of gold (world y), a little above the lagoon's water. */
export const FLOOR_Y = SURFACE_Y + 0.8
/** The cavern: a great dome of rock. */
export const CAVERN = { center: new THREE.Vector3(0, FLOOR_Y + 4, -4), half: new THREE.Vector3(30, 18, 28) }
/** The lagoon in the middle of the floor, fed by the waterfall at its north end. */
export const LAGOON = { x: 0, z: -12, rx: 10, rz: 8, depth: 5 }
/** The dais at the south end, with the great chest on it. */
export const DAIS = { x0: -3, x1: 3, z0: 5, z1: 9.5, height: 0.6 }
export const CHEST_AT = new THREE.Vector3(0, FLOOR_Y + DAIS.height, 7.4)
/** Where the waterfall comes down into the lagoon. */
export const FALLS = { x: 0, z: -19.2, top: FLOOR_Y + 12.5, width: 3.2 }

/** Heaps of coins on the floor: centre, spread and height. */
const MOUNDS: [number, number, number, number][] = [
  [-18, -10, 6, 2.6], [18, -12, 7, 2.2], [-20, 10, 7, 2.8], [20, 8, 6, 2.4], [-10, 17, 5, 1.6], [11, 18, 5, 1.8],
  [-25, -1, 4, 1.4], [25, -2, 4, 1.4], [-12, -25, 5, 2], [12, -25, 5, 2.1], [-6, 23, 4, 1.1], [6, 24, 4, 1.2],
]

/** How far into the lagoon a point is: < 1 inside its ellipse. */
export function lagoonR(x: number, z: number): number {
  return Math.hypot((x - LAGOON.x) / LAGOON.rx, (z - LAGOON.z) / LAGOON.rz)
}

/** Height of the gold heaps above the floor. */
export function moundHeight(x: number, z: number): number {
  let h = 0
  for (const [mx, mz, r, height] of MOUNDS) {
    const d2 = ((x - mx) ** 2 + (z - mz) ** 2) / (r * r)
    h += height * Math.exp(-d2 * 1.6)
  }
  // Heaps never spill into the lagoon or over the path to the dais.
  const clear = THREE.MathUtils.smoothstep(lagoonR(x, z), 1.1, 1.6)
  const path = THREE.MathUtils.smoothstep(Math.abs(x), 3, 7) + THREE.MathUtils.smoothstep(Math.abs(z - 2), 8, 10)
  return h * clear * Math.min(1, path)
}

/** The floor (gold, heaps and the lagoon's bowl) under a point. */
export function vaultFloor(x: number, z: number): number {
  const r = lagoonR(x, z)
  const bowl = SURFACE_Y - LAGOON.depth * (1 - Math.min(1, r) ** 2)
  const land = FLOOR_Y + moundHeight(x, z) + (onDais(x, z) ? DAIS.height : 0)
  // A steep bank at the lagoon's edge.
  const t = THREE.MathUtils.smoothstep(r, 0.88, 1.0)
  return THREE.MathUtils.lerp(bowl, land, t)
}

export function onDais(x: number, z: number): boolean {
  return x > DAIS.x0 && x < DAIS.x1 && z > DAIS.z0 && z < DAIS.z1
}

/** Keep a walker's head inside the cavern (horizontally, with a margin). */
export function constrainInCavern(head: THREE.Vector3, margin = 1.5): void {
  const c = CAVERN.center
  const ax = CAVERN.half.x * 0.96 - margin
  const az = CAVERN.half.z * 0.96 - margin
  const u = (head.x - c.x) / ax
  const w = (head.z - c.z) / az
  const r = Math.hypot(u, w)
  if (r > 1) {
    head.x = c.x + (u / r) * ax
    head.z = c.z + (w / r) * az
  }
}

/** Keep a swimmer's head in the lagoon (it may poke out of the water to breathe). */
export function containInLagoon(head: THREE.Vector3, clearance: number, push: THREE.Vector3): void {
  const rx = LAGOON.rx * 0.97 - clearance
  const rz = LAGOON.rz * 0.97 - clearance
  const u = (head.x - LAGOON.x) / rx
  const w = (head.z - LAGOON.z) / rz
  const r = Math.hypot(u, w)
  if (r > 1) push.add(new THREE.Vector3(LAGOON.x + (u / r) * rx - head.x, 0, LAGOON.z + (w / r) * rz - head.z))
}

// ---- Looks ------------------------------------------------------------------------------------

/** Layer on layer of coins, for the floor and the heaps. */
function coinTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#8a6414'
  ctx.fillRect(0, 0, 512, 512)
  let seed = 3
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 900; i++) {
    const x = rand() * 512
    const y = rand() * 512
    const r = 9 + rand() * 9
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r)
    const tone = rand()
    g.addColorStop(0, tone > 0.5 ? '#fff0a8' : '#ffe07a')
    g.addColorStop(0.7, tone > 0.5 ? '#e0b030' : '#c9941c')
    g.addColorStop(1, '#7a5410')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * (0.55 + rand() * 0.45), rand() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(18, 18)
  return texture
}

export const gold = (color = 0xffd35a) => new THREE.MeshStandardMaterial({ color, metalness: 0.95, roughness: 0.28, emissive: 0x3a2500, emissiveIntensity: 0.6 })

export interface CavernParts {
  waterfall: THREE.Mesh
  foam: THREE.Mesh
  lagoonWater: THREE.Mesh
  torches: { flame: THREE.Sprite; light: THREE.PointLight }[]
  shafts: THREE.Mesh[]
}

/** Build the whole room: dome, floor of gold, heaps, lagoon, waterfall, columns, torches, treasures. */
export function buildCavern(root: THREE.Object3D): CavernParts {
  // The dome: rough rock, warmed by the gold and flickering with light off the lagoon.
  const rock = new THREE.MeshStandardMaterial({ color: 0x5c4a38, roughness: 0.95, flatShading: true, side: THREE.BackSide, emissive: 0x1a0f04 })
  applyCaustics(rock, 0.22, { facing: 'down', tint: [1.0, 0.8, 0.45] })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 36), rock)
  dome.scale.copy(CAVERN.half)
  dome.position.copy(CAVERN.center)
  root.add(dome)

  // Floor of gold coins with heaps, the lagoon's bowl dropping away in the middle.
  const size = 64
  const floorGeo = new THREE.PlaneGeometry(size, size, 128, 128).rotateX(-Math.PI / 2)
  const pos = floorGeo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i) - 4
    pos.setZ(i, z)
    pos.setY(i, vaultFloor(x, z))
  }
  floorGeo.computeVertexNormals()
  const coinMat = new THREE.MeshStandardMaterial({ map: coinTexture(), metalness: 0.85, roughness: 0.35, emissive: 0x2a1a00, emissiveIntensity: 0.8 })
  root.add(new THREE.Mesh(floorGeo, coinMat))

  // Loose coins glinting on top of it all (one draw call).
  const coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 12), gold(), 2600)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const s = new THREE.Vector3(1, 1, 1)
  const p = new THREE.Vector3()
  let seed = 11
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  let n = 0
  for (let tries = 0; tries < 8000 && n < 2600; tries++) {
    const x = (rand() - 0.5) * 56
    const z = (rand() - 0.5) * 52 - 4
    if (lagoonR(x, z) < 1.05 || !insideFootprint(x, z, 2)) continue
    // More of them on the heaps.
    if (moundHeight(x, z) < 0.2 && rand() < 0.55) continue
    q.setFromEuler(e.set((rand() - 0.5) * 0.9, rand() * 6.3, (rand() - 0.5) * 0.9))
    coins.setMatrixAt(n++, m.compose(p.set(x, vaultFloor(x, z) + 0.01, z), q, s))
  }
  coins.count = n
  root.add(coins)

  // Gem crystals among the gold: ruby, emerald, sapphire, amethyst.
  const gems = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.09, 0), new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0.1 }), 160)
  const palette = [0xe0284a, 0x2ad46a, 0x2f7dff, 0xa24bf0, 0xfff2c0]
  const color = new THREE.Color()
  let g = 0
  for (let tries = 0; tries < 3000 && g < 160; tries++) {
    const x = (rand() - 0.5) * 56
    const z = (rand() - 0.5) * 52 - 4
    if (moundHeight(x, z) < 0.4 || !insideFootprint(x, z, 2)) continue
    q.setFromEuler(e.set(rand(), rand() * 6, rand()))
    const k = 0.7 + rand() * 1.2
    gems.setMatrixAt(g, m.compose(p.set(x, vaultFloor(x, z) + 0.05, z), q, s.set(k, k * 1.3, k)))
    gems.setColorAt(g++, color.setHex(palette[Math.floor(rand() * palette.length)]))
  }
  gems.count = g
  root.add(gems)
  s.set(1, 1, 1)

  // The lagoon: clear water glowing turquoise and gold.
  const waterMat = new THREE.MeshBasicMaterial({ color: 0x3fb8b0, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false })
  applySurfaceShimmer(waterMat)
  const lagoonWater = new THREE.Mesh(new THREE.CircleGeometry(1, 64), waterMat)
  lagoonWater.rotation.x = -Math.PI / 2
  lagoonWater.scale.set(LAGOON.rx, LAGOON.rz, 1)
  lagoonWater.position.set(LAGOON.x, SURFACE_Y, LAGOON.z)
  lagoonWater.renderOrder = 5
  root.add(lagoonWater)

  // The waterfall: pouring off a rock ledge high on the north wall into the lagoon.
  const ledge = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x5c4a38, roughness: 1, flatShading: true }))
  ledge.scale.set(4, 1.4, 5)
  ledge.position.set(FALLS.x, FALLS.top + 0.6, FALLS.z - 4.2)
  root.add(ledge)
  const fallTex = waterfallTexture()
  const waterfall = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4, FALLS.top - SURFACE_Y, 24, 1, true, -FALLS.width / 8, FALLS.width / 4),
    new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, color: 0xd8f6ff }),
  )
  waterfall.position.set(FALLS.x, (FALLS.top + SURFACE_Y) / 2, FALLS.z - 4)
  root.add(waterfall)
  const foam = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }))
  foam.rotation.x = -Math.PI / 2
  foam.position.set(FALLS.x, SURFACE_Y + 0.02, FALLS.z)
  foam.renderOrder = 6
  root.add(foam)

  // Marble columns round the walls with gilded capitals; torches on four of them.
  const marble = new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 0.45 })
  const torches: CavernParts['torches'] = []
  const flameTex = flameTexture()
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.26
    const x = CAVERN.center.x + Math.cos(a) * CAVERN.half.x * 0.8
    const z = CAVERN.center.z + Math.sin(a) * CAVERN.half.z * 0.8
    if (lagoonR(x, z) < 1.4) continue
    const base = vaultFloor(x, z)
    const column = new THREE.Group()
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 9, 20), marble)
    shaft.position.y = 4.5
    const capital = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), gold())
    capital.position.y = 9.2
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 1.5), gold(0xe0b040))
    plinth.position.y = 0.2
    column.add(shaft, capital, plinth)
    column.position.set(x, base - 0.1, z)
    root.add(column)
    if (i % 3 === 0) {
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: 0xffb45a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
      flame.scale.set(0.7, 1.1, 1)
      const toCentre = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)).multiplyScalar(0.8)
      flame.position.set(x + toCentre.x, base + 3.6, z + toCentre.z)
      const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.06, 0.4, 8), gold(0xb08a3a))
      bracket.position.copy(flame.position).add(new THREE.Vector3(0, -0.45, 0))
      const light = new THREE.PointLight(0xffa850, 30, 26, 1.3)
      light.position.copy(flame.position)
      root.add(flame, bracket, light)
      torches.push({ flame, light })
    }
  }

  // Open chests half buried in the heaps, spilling gold and gems.
  for (const [x, z, yaw] of [[-17, -8, 0.6], [19, -10, -0.8], [-19, 12, 2.4], [21, 6, -2.2], [-9, 16, 1.2], [12, 17, -0.4], [-11, -23, 0.2], [13, -24, -0.3]] as const) {
    const chest = makeOpenChest()
    chest.position.set(x, vaultFloor(x, z) - 0.25, z)
    chest.rotation.set(0.12, yaw, -0.08)
    root.add(chest)
  }

  // Golden amphorae and goblets either side of the dais, crowns on pedestals.
  for (const side of [-1, 1]) {
    const amphora = makeAmphora()
    amphora.scale.setScalar(2.4)
    amphora.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = gold(0xf0c040)
    })
    amphora.position.set(side * 4.6, FLOOR_Y + 0.1, 8.5)
    root.add(amphora)
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.1, 12), marble)
    pedestal.position.set(side * 4.2, FLOOR_Y + 0.55, 4.8)
    const crown = makeCrown()
    crown.position.set(side * 4.2, FLOOR_Y + 1.12, 4.8)
    root.add(pedestal, crown)
    for (let k = 0; k < 3; k++) {
      const goblet = makeGoblet()
      goblet.position.set(side * (2.4 + k * 0.5), FLOOR_Y + DAIS.height, 9 + (k % 2) * 0.2)
      if (onDais(goblet.position.x, goblet.position.z)) root.add(goblet)
    }
  }

  // The dais: marble steps with a gold rim.
  const dais = new THREE.Mesh(new THREE.BoxGeometry(DAIS.x1 - DAIS.x0, DAIS.height + 0.4, DAIS.z1 - DAIS.z0), marble)
  dais.position.set((DAIS.x0 + DAIS.x1) / 2, FLOOR_Y + (DAIS.height - 0.4) / 2, (DAIS.z0 + DAIS.z1) / 2)
  const rim = new THREE.Mesh(new THREE.BoxGeometry(DAIS.x1 - DAIS.x0 + 0.1, 0.08, DAIS.z1 - DAIS.z0 + 0.1), gold())
  rim.position.set(dais.position.x, FLOOR_Y + DAIS.height + 0.01, dais.position.z)
  root.add(dais, rim)

  // Shafts of daylight slanting down through cracks in the dome.
  const shafts: THREE.Mesh[] = []
  for (const [x, z, tilt] of [[-12, 4, 0.25], [14, -4, -0.2], [0, 14, 0.1]] as const) {
    const length = 26
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 2.4, length, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    )
    shaft.position.set(x, FLOOR_Y + length / 2 - 1, z)
    shaft.rotation.z = tilt
    root.add(shaft)
    shafts.push(shaft)
  }

  // Warm fill light: the gold seems to glow by itself.
  root.add(new THREE.HemisphereLight(0xffe2a8, 0x3a2408, 1.1))
  const sun = new THREE.DirectionalLight(0xfff0c8, 0.9)
  sun.position.set(-4, 20, 6)
  root.add(sun)
  const lagoonGlow = new THREE.PointLight(0x5fe0d0, 25, 22, 1.4)
  lagoonGlow.position.set(LAGOON.x, SURFACE_Y - 1.5, LAGOON.z)
  root.add(lagoonGlow)

  return { waterfall, foam, lagoonWater, torches, shafts }
}

/** Inside the cavern's floor footprint (with a margin)? */
export function insideFootprint(x: number, z: number, margin = 0): boolean {
  const u = (x - CAVERN.center.x) / (CAVERN.half.x * 0.96 - margin)
  const w = (z - CAVERN.center.z) / (CAVERN.half.z * 0.96 - margin)
  return u * u + w * w < 1
}

function makeOpenChest(): THREE.Group {
  const chest = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3418, roughness: 0.8 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), wood)
  body.position.y = 0.3
  const band = gold(0xc8a040)
  for (const x of [-0.4, 0.4]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.72), band)
    strap.position.set(x, 0.3, 0)
    chest.add(strap)
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.1, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), wood)
  lid.position.set(0, 0.6, -0.35)
  lid.rotation.x = -1.9
  const heap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold())
  heap.scale.set(1, 0.5, 0.65)
  heap.position.y = 0.55
  chest.add(body, lid, heap)
  for (let i = 0; i < 4; i++) {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: [0xe0284a, 0x2ad46a, 0x2f7dff, 0xa24bf0][i], emissive: [0xe0284a, 0x2ad46a, 0x2f7dff, 0xa24bf0][i], emissiveIntensity: 0.4 }))
    gem.position.set(-0.3 + i * 0.2, 0.75, (i % 2) * 0.12 - 0.06)
    chest.add(gem)
  }
  return chest
}

function makeCrown(): THREE.Group {
  const crown = new THREE.Group()
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.15, 0.1, 20, 1, true), gold())
  crown.add(band)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 5), gold())
    point.position.set(Math.cos(a) * 0.155, 0.1, Math.sin(a) * 0.155)
    const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xe0284a : 0x2f7dff, emissive: i % 2 ? 0x600010 : 0x001860 }))
    jewel.position.set(Math.cos(a) * 0.16, 0.02, Math.sin(a) * 0.16)
    crown.add(point, jewel)
  }
  crown.position.y = 0.05
  return crown
}

function makeGoblet(): THREE.Mesh {
  const profile = [[0.0, 0], [0.09, 0], [0.09, 0.015], [0.02, 0.03], [0.018, 0.14], [0.06, 0.16], [0.08, 0.26], [0.075, 0.27]].map(([x, y]) => new THREE.Vector2(x, y))
  return new THREE.Mesh(new THREE.LatheGeometry(profile, 16), gold(0xf5cf55))
}

/** Streaks of falling water, scrolled downward every frame. */
function waterfallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(200, 240, 255, 0.35)'
  ctx.fillRect(0, 0, 128, 256)
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 160; i++) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + rand() * 0.6})`
    ctx.lineWidth = 1 + rand() * 3
    const x = rand() * 128
    const y = rand() * 256
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rand() - 0.5) * 3, y + 30 + rand() * 60)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(2, 3)
  return texture
}

function flameTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(32, 90, 2, 32, 80, 60)
  g.addColorStop(0, 'rgba(255,255,220,1)')
  g.addColorStop(0.3, 'rgba(255,190,80,0.9)')
  g.addColorStop(1, 'rgba(255,90,0,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(32, 80, 22, 46, 0, 0, Math.PI * 2)
  ctx.fill()
  return new THREE.CanvasTexture(canvas)
}
