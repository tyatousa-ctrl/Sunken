import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { GrabSystem, Interactable } from '../interaction/GrabSystem'
import type { HeldAdapter, HeldSyncable } from '../net/HeldSync'
import { Label } from '../ui/Label'
import { DECK_Y, type Galleon } from '../world/ship/Galleon'
import { RAT_GAME_AT } from './WhackARat'

/** The fire barrel stands just to port of the rat box (ship-local, its base). */
export const FIRE_AT = new THREE.Vector3(-0.75, DECK_Y, RAT_GAME_AT.z - 0.35)
/** The bucket of skewers beside it. */
export const SKEWERS_AT = new THREE.Vector3(-0.75, DECK_Y, RAT_GAME_AT.z + 0.55)
/** Seconds on the spit until it's done; after this many more, it's charcoal. */
export const COOK_SECONDS = 10
const CHAR_SECONDS = 15
const BARREL = { r: 0.28, h: 0.78 }
/** The spit's height over the deck (the forks' notches). */
const SPIT_Y = BARREL.h + 0.36
const SKEWER_LENGTH = 0.8
/** Where the rat sits on a skewer (skewer-local y: along it, from the handle end). */
const RAT_ON_STICK = 0.58
/** Up to this many knocked-out rats lie on the box lid after a round. */
const MAX_CATCH = 3
const BITES = 3

export interface RoastContext {
  audio: AudioSystem
  smoke: Particles
  sparks: Particles
  /** Now, ms, on the crew's clock (or this device's). */
  now: () => number
  camera: THREE.Camera
  say: (text: string, seconds: number) => void
}

/** A skewer's story: empty, raw rat on it, cooking on the spit, and how many bites are gone. */
export type SkewerPhase = 'empty' | 'raw' | 'spit' | 'held'

// The rat roast, beside Whack-a-Rat: a barrel with a fire in it and an iron spit holder above, and a
// bucket of skewers. When a round ends, the rats you bonked lie knocked out on the box lid. Hold a
// skewer, touch a rat to its tip and it's on. Lay the skewer across the forks over the fire: it
// turns by itself, the flames lick it, it sizzles and smokes, and in 10 seconds the rat goes from
// grey to golden brown. Take it off and hold it to your mouth: three crunchy bites. (Leave it on too
// long and it's charcoal.) In a crew the rats, skewers and spit are the same for everyone.
export class RatRoast {
  /** Tell the crew: rat `i` of the round starting `round` went onto a skewer. */
  onRatTaken: (i: number, round: number) => void = () => {}
  /** Tell the crew: skewer `i` now has (phase, cooked amount 0–1+, bites) on it. */
  onSkewer: (i: number, state: number[]) => void = () => {}
  /** Tell the crew: the spit now holds skewer `i` (-1: nothing), cooking since `since`. */
  onSpit: (i: number, since: number) => void = () => {}
  readonly skewers: Skewer[] = []
  readonly catches: Catch[] = []
  private readonly root = new THREE.Group()
  private readonly flames: THREE.Sprite[] = []
  private readonly embers: THREE.Mesh
  private readonly sign = new Label({ width: 0.55, canvasWidth: 560, canvasHeight: 230, billboard: true })
  /** The skewer on the spit (or null), and since when it's been cooking (ms, shared clock). */
  private onSpitNow: Skewer | null = null
  private spitSince = 0
  private round = 0
  private time = 0
  private smokeTimer = 0
  private sizzleTimer = 0
  private readonly spitCentre: THREE.Vector3
  private readonly v = new THREE.Vector3()

