import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { GrabSystem, Interactable } from '../interaction/GrabSystem'
import type { HeldAdapter, HeldSyncable } from '../net/HeldSync'
import { DECK_Y, type Galleon } from '../world/ship/Galleon'

/** The cannoli cart stands to port just forward of the main mast, its counter facing starboard. */
export const CART_AT = new THREE.Vector3(-2.15, DECK_Y, -2.1)
const COUNTER = { depth: 0.6, length: 1.5, height: 0.92 }
const SHELLS = 6
const PLATE_SLOTS = 3
/** Seconds of piping to fill a shell. */
const FILL_SECONDS = 1.4
const BITES = 3
/** An eaten cannoli is back on the tray (fresh and empty) after this long. */
const RESTOCK_SECONDS = 5
const TOPPINGS = ['plain', 'pistachio', 'chocolate'] as const
type Topping = (typeof TOPPINGS)[number]
/** Where a cannoli is: on the tray, on a plate slot, gone (eaten), or in someone's hand. */
type Place = 'tray' | 'plate' | 'eaten' | 'held'

export interface CannoliContext {
  audio: AudioSystem
  cream: Particles
  camera: THREE.Camera
  say: (text: string, seconds: number) => void
}

// A Sicilian cannoli cart: a tray of crisp shells, a piping bag of ricotta cream, jars of crushed
// pistachios and chocolate chips, and a plate. Hold a shell in one hand and the piping bag in the other:
// squeeze the trigger with the nozzle at an end of the shell and the cream pipes in until it's full.
// Dip a creamy end in a jar to coat it. Then eat it (hold it to your mouth: three bites) or leave it on
// the plate for someone else to come and eat. In a crew it's all shared.
export class CannoliCart {
  /** Tell the crew: cannoli `i` is now [place, fill, topping, bites, plate slot]. */
  onChange: (i: number, state: number[]) => void = () => {}
  readonly shells: Cannoli[] = []
  readonly bag: PipingBag
  readonly root = new THREE.Group()
  readonly jars: { centre: THREE.Vector3; topping: Topping }[] = []
  readonly plateCentre: THREE.Vector3
  private readonly v = new THREE.Vector3()

