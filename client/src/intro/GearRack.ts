import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import type { GrabSystem } from '../interaction/GrabSystem'
import { LooseItem } from '../interaction/LooseItem'
import { DECK_Y, type Galleon } from '../world/ship/Galleon'
import { makeMapMesh } from './TreasureMap'
import { deckHalfWidth } from './deck'
import { CLASS_NAMES, type CharacterClass } from '../systems/crew'

/** The scuba rack stands against the port rail forward of the main mast (ship-local z, its middle). */
export const GEAR_Z = -8
/** It's this long (along the rail): four sets side by side. */
const RACK_LENGTH = 3.5
/** Where each set hangs along the rack (rack-local x). */
const SET_X = [-1.275, -0.425, 0.425, 1.275]

/** One scuba set per class, in its colour. */
export const GEAR_SETS: { cls: CharacterClass; color: number; css: string }[] = [
  { cls: 'navigator', color: 0x2f7fd8, css: '#2f7fd8' },
  { cls: 'strongman', color: 0xd8412f, css: '#d8412f' },
  { cls: 'deepDiver', color: 0xe8c547, css: '#c9a21c' },
  { cls: 'fishWhisperer', color: 0x3cb371, css: '#2e9a5c' },
]

/** Walkers keep off the rack (ship-local circles along it). */
export function gearObstacles(): { x: number; z: number; r: number }[] {
  const x = -(deckHalfWidth(GEAR_Z) - 0.45)
  return [-1.3, -0.45, 0.45, 1.3].map((dz) => ({ x, z: GEAR_Z + dz, r: 0.5 }))
}

export type GearPiece = 'tank' | 'mask' | 'fins' | 'map'

export interface GearState {
  tank: boolean
  mask: boolean
  fins: boolean
  map: boolean
}

/** The captain's table with the map, ship-local (forward of the dart lane). */
export const TABLE_POSITION = new THREE.Vector3(-1.5, DECK_Y, 4.2)

/** Tank clips on if you let go of it this close to your head (over the shoulder, on the back). */
const TANK_CLIP_DISTANCE = 0.75
/** Mask goes on when held this close to the face. */
const MASK_FACE_DISTANCE = 0.22

// The scuba gear rack forward of the main mast: four sets (tank, mask, fins), one per class, each in
// its class's colour with the class named on a plaque above it. And the treasure map on the
// captain's table. Tank: grab it and let go over your shoulder. Mask: hold it to your face. Fins: grab
// them. Map: pick it up and it's yours. A piece someone takes is gone from the rack for everyone.
export class GearRack {
  /** A piece of set `set` was put on here: tell the crew. */
  onTaken: (set: number, piece: GearPiece) => void = () => {}
  /** Whose set to reach for when putting on whatever's missing (your class's). */
  preferredSet = 0
  readonly state: GearState = { tank: false, mask: false, fins: false, map: false }
  onChange: (piece: GearPiece) => void = () => {}
  /** Someone reached for scuba gear before the ship came under fire. */
  onLocked: (hand: Hand) => void = () => {}
  /** Scuba gear stays chained to the rack until the other ship is fired on. */
  private locked = true
  private readonly chain = new THREE.Group()
  /** "set/piece" → the item on the rack (the map is just "map"). */
  private readonly items = new Map<string, LooseItem>()
  private heldTank: LooseItem | null = null
  private readonly head = new THREE.Vector3()
  private readonly hand = new THREE.Vector3()

