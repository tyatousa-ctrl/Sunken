import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import { Label } from '../ui/Label'
import { DECK_Y, type Galleon } from '../world/ship/Galleon'
import { DECK_BOW_Z } from './deck'

/** Where Rose stands: right at the tip, on the lower rail (ship-local). */
const ROSE_AT = new THREE.Vector3(0, DECK_Y + 0.22, DECK_BOW_Z + 0.95)
/** Where you stand to fly with her: just behind her (ship-local, feet). */
export const BOW_SPOT = new THREE.Vector3(0, DECK_Y, DECK_BOW_Z + 1.6)
/** Arms out wide: hands at least this far apart, level with your shoulders. */
const ARM_SPAN = 1.05
const HOLD_SECONDS = 0.6
const COOLDOWN_SECONDS = 8

// The bow: a bowsprit reaching out ahead, and Rose standing at the very tip with her arms out wide.
// Stand behind her, spread your arms like wings, and you're flying: "I'm the king of the world!"
export class TitanicBow {
  /** Where the bow zipline is made fast (ship-local): on the bowsprit, above Rose's head. */
  readonly ropeTie: THREE.Vector3
  /** Keep walkers from stepping into Rose (ship-local circle). */
  readonly obstacle = { x: ROSE_AT.x, z: ROSE_AT.z, r: 0.28 }
  private readonly rose = new THREE.Group()
  private readonly arms: THREE.Object3D[] = []
  private readonly hair: THREE.Mesh
  private readonly shawl: THREE.Mesh
  private readonly sign = new Label({ width: 0.62, canvasWidth: 620, canvasHeight: 250, billboard: true })
  private hold = 0
  private cooldown = 0
  private flying = 0
  private time = 0
  private readonly v = new THREE.Vector3()
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()