  constructor(
    ship: Galleon,
    grab: GrabSystem,
    readonly ctx: RoastContext,
  ) {
    ship.shake.add(this.root)
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.85 })
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.5, metalness: 0.7 })

    // The barrel, open at the top, with iron hoops, glowing coals inside and flames licking up.
    const barrel = new THREE.Group()
    barrel.position.copy(FIRE_AT)
    const staves = new THREE.Mesh(new THREE.CylinderGeometry(BARREL.r, BARREL.r * 0.9, BARREL.h, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.9, side: THREE.DoubleSide }))
    staves.position.y = BARREL.h / 2
    barrel.add(staves)
    for (const y of [0.12, BARREL.h / 2, BARREL.h - 0.08]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(BARREL.r + 0.008, 0.012, 6, 24).rotateX(Math.PI / 2), iron)
      hoop.position.y = y
      barrel.add(hoop)
    }
    this.embers = new THREE.Mesh(new THREE.CircleGeometry(BARREL.r * 0.95, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff6a1a }))
    this.embers.position.y = BARREL.h - 0.12
    barrel.add(this.embers)
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.45, 6).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x241509, roughness: 1, emissive: 0x3a1204 }))
      log.position.y = BARREL.h - 0.1
      log.rotation.y = (i * Math.PI) / 4
      barrel.add(log)
    }
    const flameTexture = makeFlameTexture()
    for (let i = 0; i < 7; i++) {
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTexture, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: i % 2 ? 0xffb347 : 0xff7a2a }))
      const a = (i / 7) * Math.PI * 2
      flame.position.set(Math.cos(a) * 0.1 * (i % 3), BARREL.h + 0.08, Math.sin(a) * 0.1 * (i % 3))
      flame.userData.phase = Math.random() * 10
      barrel.add(flame)
      this.flames.push(flame)
    }
    this.root.add(barrel)

    // The spit holder: an iron fork each side of the barrel, notched at the top.
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, SPIT_Y - 0.1, 6), iron)
      post.position.set(side * (BARREL.r + 0.06), 0.1 + (SPIT_Y - 0.1) / 2, 0)
      barrel.add(post)
      for (const lean of [-1, 1]) {
        const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.1, 5), iron)
        prong.position.set(side * (BARREL.r + 0.06), SPIT_Y + 0.03, lean * 0.03)
        prong.rotation.x = lean * 0.5
        barrel.add(prong)
      }
    }
    this.spitCentre = FIRE_AT.clone().setY(DECK_Y + SPIT_Y)

    // The bucket of skewers.
    const bucket = new THREE.Group()
    bucket.position.copy(SKEWERS_AT)
    const pail = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.26, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x6b6f73, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }))
    pail.position.y = 0.13
    bucket.add(pail)
    this.root.add(bucket)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      const home = new THREE.Vector3(SKEWERS_AT.x + Math.cos(a) * 0.035, DECK_Y + 0.02, SKEWERS_AT.z + Math.sin(a) * 0.035)
      const skewer = new Skewer(this, this.root, home, i)
      this.skewers.push(grab.add(skewer))
    }

    // The catch: knocked-out rats laid on the rat box's lid (hidden until a round ends).
    for (let i = 0; i < MAX_CATCH; i++) {
      const at = new THREE.Vector3(RAT_GAME_AT.x - 0.2 + i * 0.2, DECK_Y + 0.83, RAT_GAME_AT.z + 0.52)
      const c = new Catch(this, this.root, at, i)
      this.catches.push(grab.add(c))
    }

    this.sign.mesh.position.copy(FIRE_AT).add(new THREE.Vector3(0, 1.75, 0))
    this.root.add(this.sign.mesh)
    this.sign.set([
      { text: 'Rat Roast', size: 44, bold: true, color: '#f2b64a' },
      { text: 'Hold a skewer, touch a bonked rat to its tip', size: 24 },
      { text: 'Lay it on the forks over the fire: 10 s to golden', size: 24 },
      { text: 'Then hold it to your mouth and eat up!', size: 24, color: '#ffe0a0' },
    ])
  }

  get audio(): AudioSystem {
    return this.ctx.audio
  }

  /** A round of Whack-a-Rat started: the old catch is cleared away. */
  roundStarted(round: number): void {
    this.round = round
    for (const c of this.catches) c.show(false)
  }

  /** A round ended: the rats you bonked (up to three) lie on the lid, ready to roast. */
  roundEnded(score: number, round: number): void {
    this.round = round
    this.catches.forEach((c, i) => c.show(i < Math.min(score, MAX_CATCH)))
  }

  /** A crewmate skewered catch `i` of this round. */
  ratTakenRemote(i: number, round: number): void {
    if (round === this.round) this.catches[i]?.show(false)
  }

  /** A crewmate's skewer changed (what's on it, how cooked, bites). */
  skewerRemote(i: number, state: number[]): void {
    this.skewers[i]?.setState(state)
  }

  /** A crewmate put a skewer on the spit (or took it off). */
  spitRemote(i: number, since: number): void {
    const skewer = i >= 0 ? this.skewers[i] : null
    if (skewer === this.onSpitNow) return
    if (this.onSpitNow && this.onSpitNow !== skewer) this.onSpitNow.offSpit()
    this.onSpitNow = skewer
    this.spitSince = since
    skewer?.mountOnSpit(this.spitCentre)
  }

  /** A held rat touched a held/stored skewer's tip: it's on. */
  skewer(rat: Catch, hand: Hand): boolean {
    const tip = this.v
    const skewer = this.skewers.find((s) => s.phase === 'empty' && s.tip(tip).distanceTo(rat.object.getWorldPosition(new THREE.Vector3())) < 0.14)
    if (!skewer) return false
    rat.show(false)
    hand.held = null
    skewer.load()
    hand.pulse(0.6, 60)
    this.ctx.audio.play('thud', tip, 0.4)
    this.onRatTaken(rat.index, this.round)
    this.onSkewer(skewer.index, skewer.state())
    this.ctx.say('Skewered! Now lay it on the forks over the fire.', 3)
    return true
  }

  /** A skewer let go of near the fire: on the spit, if the spit's free. */
  tryMount(skewer: Skewer): boolean {
    if (this.onSpitNow && this.onSpitNow !== skewer) return false
    if (skewer.middle(this.v).distanceTo(this.root.localToWorld(this.spitCentre.clone())) > 0.35) return false
    this.onSpitNow = skewer
    this.spitSince = this.ctx.now() - skewer.cooked * COOK_SECONDS * 1000
    skewer.mountOnSpit(this.spitCentre)
    this.ctx.audio.play('thud', this.v, 0.4)
    this.onSpit(skewer.index, this.spitSince)
    if (skewer.phase === 'raw' || skewer.phase === 'spit') this.ctx.say('On the spit! Give it 10 seconds...', 3)
    return true
  }

  /** Taken off the spit (grabbed). */
  offSpit(skewer: Skewer): void {
    if (this.onSpitNow !== skewer) return
    this.onSpitNow = null
    this.onSpit(-1, 0)
  }

  update(dt: number): void {
    this.time += dt
    this.sign.face(this.ctx.camera)
    // Flames dance; the coals breathe.
    for (const f of this.flames) {
      const p = f.userData.phase as number
      const k = 0.75 + 0.35 * Math.sin(this.time * 9 + p) + 0.15 * Math.sin(this.time * 23 + p * 2)
      f.scale.set(0.16 * k, 0.32 * k, 1)
      f.position.y = BARREL.h + 0.06 + 0.1 * k
    }
    ;(this.embers.material as THREE.MeshBasicMaterial).color.setHSL(0.05, 1, 0.45 + 0.08 * Math.sin(this.time * 3))
    const barrelTop = this.root.localToWorld(this.v.copy(FIRE_AT).setY(DECK_Y + BARREL.h + 0.1))
    this.smokeTimer -= dt
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.25
      this.ctx.sparks.emit({ position: barrelTop, velocity: new THREE.Vector3(0, 1.2, 0), spread: 0.25, color: 0xffa040, size: 0.025, life: 0.6, count: 2 })
    }

    for (const s of this.skewers) s.update(dt)
    for (const c of this.catches) c.update()

    // Cooking: turning, colouring, sizzling and smoking on the spit.
    const s = this.onSpitNow
    if (s && s.hasRat) {
      const cooked = (this.ctx.now() - this.spitSince) / 1000 / COOK_SECONDS
      const wasDone = s.cooked >= 1
      s.cook(cooked)
      const at = s.ratWorld(new THREE.Vector3())
      this.sizzleTimer -= dt
      if (this.sizzleTimer <= 0) {
        this.sizzleTimer = 0.5
        this.ctx.audio.play('pour', at, 0.25)
        this.ctx.smoke.emit({ position: at, velocity: new THREE.Vector3(0, 0.9, 0), spread: 0.2, color: cooked > 1 + CHAR_SECONDS / COOK_SECONDS ? 0x333333 : 0xcfc6b8, size: 0.08, endSize: 0.4, life: 1.6, count: 2, alpha: 0.5 })
      }
      if (!wasDone && s.cooked >= 1) {
        this.ctx.audio.play('pop', at, 0.9)
        this.ctx.say('Ding! Golden brown. Take it off the fire and hold it to your mouth.', 4)
      }
    }
  }
}

