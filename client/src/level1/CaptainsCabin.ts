import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'
import { makeItem } from '../systems/items'
import { CABIN_FRONT_Z, DECK_Y, STERN_Z } from '../world/ship/Galleon'

const LIFT_SECONDS = 1.4
const LID_SECONDS = 1.2

/** Ship-local spots inside the wreck's cabin. */
export const CABIN = {
  bunk: new THREE.Vector3(-2.35, DECK_Y, 12.2),
  figurehead: new THREE.Vector3(-2.2, DECK_Y + 0.18, 10.75),
  chest: new THREE.Vector3(2.3, DECK_Y, 12.45),
  table: new THREE.Vector3(0.9, DECK_Y, 11.6),
}

// The inside of the wreck's captain's cabin: a bunk ("where the captain slept"), the ship's old stone
// figurehead fallen beside it ("the one who never wept") with the key hidden underneath, and the
// captain's locked chest holding map piece II.
export class CaptainsCabin {
  readonly figurehead = new THREE.Group()
  /** The key's model; the stage wraps it as a grabbable item once revealed. */
  readonly key: THREE.Group
  readonly mapPiece: THREE.Group
  readonly chestCoins: THREE.Group[] = []
  readonly lock = new THREE.Object3D()
  lifted = false
  unlocked = false
  /** Someone already took the key: never reveal it again. */
  keyTaken = false
  private keyRevealed = false
  private liftT = -1
  private lidT = -1
  private hoard!: THREE.Group
  private glow!: THREE.PointLight
  private readonly lid = new THREE.Group()
  private readonly figureheadStart = new THREE.Vector3()