  constructor(
    ship: Galleon,
    grab: GrabSystem,
    readonly ctx: CannoliContext,
  ) {
    // Cart-local: +x is the front of the counter (where you stand), z runs along it.
    this.root.position.copy(CART_AT)
    ship.shake.add(this.root)
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.8 })
    const trim = new THREE.MeshStandardMaterial({ color: 0x2f6e3a, roughness: 0.7 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(COUNTER.depth, COUNTER.height - 0.2, COUNTER.length), wood)
    body.position.y = 0.2 + (COUNTER.height - 0.2) / 2
    const top = new THREE.Mesh(new THREE.BoxGeometry(COUNTER.depth + 0.06, 0.04, COUNTER.length + 0.06), new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.6 }))
    top.position.y = COUNTER.height
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, COUNTER.length), trim)
    skirt.position.set(COUNTER.depth / 2 + 0.011, COUNTER.height - 0.1, 0)
    this.root.add(body, top, skirt)
    // Big spoked wheels at the ends.
    for (const z of [-COUNTER.length / 2 - 0.04, COUNTER.length / 2 + 0.04]) {
      const wheel = new THREE.Group()
      wheel.position.set(-0.05, 0.36, z)
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 6, 24), new THREE.MeshStandardMaterial({ color: 0xb8860b, roughness: 0.6 }))
      wheel.add(rim)
      for (let k = 0; k < 6; k++) {
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.66, 5), wood)
        spoke.rotation.z = (k * Math.PI) / 6
        wheel.add(spoke)
      }
      this.root.add(wheel)
    }
    // Canopy on four posts, striped green, white and red, with the name painted on its front edge.
    for (const [x, z] of [[-0.28, -0.72], [0.28, -0.72], [-0.28, 0.72], [0.28, 0.72]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.35, 6), wood)
      post.position.set(x, COUNTER.height + 0.67, z)
      this.root.add(post)
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, 1.7), new THREE.MeshStandardMaterial({ map: stripes(), roughness: 0.9 }))
    // Well above head height (a tall pirate's eyes are about 1.75 m up).
    canopy.position.y = COUNTER.height + 1.36
    canopy.rotation.z = 0.12
    const name = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.22), new THREE.MeshStandardMaterial({ map: painted('CANNOLI'), roughness: 0.8 }))
    name.rotation.y = Math.PI / 2
    name.position.set(0.41, COUNTER.height + 1.24, 0)
    this.root.add(canopy, name)

    const y = COUNTER.height + 0.02
    // The tray of shells.
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.36), new THREE.MeshStandardMaterial({ color: 0xc0c4c8, roughness: 0.3, metalness: 0.6 }))
    tray.position.set(0.05, y, -0.5)
    this.root.add(tray)
    for (let i = 0; i < SHELLS; i++) {
      const home = new THREE.Vector3(0.05 + (i % 2 ? 0.06 : -0.06), y + 0.035, -0.62 + Math.floor(i / 2) * 0.12)
      const shell = new Cannoli(this, i, home)
      this.shells.push(grab.add(shell))
    }
    // The piping bag, nozzle down in a cup.
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.12, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0x2f6e3a, roughness: 0.6, side: THREE.DoubleSide }))
    cup.position.set(0.1, y + 0.06, -0.12)
    this.root.add(cup)
    this.bag = grab.add(new PipingBag(this, new THREE.Vector3(0.1, y + 0.03, -0.12)))
    // Two jars: crushed pistachios and chocolate chips.
    for (const [z, topping] of [[0.16, 'pistachio'], [0.36, 'chocolate']] as const) {
      const jar = new THREE.Group()
      jar.position.set(0.08, y, z)
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.14, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0xd8eef5, roughness: 0.05, transparent: true, opacity: 0.35, side: THREE.DoubleSide }))
      glass.position.y = 0.07
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.09, 18), new THREE.MeshStandardMaterial({ map: speckles(topping), roughness: 0.9 }))
      fill.position.y = 0.047
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.072, 18).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: speckles(topping), roughness: 0.9 }))
      top.position.y = 0.093
      jar.add(glass, fill, top)
      this.root.add(jar)
      this.jars.push({ centre: new THREE.Vector3(0.08, y + 0.09, z), topping })
    }
    // The plate.
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.015, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }))
    plate.position.set(0.1, y + 0.008, 0.58)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.006, 6, 24).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2f6e3a, roughness: 0.4 }))
    rim.position.copy(plate.position).setY(y + 0.017)
    this.root.add(plate, rim)
    this.plateCentre = new THREE.Vector3(0.1, y + 0.03, 0.58)
  }

  /** Where plate slot `k` is (cart-local). */
  plateSlot(k: number, target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.plateCentre).add(new THREE.Vector3(0, 0, (k - 1) * 0.07))
  }

  /** A free plate slot, if any. */
  freeSlot(): number {
    for (let k = 0; k < PLATE_SLOTS; k++) if (!this.shells.some((s) => s.place === 'plate' && s.slot === k)) return k
    return -1
  }

  /** World point of something cart-local. */
  world(local: THREE.Vector3): THREE.Vector3 {
    return this.root.localToWorld(local.clone())
  }

  /** A crewmate's cannoli changed. */
  remote(i: number, state: number[]): void {
    this.shells[i]?.setState(state)
  }

  update(dt: number): void {
    this.bag.pipe(dt)
    for (const s of this.shells) s.update(dt)
    void this.v
  }
}

/** A cannoli shell: crisp and golden, piped full of cream, maybe dipped in pistachio or chocolate. */
class Cannoli implements Interactable, HeldSyncable {
  readonly object = new THREE.Group()
  holder: Hand | null = null
  takenElsewhere = false
  place: Place = 'tray'
  slot = -1
  fill = 0
  topping: Topping = 'plain'
  bites = 0
  private restock = 0
  private biteCooldown = 0
  private sentFill = 0
  private readonly v = new THREE.Vector3()

  constructor(
    private readonly cart: CannoliCart,
    readonly index: number,
    private readonly home: THREE.Vector3,
  ) {
    this.object.add(makeCannoli())
    this.goTray()
  }

  /** [place, fill, topping, bites, slot]: everything the crew needs to draw it. */
  state(): number[] {
    return [['tray', 'plate', 'eaten', 'held'].indexOf(this.place), Math.round(this.fill * 20) / 20, TOPPINGS.indexOf(this.topping), this.bites, this.slot]
  }

  setState(s: number[]): void {
    const place = (['tray', 'plate', 'eaten', 'held'] as const)[s[0]] ?? 'tray'
    this.fill = s[1] ?? 0
    this.topping = TOPPINGS[s[2]] ?? 'plain'
    this.bites = s[3] ?? 0
    if (place === 'plate') this.goPlate(s[4] ?? 0)
    else if (place === 'eaten') this.eaten()
    else if (place === 'tray') this.goTray()
    this.paint()
  }