  constructor(
    private readonly ship: Galleon,
    private readonly audio: AudioSystem,
  ) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1b, roughness: 0.85 })
    const tar = new THREE.MeshStandardMaterial({ color: 0x7a5c38, roughness: 0.95 })

    // The bowsprit: a long spar out over the water from the tip of the bow, tilted up.
    const sprit = new THREE.Group()
    sprit.position.set(0, DECK_Y + 0.95, DECK_BOW_Z + 0.35)
    sprit.rotation.x = 0.33
    const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 7, 10).rotateX(Math.PI / 2), wood)
    spar.position.z = -3.5
    sprit.add(spar)
    for (const z of [-1.2, -3, -5]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 12), new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.7, roughness: 0.4 }))
      band.position.z = z
      sprit.add(band)
    }
    ship.shake.add(sprit)
    sprit.updateMatrix()
    // Far enough out along the bowsprit that the rope passes well over Rose's head.
    this.ropeTie = new THREE.Vector3(0, 0, -4.6).applyMatrix4(sprit.matrix)
    // A stay from the end of the bowsprit down to the stem, and a pennant at its tip.
    const tip = new THREE.Vector3(0, 0, -7).applyMatrix4(sprit.matrix)
    const stem = new THREE.Vector3(0, DECK_Y - 1.2, DECK_BOW_Z - 0.3)
    ship.shake.add(ropeBetween(tip, stem, 0.015, tar))

    // Rose: long plum dress, cream shawl, auburn hair up, arms spread wide, facing out to sea.
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0cdb4, roughness: 0.7 })
    const dress = new THREE.MeshStandardMaterial({ color: 0x5b2346, roughness: 0.8 })
    const cream = new THREE.MeshStandardMaterial({ color: 0xefe3c8, roughness: 0.9, side: THREE.DoubleSide })
    const auburn = new THREE.MeshStandardMaterial({ color: 0x9b3a1c, roughness: 0.75 })
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.3, 1.0, 16), dress)
    skirt.position.y = 0.5
    const bodice = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.28, 4, 12), dress)
    bodice.position.y = 1.2
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8), skin)
    neck.position.y = 1.5
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 12), skin)
    head.position.y = 1.62
    head.scale.set(0.92, 1.08, 0.95)
    this.hair = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), auburn)
    this.hair.position.set(0, 1.645, 0.012)
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), auburn)
    bun.position.set(0, 1.7, 0.1)
    // The shawl, streaming back in the wind.
    // Draped round her shoulders and down her back (the back half of a short open cone).
    this.shawl = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.21, 0.32, 16, 1, true, -Math.PI / 2, Math.PI), cream)
    this.shawl.position.set(0, 1.3, 0.01)
    this.rose.add(skirt, bodice, neck, head, this.hair, bun, this.shawl)
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group()
      shoulder.position.set(side * 0.15, 1.36, 0)
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.52, 4, 8), dress)
      arm.rotation.z = (side * Math.PI) / 2
      arm.position.x = side * 0.3
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), skin)
      hand.position.x = side * 0.6
      shoulder.add(arm, hand)
      // Arms out and a little back, like wings.
      shoulder.rotation.y = side * -0.18
      shoulder.rotation.z = side * 0.08
      this.rose.add(shoulder)
      this.arms.push(shoulder)
    }
    // Facing out over the bow (her front is -z, like the ship's).
    this.rose.position.copy(ROSE_AT)
    ship.shake.add(this.rose)

    // A small sign on the rail beside her.
    this.sign.mesh.position.set(0.75, DECK_Y + 1.9, DECK_BOW_Z + 2.2)
    ship.shake.add(this.sign.mesh)
    this.sign.set([
      { text: 'Rose', size: 44, bold: true, color: '#f2b64a' },
      { text: 'Stand behind her and spread your arms wide', size: 26 },
      { text: '...and fly!', size: 26, color: '#ffe0a0' },
    ])
  }

  /** Rose's head (world), where her voice comes from. */
  get roseHead(): THREE.Vector3 {
    return this.rose.localToWorld(this.v.set(0, 1.62, 0))
  }

  /**
   * Watch for the pose: you behind her with your arms out wide. `onFly` fires once per pose (then a
   * short rest). Returns nothing; animates her in the wind.
   */
  update(dt: number, head: THREE.Vector3, hands: Hand[], camera: THREE.Camera, onFly: () => void): void {
    this.time += dt
    this.sign.face(camera)
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.flying = Math.max(0, this.flying - dt)
    // The wind: her shawl ripples, her arms dip and lift a little (more while you're flying with her).
    const gust = 1 + this.flying * 0.6
    this.shawl.rotation.x = 0.1 + Math.sin(this.time * 5.3) * 0.05 * gust
    this.shawl.rotation.y = Math.sin(this.time * 3.1) * 0.06 * gust
    this.arms.forEach((arm, i) => (arm.rotation.x = Math.sin(this.time * 1.4 + i) * 0.05 * gust))

    const spot = this.ship.shake.localToWorld(this.a.copy(BOW_SPOT))
    const near = Math.hypot(head.x - spot.x, head.z - spot.z) < 0.85
    const left = hands.find((h) => h.connected && h.handedness === 'left' && !h.held)
    const right = hands.find((h) => h.connected && h.handedness === 'right' && !h.held)
    let posed = false
    if (near && left && right) {
      const l = left.worldPos(this.a)
      const r = right.worldPos(this.b)
      const span = Math.hypot(l.x - r.x, l.z - r.z)
      const shoulder = head.y - 0.25
      posed = span > ARM_SPAN && Math.abs(l.y - shoulder) < 0.4 && Math.abs(r.y - shoulder) < 0.4
    }
    this.hold = posed ? this.hold + dt : 0
    if (this.hold >= HOLD_SECONDS && this.cooldown === 0) {
      this.hold = 0
      this.cooldown = COOLDOWN_SECONDS
      this.fly(hands)
      onFly()
    }
  }

  /** The moment: a gust of wind, a rumble in both hands, Rose's arms lift. */
  fly(hands: Hand[] = []): void {
    this.flying = 4
    this.audio.play('wind', this.roseHead, 1)
    for (const h of hands) h.pulse(0.8, 400)
  }
}

function ropeBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 6, 1).rotateX(Math.PI / 2), material)
  mesh.position.lerpVectors(a, b, 0.5)
  mesh.lookAt(b)
  return mesh
}