  constructor(
    parent: THREE.Object3D,
    private readonly audio: AudioSystem,
  ) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.85 })
    const rotten = new THREE.MeshStandardMaterial({ color: 0x3e2a18, roughness: 0.95 })
    const cloth = new THREE.MeshStandardMaterial({ color: 0x6d7a5a, roughness: 1 })
    const stone = new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.95, flatShading: true })
    const brass = new THREE.MeshStandardMaterial({ color: 0xc59a3c, roughness: 0.35, metalness: 0.7 })

    // Bunk against the port wall, with a sodden blanket.
    const bunk = new THREE.Group()
    bunk.position.copy(CABIN.bunk)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 0.95), wood)
    frame.position.y = 0.225
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 0.85), cloth)
    mattress.position.y = 0.5
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0xb9b19a, roughness: 1 }))
    pillow.position.set(-0.75, 0.6, 0)
    bunk.add(frame, mattress, pillow)
    parent.add(bunk)

    // Table and a toppled chair.
    const table = new THREE.Group()
    table.position.copy(CABIN.table)
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.7), rotten)
    top.position.y = 0.8
    top.rotation.z = 0.12
    table.add(top)
    for (const [x, z] of [[-0.45, -0.28], [0.45, -0.28], [-0.45, 0.28], [0.45, 0.28]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), rotten)
      leg.position.set(x, 0.4, z)
      table.add(leg)
    }
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), rotten)
    chair.position.set(-0.9, 0.22, -0.4)
    chair.rotation.set(0.3, 0.6, 1.2)
    table.add(chair)
    parent.add(table)

    // The figurehead: a carved stone maiden, lying on her back beside the bunk.
    this.figurehead.position.copy(CABIN.figurehead)
    this.figureheadStart.copy(CABIN.figurehead)
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 4, 10), stone)
    body.rotation.z = Math.PI / 2
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), stone)
    head.position.set(-0.72, 0.03, 0)
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), stone)
    hair.position.set(-0.78, 0.05, 0)
    hair.rotation.z = Math.PI / 2
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 10), stone)
    robe.rotation.z = -Math.PI / 2
    robe.position.set(0.72, 0, 0)
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.45, 3, 6), stone)
      arm.position.set(-0.2, 0.16, side * 0.14)
      arm.rotation.set(side * 0.4, 0, Math.PI / 2 + 0.3)
      this.figurehead.add(arm)
    }
    this.figurehead.add(body, head, hair, robe)
    parent.add(this.figurehead)

    // The key hides underneath her.
    this.key = makeItem('key')
    this.key.position.set(CABIN.figurehead.x + 0.1, DECK_Y + 0.02, CABIN.figurehead.z)
    this.key.rotation.x = -Math.PI / 2
    this.key.visible = false
    parent.add(this.key)

    // The captain's chest against the back wall, lock facing the room.
    const chest = new THREE.Group()
    // Local -z (the lock side) faces the door.
    chest.position.copy(CABIN.chest)
    // A hollow box (four walls and a floor), dark inside, so what's in it shows when the lid opens.
    const inside = new THREE.MeshStandardMaterial({ color: 0x2a1a0e, roughness: 0.95, side: THREE.DoubleSide })
    const box = new THREE.Group()
    const panel = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [wood, wood, wood, inside, wood, wood])
      m.position.set(x, y, z)
      box.add(m)
    }
    panel(0.9, 0.04, 0.55, 0, 0.02, 0) // floor
    panel(0.9, 0.5, 0.04, 0, 0.25, -0.255) // front (lock side)
    panel(0.9, 0.5, 0.04, 0, 0.25, 0.255) // back
    panel(0.04, 0.5, 0.47, -0.43, 0.25, 0) // sides
    panel(0.04, 0.5, 0.47, 0.43, 0.25, 0)
    const bandL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.52, 0.57), brass)
    bandL.position.set(-0.35, 0.25, 0)
    const bandR = bandL.clone()
    bandR.position.x = 0.35
    chest.add(box, bandL, bandR)
    // Lid hinged at the back edge.
    this.lid.position.set(0, 0.5, 0.275)
    const lidBox = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.18, 0.57), wood)
    lidBox.position.set(0, 0.09, -0.275)
    this.lid.add(lidBox)
    chest.add(this.lid)
    const lockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.03), brass)
    lockPlate.position.set(0, 0.45, -0.29)
    chest.add(lockPlate)
    this.lock.position.set(0, 0.45, -0.31)
    chest.add(this.lock)
    parent.add(chest)

    // Inside the chest: a heap of gold with map piece II lying on top, a few coins and gems, and a
    // warm glow that shows once the lid is up.
    const gold = new THREE.MeshStandardMaterial({ color: 0xf2c230, metalness: 0.9, roughness: 0.3, emissive: 0x4a3200 })
    this.hoard = new THREE.Group()
    const heap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold)
    heap.scale.set(1.02, 0.55, 0.6)
    heap.position.y = 0.2
    this.hoard.add(heap)
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 14; i++) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 12), gold)
      const x = (rand() - 0.5) * 0.7
      const z = (rand() - 0.5) * 0.36
      coin.position.set(x, 0.2 + 0.2 * Math.sqrt(Math.max(0, 1 - (x / 0.41) ** 2 - (z / 0.24) ** 2)) + 0.01, z)
      coin.rotation.set(rand() - 0.5, rand() * 3, rand() - 0.5)
      this.hoard.add(coin)
    }
    for (const [x, z, color] of [[-0.28, 0.1, 0xe0284a], [0.3, -0.06, 0x2ad46a]] as const) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.1 }))
      gem.position.set(x, 0.33, z)
      this.hoard.add(gem)
    }
    this.glow = new THREE.PointLight(0xffc860, 0, 2.2, 1.5)
    this.glow.position.set(0, 0.7, 0)
    this.hoard.add(this.glow)
    this.hoard.visible = false
    chest.add(this.hoard)
    this.mapPiece = makeItem('mapPiece')
    this.mapPiece.rotation.x = -Math.PI / 2 + 0.35
    this.mapPiece.position.set(0, 0.45, -0.02)
    this.mapPiece.visible = false
    chest.add(this.mapPiece)
    for (let i = 0; i < 3; i++) {
      const coin = makeItem('coin')
      coin.position.set(-0.25 + i * 0.25, 0.42, 0.1)
      coin.visible = false
      chest.add(coin)
      this.chestCoins.push(coin)
    }
  }

  /** The Strongman heaves the figurehead aside. */
  lift(): void {
    if (this.lifted) return
    this.lifted = true
    this.liftT = 0
    this.audio.play('impact', this.figurehead.getWorldPosition(new THREE.Vector3()), 0.6)
  }

  unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    this.lidT = 0
    this.hoard.visible = true
    this.mapPiece.visible = true
    for (const c of this.chestCoins) c.visible = true
    this.audio.play('click', this.lock.getWorldPosition(new THREE.Vector3()))
  }

  update(dt: number): void {
    if (this.liftT >= 0 && this.liftT < 1) {
      this.liftT = Math.min(1, this.liftT + dt / LIFT_SECONDS)
      const u = this.liftT
      // Up, over, and set down against the stern wall.
      this.figurehead.position.set(
        this.figureheadStart.x + u * 0.9,
        this.figureheadStart.y + Math.sin(Math.PI * u) * 0.8 + u * 0.1,
        this.figureheadStart.z + u * (STERN_Z - 0.6 - this.figureheadStart.z) * 0.4,
      )
      this.figurehead.rotation.z = u * 0.6
      // Reveal the key once, as she comes up (not every frame: it may already have been taken).
      if (!this.keyRevealed && !this.keyTaken && this.liftT >= 0.3) {
        this.keyRevealed = true
        this.key.visible = true
      }
      if (this.liftT >= 1) this.audio.play('thud', this.figurehead.getWorldPosition(new THREE.Vector3()))
    }
    if (this.lidT >= 0 && this.lidT < 1) {
      this.lidT = Math.min(1, this.lidT + dt / LID_SECONDS)
      // Up and back on its hinges (it rests against the stern wall), light spilling out.
      const u = 1 - Math.pow(1 - this.lidT, 3)
      this.lid.rotation.x = 1.65 * u
      this.glow.intensity = 1.6 * u
    }
  }
}

/** The figurehead as something a hand can try (and fail) to pick up: too heavy without the skill. */
export class TooHeavy implements Interactable {
  /** Never flies to your hand: it's the Strongman's job to move her. */
  readonly pullable = false
  onTry: (hand: Hand) => void = () => {}
  private readonly v = new THREE.Vector3()

  constructor(
    private readonly body: THREE.Object3D,
    private readonly radius: number,
    private readonly isMovable: () => boolean,
  ) {}

  grabGap(point: THREE.Vector3): number {
    if (!this.isMovable()) return Infinity
    return point.distanceTo(this.body.getWorldPosition(this.v)) - this.radius
  }

  grab(hand: Hand): void {
    hand.held = null
    // A strained, heavy buzz.
    hand.pulse(0.9, 200)
    this.onTry(hand)
  }

  release(): void {}

  setHighlight(): void {}
}

export const CABIN_DOOR_Z = CABIN_FRONT_Z