  heldAdapter(): HeldAdapter {
    return {
      heldBy: () => this.holder,
      shown: () => this.object,
      state: () => [this.fill, TOPPINGS.indexOf(this.topping), this.bites],
      apply: (proxy, s) => paint(proxy.children[0], s[0] ?? 0, TOPPINGS[s[1]] ?? 'plain', s[2] ?? 0),
      taken: (on) => {
        this.takenElsewhere = on
        this.object.visible = !on && this.place !== 'eaten'
      },
    }
  }

  /** Its two open ends (world). */
  ends(a: THREE.Vector3, b: THREE.Vector3): void {
    this.object.localToWorld(a.set(0, 0.07, 0))
    this.object.localToWorld(b.set(0, -0.07, 0))
  }

  grabGap(point: THREE.Vector3): number {
    if (this.holder || this.place === 'eaten' || !this.object.visible) return Infinity
    return point.distanceTo(this.object.getWorldPosition(this.v)) - 0.07
  }

  grab(hand: Hand): void {
    this.holder = hand
    this.place = 'held'
    this.slot = -1
    hand.grip.add(this.object)
    // Held between finger and thumb, pointing ahead.
    this.object.position.set(0, -0.02, -0.07)
    this.object.rotation.set(Math.PI / 2, 0, 0)
    hand.pulse(0.25, 25)
  }

  release(hand: Hand): void {
    if (hand !== this.holder) return
    this.holder = null
    // Let go over the plate: it's left there for someone else.
    const plate = this.cart.world(this.cart.plateCentre)
    const slot = this.cart.freeSlot()
    if (slot >= 0 && this.object.getWorldPosition(this.v).distanceTo(plate) < 0.22) {
      this.goPlate(slot)
      this.cart.ctx.audio.play('click', plate, 0.4)
      if (this.fill > 0) this.cart.ctx.say('Left on the plate for whoever wants it.', 2.5)
    } else this.goTray()
    this.share()
  }

  setHighlight(): void {}

  /** Cream piped in (0–1). */
  addCream(amount: number): void {
    const before = this.fill
    this.fill = Math.min(1, this.fill + amount)
    this.paint()
    if (before < 1 && this.fill >= 1) this.cart.ctx.say('Full! Dip an end in pistachios or chocolate chips, or eat it as it is.', 3)
    if (Math.abs(this.fill - this.sentFill) >= 0.2 || (this.fill >= 1 && this.sentFill < 1)) this.share()
  }

  update(dt: number): void {
    this.biteCooldown = Math.max(0, this.biteCooldown - dt)
    if (this.place === 'eaten') {
      this.restock -= dt
      if (this.restock <= 0) {
        this.fill = 0
        this.topping = 'plain'
        this.bites = 0
        this.goTray()
        this.paint()
      }
      return
    }
    const hand = this.holder
    if (!hand) return
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    this.ends(a, b)
    // Dipped: a creamy end pushed into a jar's crumbs.
    if (this.fill > 0.4) {
      for (const jar of this.cart.jars) {
        const c = this.cart.world(jar.centre)
        for (const end of [a, b]) {
          if (Math.hypot(end.x - c.x, end.z - c.z) < 0.07 && end.y < c.y + 0.01 && end.y > c.y - 0.1 && this.topping !== jar.topping) {
            this.topping = jar.topping
            this.paint()
            hand.pulse(0.3, 40)
            this.cart.ctx.audio.play('crunch', end, 0.5)
            this.share()
          }
        }
      }
    }
    // Eating: held up to your mouth.
    const mouth = this.cart.ctx.camera.getWorldPosition(this.v).add(new THREE.Vector3(0, -0.08, 0))
    if (this.biteCooldown === 0 && this.object.getWorldPosition(new THREE.Vector3()).distanceTo(mouth) < 0.16) {
      this.biteCooldown = 0.7
      this.bites++
      this.cart.ctx.audio.play('crunch', mouth, 1)
      hand.pulse(0.45, 70)
      this.cart.ctx.cream.emit({ position: mouth.clone().add(new THREE.Vector3(0, -0.02, -0.08)), velocity: new THREE.Vector3(0, -0.5, 0), spread: 0.3, color: 0xd9a55a, size: 0.012, life: 0.5, count: 6 })
      if (this.bites >= BITES) {
        const line = this.fill < 0.3 ? 'Crunchy... but it wanted cream.' : this.topping === 'pistachio' ? 'Pistachio! Bellissimo.' : this.topping === 'chocolate' ? 'Chocolate chip. Perfetto.' : 'Mmm, fresh ricotta. Magnifico!'
        this.cart.ctx.say(line, 3)
        hand.held = null
        this.holder = null
        this.eaten()
      }
      this.paint()
      this.share()
    }
  }

