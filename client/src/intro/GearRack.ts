import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import type { GrabSystem } from '../interaction/GrabSystem'
import { LooseItem } from '../interaction/LooseItem'
import { DECK_Y, halfWidthAt, type Galleon } from '../world/ship/Galleon'
import { makeMapMesh } from './TreasureMap'

export type GearPiece = 'tank' | 'mask' | 'fins' | 'map'

export interface GearState {
  tank: boolean
  mask: boolean
  fins: boolean
  map: boolean
}

/** Tank clips on if you let go of it this close to your head (over the shoulder, on the back). */
const TANK_CLIP_DISTANCE = 0.75
/** Mask goes on when held this close to the face. */
const MASK_FACE_DISTANCE = 0.22

// The scuba gear rack by the main mast (tank, mask, fins) and the treasure map on the
// captain's table. Tank: grab it and let go over your shoulder. Mask: hold it to your face.
// Fins: grab them. Map: pick it up and it's yours.
export class GearRack {
  readonly state: GearState = { tank: false, mask: false, fins: false, map: false }
  onChange: (piece: GearPiece) => void = () => {}
  private readonly items = new Map<GearPiece, LooseItem>()
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
    const z = 1.6
    rack.position.set(-(halfWidthAt(z) - 0.45), DECK_Y, z)
    rack.rotation.y = Math.PI / 2
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.85 })
    for (const x of [-0.8, 0.8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.7, 0.08), wood)
      post.position.set(x, 0.85, 0)
      rack.add(post)
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.08), wood)
    bar.position.y = 1.55
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.4), wood)
    shelf.position.set(0, 0.55, 0.12)
    rack.add(bar, shelf)
    const sign = makeSign('SCUBA')
    sign.position.set(0, 1.72, 0.05)
    rack.add(sign)
    ship.shake.add(rack)

    const tank = makeTank()
    tank.position.set(-0.45, 1.0, 0.12)
    const mask = makeMask()
    mask.position.set(0.15, 1.35, 0.1)
    const fins = makeFins()
    fins.position.set(0.55, 0.62, 0.15)
    rack.add(tank, mask, fins)

    const table = makeTable()
    const tz = 7.2
    table.position.set(-1.4, DECK_Y, tz)
    ship.shake.add(table)
    const map = makeMapMesh()
    map.rotation.x = -Math.PI / 2
    map.position.set(0, 0.93, 0)
    table.add(map)

    const add = (piece: GearPiece, object: THREE.Object3D, item: LooseItem) => {
      this.items.set(piece, item)
      grab.add(item)
      object.userData.piece = piece
    }
    add('tank', tank, new LooseItem(tank, {
      radius: 0.22,
      settle: 'home',
      onRelease: () => this.near(this.hand, TANK_CLIP_DISTANCE) && this.equip('tank'),
    }))
    add('mask', mask, new LooseItem(mask, {
      radius: 0.12,
      settle: 'home',
      // A desktop player can't lift a mask to their face, so it goes straight on.
      onGrab: (hand) => (hand.virtual ? this.equip('mask') : false),
      whileHeld: (hand) => {
        if (this.near(hand.worldPos(this.hand), MASK_FACE_DISTANCE)) {
          this.dropFromHand(hand)
          this.equip('mask')
        }
      },
    }))
    add('fins', fins, new LooseItem(fins, { radius: 0.2, settle: 'home', onGrab: () => this.equip('fins') }))
    add('map', map, new LooseItem(map, { radius: 0.25, settle: 'home', onGrab: () => this.equip('map') }))
  }

  get complete(): boolean {
    return this.state.tank && this.state.mask && this.state.fins
  }

  /** Put on anything still missing (washed overboard before finishing). */
  equipAll(): void {
    for (const piece of ['tank', 'mask', 'fins', 'map'] as const) if (!this.state[piece]) this.equip(piece)
  }

  update(): void {
    // Track the releasing hand's position for the tank's clip-on check.
    const item = this.items.get('tank')!
    if (item.heldBy) item.heldBy.worldPos(this.hand)
  }

  private near(point: THREE.Vector3, distance: number): boolean {
    return point.distanceTo(this.camera.getWorldPosition(this.head)) < distance
  }

  private equip(piece: GearPiece): true {
    if (this.state[piece]) return true
    this.state[piece] = true
    const item = this.items.get(piece)!
    item.goHome()
    item.enabled = false
    item.object.visible = false
    this.audio.play(piece === 'map' ? 'pop' : 'click')
    this.onChange(piece)
    return true
  }
}

function makeTank(): THREE.Group {
  const group = new THREE.Group()
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe8c547, roughness: 0.4 })
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.3, metalness: 0.6 })
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 16), yellow)
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.08, 8), steel)
  valve.position.y = 0.34
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), new THREE.MeshStandardMaterial({ color: 0x1d1d1d }))
  strap.position.y = 0.1
  group.add(body, valve, strap)
  return group
}

function makeMask(): THREE.Group {
  const group = new THREE.Group()
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.7 })
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 20), rubber)
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

function makeFins(): THREE.Group {
  const group = new THREE.Group()
  const blue = new THREE.MeshStandardMaterial({ color: 0x1f5fb0, roughness: 0.6 })
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

function makeSign(text: string): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#e8dcc0'
  ctx.fillRect(0, 0, 256, 64)
  ctx.fillStyle = '#3b2413'
  ctx.font = 'bold 40px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText(text, 128, 46)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), new THREE.MeshStandardMaterial({ map: texture }))
}