/** A knocked-out rat lying on the lid, legs in the air. Grab it and touch it to a skewer's tip. */
class Catch implements Interactable, HeldSyncable {
  readonly object = new THREE.Group()
  heldBy: Hand | null = null
  takenElsewhere = false
  private visible = false

  constructor(
    private readonly roast: RatRoast,
    private readonly home: THREE.Object3D,
    private readonly at: THREE.Vector3,
    readonly index: number,
  ) {
    this.object.add(makeRat(0x6f6660))
    this.object.rotation.z = Math.PI / 2
    this.goHome()
    this.show(false)
  }

  heldAdapter(): HeldAdapter {
    return {
      heldBy: () => this.heldBy,
      shown: () => this.object,
      taken: (on) => {
        this.takenElsewhere = on
        this.object.visible = this.visible && !on
      },
    }
  }

  show(on: boolean): void {
    this.visible = on
    if (!on && this.heldBy) this.heldBy.held = null
    if (!on) this.heldBy = null
    this.goHome()
    this.object.visible = on && !this.takenElsewhere
  }

  grabGap(point: THREE.Vector3): number {
    if (!this.visible || this.heldBy) return Infinity
    return point.distanceTo(this.object.getWorldPosition(new THREE.Vector3())) - 0.1
  }

  grab(hand: Hand): void {
    this.heldBy = hand
    hand.grip.attach(this.object)
    hand.pulse(0.3, 30)
  }