  constructor(
    ship: Galleon,
    grab: GrabSystem,
    private readonly camera: THREE.Camera,
    private readonly audio: AudioSystem,
    private readonly dropFromHand: (hand: Hand) => void,
  ) {
    const rack = new THREE.Group()
    const z = GEAR_Z
    rack.position.set(-(deckHalfWidth(z) - 0.45), DECK_Y, z)
    rack.rotation.y = Math.PI / 2
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.85 })
    for (const x of [-RACK_LENGTH / 2, 0, RACK_LENGTH / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.7, 0.08), wood)
      post.position.set(x, 0.85, 0)
      rack.add(post)
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(RACK_LENGTH + 0.1, 0.08, 0.08), wood)
    bar.position.y = 1.55
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(RACK_LENGTH + 0.1, 0.05, 0.4), wood)
    shelf.position.set(0, 0.55, 0.12)
    rack.add(bar, shelf)
    const sign = makeSign('SCUBA', '#3b2413')
    sign.position.set(0, 1.9, 0.05)
    rack.add(sign)
    ship.shake.add(rack)

    const refuse = (hand: Hand, piece: GearPiece) => {
      if (this.locked) {
        this.onLocked(hand)
        this.audio.play('click', undefined, 0.4)
        return true
      }
      // One of each: you already have this piece on.
      if (this.state[piece]) {
        this.audio.play('click', undefined, 0.3)
        return true
      }
      return false
    }
    GEAR_SETS.forEach((set, k) => {
      const x = SET_X[k]
      // The class's name on a plaque in its colour, over its set.
      const plaque = makeSign(CLASS_NAMES[set.cls], set.css)
      plaque.scale.setScalar(0.95)
      plaque.position.set(x, 1.72, 0.05)
      rack.add(plaque)
      const tank = makeTank(set.color)
      tank.position.set(x - 0.22, 1.0, 0.12)
      const mask = makeMask(set.color)
      mask.position.set(x + 0.18, 1.35, 0.1)
      const fins = makeFins(set.color)
      fins.position.set(x + 0.12, 0.62, 0.15)
      rack.add(tank, mask, fins)
      const tankItem: LooseItem = new LooseItem(tank, {
        radius: 0.22,
        settle: 'home',
        onGrab: (hand) => {
          if (refuse(hand, 'tank')) return true
          this.heldTank = tankItem
          return false
        },
        onRelease: () => {
          this.heldTank = null
          return this.near(this.hand, TANK_CLIP_DISTANCE) && this.equip('tank', k)
        },
      })
      const maskItem = new LooseItem(mask, {
        radius: 0.12,
        settle: 'home',
        // A desktop player can't lift a mask to their face, so it goes straight on.
        onGrab: (hand) => refuse(hand, 'mask') || (hand.virtual ? this.equip('mask', k) : false),
        whileHeld: (hand) => {
          if (this.near(hand.worldPos(this.hand), MASK_FACE_DISTANCE)) {
            this.dropFromHand(hand)
            this.equip('mask', k)
          }
        },
      })
      const finsItem = new LooseItem(fins, { radius: 0.2, settle: 'home', onGrab: (hand) => refuse(hand, 'fins') || this.equip('fins', k) })
      for (const [piece, item] of [['tank', tankItem], ['mask', maskItem], ['fins', finsItem]] as const) {
        this.items.set(`${k}/${piece}`, item)
        grab.add(item)
        item.object.userData.piece = piece
      }
    })
    // A chain across the whole rack with a padlock: nobody needs scuba gear on a nice day.
    const iron = new THREE.MeshStandardMaterial({ color: 0x3d3f44, roughness: 0.5, metalness: 0.7 })
    const links = Math.round(RACK_LENGTH / 0.1)
    for (let i = 0; i <= links; i++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 5, 10), iron)
      link.position.set(-RACK_LENGTH / 2 + i * 0.1, 1.08 - Math.sin((i / links) * Math.PI) * 0.12, 0.3)
      link.rotation.y = i % 2 ? Math.PI / 2 : 0
      link.rotation.z = Math.PI / 2
      this.chain.add(link)
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.04), new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.4, metalness: 0.8 }))
    lock.position.set(0, 0.88, 0.32)
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 12, Math.PI), iron)
    shackle.position.set(0, 0.925, 0.32)
    this.chain.add(lock, shackle)
    rack.add(this.chain)

    const table = makeTable()
    table.position.copy(TABLE_POSITION)
    ship.shake.add(table)
    const map = makeMapMesh()
    map.rotation.x = -Math.PI / 2
    map.position.set(0, 0.93, 0)
    table.add(map)

    const mapItem = new LooseItem(map, { radius: 0.25, settle: 'home', onGrab: () => this.equip('map', -1) })
    this.items.set('map', mapItem)
    grab.add(mapItem)
    map.userData.piece = 'map'
  }

  /** A crewmate put on this piece: it's gone from the rack here too. */
  takenElsewhere(set: number, piece: GearPiece): void {
    const item = this.items.get(`${set}/${piece}`)
    if (!item) return
    if (item.heldBy) item.heldBy.held = null
    item.goHome()
    item.enabled = false
    item.object.visible = false
  }

  get isLocked(): boolean {
    return this.locked
  }

  /** The other ship's been fired on: the chain comes off. */
  unlock(): void {
    if (!this.locked) return
    this.locked = false
    this.chain.visible = false
    this.audio.play('click')
  }

  get complete(): boolean {
    return this.state.tank && this.state.mask && this.state.fins
  }

  /** Put on anything still missing (washed overboard before finishing): your class's set first. */
  equipAll(): void {
    this.unlock()
    for (const piece of ['tank', 'mask', 'fins'] as const) {
      if (this.state[piece]) continue
      const order = [this.preferredSet, 0, 1, 2, 3]
      const set = order.find((k) => this.items.get(`${k}/${piece}`)?.enabled) ?? this.preferredSet
      this.equip(piece, set)
    }
    if (!this.state.map) this.equip('map', -1)
  }

  update(): void {
    // Track the releasing hand's position for the tank's clip-on check.
    const hand = this.heldTank?.heldBy
    if (hand) hand.worldPos(this.hand)
  }

  private near(point: THREE.Vector3, distance: number): boolean {
    return point.distanceTo(this.camera.getWorldPosition(this.head)) < distance
  }

  /** Put on a piece from set `set` (-1: the map). */
  private equip(piece: GearPiece, set: number): true {
    if (this.state[piece]) return true
    this.state[piece] = true
    const item = this.items.get(piece === 'map' ? 'map' : `${set}/${piece}`)
    if (item) {
      item.goHome()
      item.enabled = false
      item.object.visible = false
    }
    this.audio.play(piece === 'map' ? 'pop' : 'click')
    if (piece !== 'map') this.onTaken(set, piece)
    this.onChange(piece)
    return true
  }
}