  private share(): void {
    this.sentFill = this.fill
    this.cart.onChange(this.index, this.state())
  }

  private paint(): void {
    paint(this.object.children[0], this.fill, this.topping, this.bites)
  }

  private goTray(): void {
    this.place = 'tray'
    this.slot = -1
    this.cart.root.add(this.object)
    this.object.position.copy(this.home)
    this.object.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    this.object.visible = !this.takenElsewhere
  }

  private goPlate(slot: number): void {
    this.place = 'plate'
    this.slot = slot
    this.cart.root.add(this.object)
    this.cart.plateSlot(slot, this.object.position)
    this.object.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    this.object.visible = !this.takenElsewhere
  }

  private eaten(): void {
    this.place = 'eaten'
    this.slot = -1
    this.restock = RESTOCK_SECONDS
    this.cart.root.add(this.object)
    this.object.visible = false
  }
}

/** The piping bag: grip it, point the nozzle into a shell's end and squeeze the trigger. */
class PipingBag implements Interactable, HeldSyncable {
  readonly object = new THREE.Group()
  holder: Hand | null = null
  takenElsewhere = false
  private creamTimer = 0
  private readonly v = new THREE.Vector3()
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()

  constructor(
    private readonly cart: CannoliCart,
    private readonly home: THREE.Vector3,
  ) {
    // Cone of cloth, full of cream, a metal star nozzle at its point (at the origin, pointing -y).
    const cloth = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 14, 1, true).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.8, side: THREE.DoubleSide }))
    cloth.position.y = 0.13
    const twist = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.05, 10), new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.9 }))
    twist.position.y = 0.25
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 8).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.8 }))
    nozzle.position.y = 0.015
    this.object.add(cloth, twist, nozzle)
    this.goHome()
  }

  heldAdapter(): HeldAdapter {
    return {
      heldBy: () => this.holder,
      shown: () => this.object,
      taken: (on) => {
        this.takenElsewhere = on
        this.object.visible = !on
      },
    }
  }

  /** The nozzle's tip (world). */
  tip(target: THREE.Vector3): THREE.Vector3 {
    return this.object.localToWorld(target.set(0, -0.005, 0))
  }

  grabGap(point: THREE.Vector3): number {
    if (this.holder) return Infinity
    return point.distanceTo(this.object.localToWorld(this.v.set(0, 0.15, 0))) - 0.08
  }

  grab(hand: Hand): void {
    this.holder = hand
    hand.grip.add(this.object)
    // In the fist, nozzle ahead and down a little.
    this.object.position.set(0, -0.01, -0.02)
    this.object.rotation.set(-Math.PI / 2 - 0.4, 0, 0)
    hand.pulse(0.25, 25)
  }

  release(hand: Hand): void {
    if (hand !== this.holder) return
    this.holder = null
    this.goHome()
  }

  setHighlight(): void {}

  /** Squeezing: cream comes out, into a shell if the nozzle is at one of its ends. */
  pipe(dt: number): void {
    const hand = this.holder
    if (!hand || hand.trigger < 0.2) return
    const tip = this.tip(this.v)
    this.creamTimer -= dt
    if (this.creamTimer <= 0) {
      this.creamTimer = 0.08
      hand.pulse(0.12 + hand.trigger * 0.15, 40)
    }
    let into: Cannoli | null = null
    for (const s of this.cart.shells) {
      if (s.place === 'eaten' || s.fill >= 1) continue
      s.ends(this.a, this.b)
      if (tip.distanceTo(this.a) < 0.06 || tip.distanceTo(this.b) < 0.06) {
        into = s
        break
      }
    }
    if (into) into.addCream((dt / FILL_SECONDS) * (0.5 + hand.trigger * 0.5))
    else this.cart.ctx.cream.emit({ position: tip, velocity: this.object.localToWorld(new THREE.Vector3(0, -1, 0)).sub(this.object.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.6), spread: 0.05, color: 0xfff8ec, size: 0.014, life: 0.6, count: 1 })
  }

  private goHome(): void {
    this.cart.root.add(this.object)
    this.object.position.copy(this.home)
    this.object.rotation.set(0, 0, 0)
  }
}