  release(hand: Hand): void {
    if (hand !== this.heldBy) return
    this.heldBy = null
    this.goHome()
  }

  setHighlight(): void {}

  update(): void {
    const hand = this.heldBy
    if (hand) this.roast.skewer(this, hand)
  }

  private goHome(): void {
    this.home.add(this.object)
    this.object.position.copy(this.at)
    this.object.rotation.set(0, Math.random() * 0.6, Math.PI / 2)
  }
}

/** A skewer: a long green stick, whittled to a point, maybe with a rat on it. */
class Skewer implements Interactable, HeldSyncable {
  readonly object = new THREE.Group()
  holder: Hand | null = null
  takenElsewhere = false
  phase: SkewerPhase = 'empty'
  /** 0 raw → 1 done → more: charring. */
  cooked = 0
  bites = 0
  private readonly rat: THREE.Group
  private spinning = false
  private biteCooldown = 0
  private readonly v = new THREE.Vector3()

  constructor(
    private readonly roast: RatRoast,
    private readonly home: THREE.Object3D,
    private readonly homePos: THREE.Vector3,
    readonly index: number,
  ) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, SKEWER_LENGTH, 6), new THREE.MeshStandardMaterial({ color: 0x9b7a4a, roughness: 0.8 }))
    stick.position.y = SKEWER_LENGTH / 2
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.04, 6), new THREE.MeshStandardMaterial({ color: 0xcaa878, roughness: 0.8 }))
    point.position.y = SKEWER_LENGTH + 0.02
    this.object.add(stick, point)
    // The rat, run through lengthwise along the stick.
    this.rat = makeRat(0x6f6660)
    this.rat.position.y = RAT_ON_STICK - 0.08
    this.rat.visible = false
    this.object.add(this.rat)
    this.goHome()
  }

  get hasRat(): boolean {
    return this.phase !== 'empty'
  }

  /** Everything the crew needs to draw it: [has a rat, cooked, bites]. */
  state(): number[] {
    return [this.hasRat ? 1 : 0, Math.round(this.cooked * 100) / 100, this.bites]
  }

  setState(s: number[]): void {
    const has = s[0] === 1
    this.phase = has ? (this.phase === 'spit' ? 'spit' : 'raw') : 'empty'
    this.cooked = s[1] ?? 0
    this.bites = s[2] ?? 0
    this.paint()
  }

  heldAdapter(): HeldAdapter {
    return {
      heldBy: () => this.holder,
      shown: () => this.object,
      state: () => this.state(),
      apply: (proxy, s) => paintRat(proxy.children[2], s[0] === 1, s[1] ?? 0, s[2] ?? 0),
      taken: (on) => {
        this.takenElsewhere = on
        this.object.visible = !on
      },
    }
  }

  /** The sharp end (world). */
  tip(target: THREE.Vector3): THREE.Vector3 {
    return this.object.localToWorld(target.set(0, SKEWER_LENGTH, 0))
  }

  middle(target: THREE.Vector3): THREE.Vector3 {
    return this.object.localToWorld(target.set(0, RAT_ON_STICK, 0))
  }

  ratWorld(target: THREE.Vector3): THREE.Vector3 {
    return this.rat.getWorldPosition(target)
  }

  load(): void {
    this.phase = 'raw'
    this.cooked = 0
    this.bites = 0
    this.paint()
  }

  grabGap(point: THREE.Vector3): number {
    if (this.holder) return Infinity
    // Anywhere along the handle end.
    const a = this.object.localToWorld(new THREE.Vector3(0, 0.05, 0))
    const b = this.object.localToWorld(new THREE.Vector3(0, 0.4, 0))
    return new THREE.Line3(a, b).closestPointToPoint(point, true, this.v).distanceTo(point) - 0.06
  }

  grab(hand: Hand): void {
    if (this.spinning) {
      this.spinning = false
      if (this.phase === 'spit') this.phase = 'raw'
      this.roast.offSpit(this)
    }
    this.holder = hand
    hand.grip.add(this.object)
    // Held by the handle end, pointing forward.
    this.object.position.set(0, -0.01, 0.06)
    this.object.rotation.set(-Math.PI / 2, 0, 0)
    hand.pulse(0.3, 30)
  }

  release(hand: Hand): void {
    if (hand !== this.holder) return
    this.holder = null
    if (this.roast.tryMount(this)) return
    this.goHome()
    this.roast.onSkewer(this.index, this.state())
  }

  setHighlight(): void {}

  /** Across the forks over the fire, turning. */
  mountOnSpit(centre: THREE.Vector3): void {
    if (this.holder) this.holder.held = null
    this.holder = null
    this.home.add(this.object)
    // Lying along x, its middle (where the rat is) over the fire.
    this.object.position.set(centre.x - RAT_ON_STICK, centre.y, centre.z)
    this.object.rotation.set(0, 0, -Math.PI / 2)
    this.spinning = true
    if (this.hasRat) this.phase = 'spit'
    this.paint()
  }

  offSpit(): void {
    this.spinning = false
    if (this.phase === 'spit') this.phase = 'raw'
    this.goHome()
  }

  cook(amount: number): void {
    this.cooked = amount
    this.paint()
  }

  update(dt: number): void {
    if (this.spinning) this.object.rotation.x += dt * 2.2
    this.biteCooldown = Math.max(0, this.biteCooldown - dt)
    // Eating: a cooked rat held up to your mouth.
    const hand = this.holder
    if (!hand || !this.hasRat || this.biteCooldown > 0) return
    const mouth = this.roast.ctx.camera.getWorldPosition(this.v).add(new THREE.Vector3(0, -0.08, 0))
    if (this.ratWorld(new THREE.Vector3()).distanceTo(mouth) > 0.2) return
    this.biteCooldown = 0.8
    if (this.cooked < 1) {
      this.roast.ctx.say('Raw rat? Not a chance. Cook it first!', 2.5)
      return
    }
    this.bites++
    this.roast.audio.play('crunch', mouth, 1)
    this.roast.audio.play('gulp', mouth, 0.6)
    hand.pulse(0.5, 80)
    this.roast.ctx.sparks.emit({ position: mouth.clone().add(new THREE.Vector3(0, 0, -0.1)), velocity: new THREE.Vector3(0, -0.4, 0), spread: 0.4, color: 0x8a5a2b, size: 0.015, life: 0.5, count: 6 })
    if (this.bites >= BITES) {
      const charred = this.cooked > 1 + CHAR_SECONDS / COOK_SECONDS
      this.roast.ctx.say(charred ? 'Crunchy... very crunchy. Like eating charcoal.' : 'Mmm! Tastes like chicken.', 3.5)
      this.phase = 'empty'
      this.cooked = 0
      this.bites = 0
    }
    this.paint()
    this.roast.onSkewer(this.index, this.state())
  }

  private paint(): void {
    paintRat(this.rat, this.hasRat, this.cooked, this.bites)
  }

  private goHome(): void {
    this.spinning = false
    this.home.add(this.object)
    this.object.position.copy(this.homePos)
    this.object.rotation.set(0.08 * (this.index - 1), 0, 0.06 * (this.index - 1))
  }
}