function makeTank(color: number): THREE.Group {
  const group = new THREE.Group()
  const yellow = new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.3, metalness: 0.6 })
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 16), yellow)
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.08, 8), steel)
  valve.position.y = 0.34
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), new THREE.MeshStandardMaterial({ color: 0x1d1d1d }))
  strap.position.y = 0.1
  group.add(body, valve, strap)
  return group
}

function makeMask(color: number): THREE.Group {
  const group = new THREE.Group()
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.7 })
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 20), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }))
  frame.scale.set(1.35, 0.8, 1)
  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(0.075, 20),
    new THREE.MeshStandardMaterial({ color: 0x9fd8ee, roughness: 0.05, transparent: true, opacity: 0.45 }),
  )
  glass.scale.set(1.35, 0.8, 1)
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 4, 16, Math.PI), rubber)
  strap.rotation.x = Math.PI / 2
  strap.position.z = 0.03
  group.add(frame, glass, strap)
  return group
}

function makeFins(color: number): THREE.Group {
  const group = new THREE.Group()
  const blue = new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
  for (const x of [-0.07, 0.07]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.42), blue)
    fin.position.set(x, 0, 0)
    fin.rotation.x = 0.1
    group.add(fin)
  }
  return group
}

function makeTable(): THREE.Group {
  const table = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.8 })
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.8), wood)
  top.position.y = 0.9
  table.add(top)
  for (const [x, z] of [[-0.5, -0.32], [0.5, -0.32], [-0.5, 0.32], [0.5, 0.32]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.88, 0.06), wood)
    leg.position.set(x, 0.44, z)
    table.add(leg)
  }
  return table
}

function makeSign(text: string, color: string): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#e8dcc0'
  ctx.fillRect(0, 0, 256, 64)
  ctx.fillStyle = color
  ctx.font = 'bold 40px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText(text, 128, 46, 236)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), new THREE.MeshStandardMaterial({ map: texture }))
}