/** Draw a cannoli: cream showing at its ends by how full it is, crusted with its topping, bitten down. */
function paint(model: THREE.Object3D | undefined, fill: number, topping: Topping, bites: number): void {
  if (!model) return
  const caps = model.children.filter((c) => c.userData.cream) as THREE.Mesh[]
  for (const cap of caps) {
    cap.visible = fill > 0.05
    cap.scale.y = Math.max(0.05, fill)
    const m = cap.material as THREE.MeshStandardMaterial
    const want = creamTextures[topping]()
    if (m.map !== want) {
      m.map = want
      m.needsUpdate = true
    }
  }
  model.scale.set(1, 1 - (bites / BITES) * 0.6, 1)
}

/** Shell along y, 14 cm long, with a ridged golden crust and cream plugs at each end. */
function makeCannoli(): THREE.Group {
  const model = new THREE.Group()
  const profile: THREE.Vector2[] = []
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    const y = -0.065 + t * 0.13
    profile.push(new THREE.Vector2(0.021 + Math.pow(Math.abs(t - 0.5) * 2, 3) * 0.009, y))
  }
  const crust = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), new THREE.MeshStandardMaterial({ map: crustTexture(), roughness: 0.7, side: THREE.DoubleSide }))
  model.add(crust)
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.03, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }))
    // Grows out from inside the shell as it fills (scaled on y).
    cap.geometry.translate(0, s * 0.015, 0)
    cap.position.y = s * 0.062
    cap.userData.cream = true
    cap.visible = false
    model.add(cap)
  }
  return model
}

let crust: THREE.CanvasTexture | null = null
function crustTexture(): THREE.CanvasTexture {
  if (crust) return crust
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#c9832e'
  ctx.fillRect(0, 0, 64, 64)
  for (let y = 0; y < 64; y += 6) {
    ctx.fillStyle = y % 12 ? '#b06a22' : '#dca050'
    ctx.fillRect(0, y, 64, 3)
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = 'rgba(120, 60, 20, 0.5)'
    ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2)
  }
  crust = new THREE.CanvasTexture(c)
  crust.colorSpace = THREE.SRGBColorSpace
  return crust
}

const cache = new Map<string, THREE.CanvasTexture>()
/** Crumbs of a topping (for the jars and a dipped end): pistachio greens, chocolate browns, or plain cream. */
function speckles(topping: Topping): THREE.CanvasTexture {
  const hit = cache.get(topping)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  const base = topping === 'plain' ? '#fbf6ea' : topping === 'pistachio' ? '#93b04a' : '#4a2c18'
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 64, 64)
  const bits = topping === 'pistachio' ? ['#6f8f2e', '#b7cf6a', '#c9b27a'] : topping === 'chocolate' ? ['#2a170c', '#6b4228', '#1c0f08'] : ['#f3ead6']
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = bits[i % bits.length]
    const s = 2 + Math.random() * 3
    ctx.fillRect(Math.random() * 64, Math.random() * 64, s, s)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  cache.set(topping, t)
  return t
}

/** Cream, dotted with its topping where it was dipped. */
const creamTextures: Record<Topping, () => THREE.CanvasTexture> = {
  plain: () => speckles('plain'),
  pistachio: () => dotted('pistachio'),
  chocolate: () => dotted('chocolate'),
}
function dotted(topping: Topping): THREE.CanvasTexture {
  const key = `cream-${topping}`
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fbf6ea'
  ctx.fillRect(0, 0, 64, 64)
  const bits = topping === 'pistachio' ? ['#6f8f2e', '#93b04a', '#b7cf6a'] : ['#2a170c', '#4a2c18', '#6b4228']
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = bits[i % bits.length]
    const s = 3 + Math.random() * 3
    ctx.fillRect(Math.random() * 64, Math.random() * 64, s, s)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  cache.set(key, t)
  return t
}

function stripes(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')!
  const colors = ['#2f8a3e', '#f5f1e6', '#c8322b']
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = colors[i % 3]
    ctx.fillRect(0, (i * 128) / 6, 128, 128 / 6 + 1)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function painted(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 76
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#f5f1e6'
  ctx.fillRect(0, 0, 512, 76)
  ctx.fillStyle = '#c8322b'
  ctx.font = 'bold italic 56px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText(text, 256, 58)
  ctx.fillStyle = '#2f8a3e'
  ctx.fillRect(0, 0, 512, 5)
  ctx.fillRect(0, 71, 512, 5)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