/** A rat on a stick: grey raw, golden brown when done, black when burnt; smaller with each bite. */
function paintRat(rat: THREE.Object3D | undefined, has: boolean, cooked: number, bites: number): void {
  if (!rat) return
  rat.visible = has
  if (!has) return
  const raw = new THREE.Color(0x6f6660)
  const golden = new THREE.Color(0xb86a24)
  const burnt = new THREE.Color(0x1a1410)
  const c = cooked <= 1 ? raw.lerp(golden, Math.max(0, cooked)) : golden.lerp(burnt, Math.min(1, (cooked - 1) / (CHAR_SECONDS / COOK_SECONDS)))
  rat.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (m?.isMeshStandardMaterial && m.userData.fur) {
      m.color.copy(c)
      m.roughness = cooked >= 1 && cooked < 1.6 ? 0.45 : 0.95
    }
  })
  rat.scale.setScalar(1 - (bites / BITES) * 0.7)
}

/** A rat (lying along +y, nose up): body, head, ears, tail. Its fur is its own material, for cooking. */
function makeRat(color: number): THREE.Group {
  const rat = new THREE.Group()
  const fur = new THREE.MeshStandardMaterial({ color, roughness: 0.95 })
  fur.userData.fur = true
  const pink = new THREE.MeshStandardMaterial({ color: 0xe8a0a8, roughness: 0.8 })
  const eye = new THREE.MeshBasicMaterial({ color: 0x0a0a0a })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.1, 4, 10), fur)
  body.position.y = 0.08
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), fur)
  head.position.y = 0.18
  head.scale.set(1, 1.3, 0.95)
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), pink)
  nose.position.y = 0.235
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CircleGeometry(0.02, 10), pink)
    ear.position.set(s * 0.03, 0.19, -0.02)
    ear.rotation.x = Math.PI / 2
    const x = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.003, 0.003), eye)
    x.position.set(s * 0.018, 0.2, 0.038)
    x.rotation.z = Math.PI / 4
    const x2 = x.clone()
    x2.rotation.z = -Math.PI / 4
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.05, 5), pink)
    leg.position.set(s * 0.035, 0.05, 0.04)
    leg.rotation.x = 1.2
    rat.add(ear, x, x2, leg)
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.007, 0.16, 5), pink)
  tail.position.y = -0.04
  rat.add(body, head, nose, tail)
  return rat
}

function makeFlameTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(32, 96, 2, 32, 80, 60)
  g.addColorStop(0, 'rgba(255,255,220,1)')
  g.addColorStop(0.3, 'rgba(255,200,80,0.9)')
  g.addColorStop(0.65, 'rgba(255,100,20,0.4)')
  g.addColorStop(1, 'rgba(255,60,0,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(32, 2)
  ctx.quadraticCurveTo(62, 70, 50, 110)
  ctx.quadraticCurveTo(32, 128, 14, 110)
  ctx.quadraticCurveTo(2, 70, 32, 2)
  ctx.fill()
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
