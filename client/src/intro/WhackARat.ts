import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { GrabSystem, Interactable } from '../interaction/GrabSystem'
import type { HeldAdapter, HeldSyncable } from '../net/HeldSync'
import { Label } from '../ui/Label'
import { DECK_Y, type Galleon } from '../world/ship/Galleon'

/** The rat box stands amidships, between the sword rack and the foremast (ship-local). */
export const RAT_GAME_AT = new THREE.Vector3(1.0, DECK_Y, -15.5)
/** A round lasts this long (s), after a 3-2-1 countdown. */
export const ROUND_SECONDS = 30
const COUNTDOWN = 3
const BOX = { w: 0.7, l: 1.5, h: 0.78 }
/** Holes in two rows of three (box-local x, z). */
const HOLES: [number, number][] = [
  [-0.17, -0.48], [0.17, -0.48],
  [-0.17, 0], [0.17, 0],
  [-0.17, 0.48], [0.17, 0.48],
]
const RAT_UP = 0.1
const RAT_DOWN = -0.32
/** A club head this close to a rat's head, moving at least this fast, bonks it. */
const HIT_REACH = 0.13
const HIT_SPEED = 1.1

export interface Pop {
  t: number
  hole: number
  duration: number
}

/** The round's rats, the same on every device from the same seed. */
export function makeSchedule(seed: number): Pop[] {
  let a = seed >>> 0
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pops: Pop[] = []
  const busyUntil = new Array(HOLES.length).fill(0)
  let t = 0.3
  while (t < ROUND_SECONDS - 0.5) {
    // Faster and shorter as the round goes on.
    const late = t / ROUND_SECONDS
    const duration = THREE.MathUtils.lerp(1.3, 0.7, late) * (0.8 + random() * 0.4)
    const free = HOLES.map((_, i) => i).filter((i) => busyUntil[i] <= t)
    if (free.length > 0) {
      const hole = free[Math.floor(random() * free.length)]
      pops.push({ t, hole, duration })
      busyUntil[hole] = t + duration + 0.2
    }
    t += THREE.MathUtils.lerp(0.75, 0.35, late) * (0.7 + random() * 0.6)
  }
  return pops
}

export interface RatGameContext {
  audio: AudioSystem
  sparks: Particles
  /** Now, in ms, on the crew's shared clock (the server's) or this device's. */
  now: () => number
}

// Whack-a-Rat: the ship's rats have got into the hold. A wooden box with six holes stands amidships,
// four belaying pins hang on its side. Grab a pin, slap the big red button, and for 30 seconds rats pop
// up out of the holes: bonk them before they duck back down. Squeaks, stars, a thump in your hand,
// and a score board with the best score of the voyage. In a crew the rats pop in the same holes at
// the same moments for everyone, anyone can bonk them, and the crew shares one score.
export class WhackARat {
  /** This device started a round: tell the crew (seed, start time on the shared clock). */
  onStart: (seed: number, startAt: number) => void = () => {}
  /** This device bonked rat `index` of the round: tell the crew. */
  onHit: (index: number, startAt: number) => void = () => {}
  readonly clubs: Club[] = []
  private readonly box = new THREE.Group()
  private readonly rats: Rat[] = []
  private readonly button: THREE.Mesh
  private readonly board = document.createElement('canvas')
  private readonly boardTexture: THREE.CanvasTexture
  private readonly sign = new Label({ width: 0.6, canvasWidth: 600, canvasHeight: 230, billboard: true })
  private pops: Pop[] = []
  private startAt = 0
  private readonly hits = new Set<number>()
  private best = 0
  private lastScore = -1
  private finished = true
  private buttonCooldown = 0
  private drawKey = ''
  private readonly v = new THREE.Vector3()

  constructor(
    ship: Galleon,
    grab: GrabSystem,
    private readonly ctx: RatGameContext,
  ) {
    const box = this.box
    box.position.copy(RAT_GAME_AT)
    ship.shake.add(box)
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.85 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.9 })
    const black = new THREE.MeshBasicMaterial({ color: 0x050403 })
    // The box: four sides and a lid with six holes (a dark disc under each, and a rim).
    for (const [w, d, x, z] of [[BOX.w, 0.04, 0, -BOX.l / 2], [BOX.w, 0.04, 0, BOX.l / 2], [0.04, BOX.l, -BOX.w / 2, 0], [0.04, BOX.l, BOX.w / 2, 0]] as const) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(w, BOX.h, d), wood)
      side.position.set(x, BOX.h / 2, z)
      box.add(side)
    }
    const lidShape = new THREE.Shape()
    lidShape.moveTo(-BOX.w / 2, -BOX.l / 2)
    lidShape.lineTo(BOX.w / 2, -BOX.l / 2)
    lidShape.lineTo(BOX.w / 2, BOX.l / 2)
    lidShape.lineTo(-BOX.w / 2, BOX.l / 2)
    lidShape.closePath()
    for (const [x, z] of HOLES) {
      const hole = new THREE.Path()
      hole.absarc(x, z, 0.085, 0, Math.PI * 2, true)
      lidShape.holes.push(hole)
    }
    const lid = new THREE.Mesh(new THREE.ExtrudeGeometry(lidShape, { depth: 0.04, bevelEnabled: false }).rotateX(Math.PI / 2), wood)
    lid.position.y = BOX.h + 0.04
    box.add(lid)
    const brass = new THREE.MeshStandardMaterial({ color: 0xc59a3c, roughness: 0.35, metalness: 0.8 })
    HOLES.forEach(([x, z], i) => {
      const pit = new THREE.Mesh(new THREE.CircleGeometry(0.085, 18).rotateX(-Math.PI / 2), black)
      pit.position.set(x, BOX.h - 0.36, z)
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.087, 0.012, 6, 20).rotateX(Math.PI / 2), brass)
      rim.position.set(x, BOX.h + 0.045, z)
      box.add(pit, rim)
      const rat = new Rat(i)
      rat.group.position.set(x, BOX.h + RAT_DOWN, z)
      box.add(rat.group)
      this.rats.push(rat)
    })
    // Painted on the side: WHACK-A-RAT.
    const paint = document.createElement('canvas')
    paint.width = 512
    paint.height = 128
    const p = paint.getContext('2d')!
    p.fillStyle = '#e8dcc0'
    p.font = 'bold 76px Georgia, serif'
    p.textAlign = 'center'
    p.fillText('WHACK-A-RAT', 256, 92, 490)
    const paintTexture = new THREE.CanvasTexture(paint)
    paintTexture.colorSpace = THREE.SRGBColorSpace
    const painted = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshStandardMaterial({ map: paintTexture, transparent: true, roughness: 0.9 }))
    painted.rotation.y = -Math.PI / 2
    painted.position.set(-BOX.w / 2 - 0.021, 0.45, 0)
    box.add(painted)

    // The big red button on the aft end.
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.04, 20), dark)
    base.position.set(0, BOX.h + 0.06, BOX.l / 2 - 0.12)
    this.button = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 20), new THREE.MeshStandardMaterial({ color: 0xd8261e, roughness: 0.4, emissive: 0x400000 }))
    this.button.position.set(0, BOX.h + 0.09, BOX.l / 2 - 0.12)
    box.add(base, this.button)

    // Four belaying pins on pegs down the starboard side.
    for (let i = 0; i < 4; i++) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6).rotateZ(Math.PI / 2), dark)
      const z = -0.5 + i * 0.33
      peg.position.set(BOX.w / 2 + 0.04, BOX.h - 0.12, z)
      box.add(peg)
      const club = new Club(box, new THREE.Vector3(BOX.w / 2 + 0.07, BOX.h - 0.12, z))
      this.clubs.push(grab.add(club))
    }

    // The score board on a post at the forward end, facing aft.
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.9, 0.08), wood)
    post.position.set(0, 0.95, -BOX.l / 2 - 0.15)
    box.add(post)
    this.board.width = 512
    this.board.height = 256
    this.boardTexture = new THREE.CanvasTexture(this.board)
    this.boardTexture.colorSpace = THREE.SRGBColorSpace
    const slate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: this.boardTexture, fog: false }))
    slate.position.set(0, 1.95, -BOX.l / 2 - 0.1)
    box.add(slate)
    this.sign.mesh.position.set(0, 1.25, BOX.l / 2 + 0.25)
    box.add(this.sign.mesh)
    this.sign.set([
      { text: 'Whack-a-Rat', size: 44, bold: true, color: '#f2b64a' },
      { text: 'Grab a belaying pin from the side of the box', size: 25 },
      { text: 'Slap the red button, then bonk the rats!', size: 25 },
      { text: '30 seconds · the whole crew can play', size: 22, color: '#b9c7cf' },
    ])
    this.drawBoard()
  }

  get running(): boolean {
    return !this.finished
  }

  get score(): number {
    return this.hits.size
  }

  /** A round starts (here, or a crewmate pressed the button). */
  start(seed: number, startAt: number): void {
    // An old round from before we got here: nothing to play.
    if (this.ctx.now() - startAt > (ROUND_SECONDS + 5) * 1000) return
    this.pops = makeSchedule(seed)
    this.startAt = startAt
    this.hits.clear()
    this.finished = false
    this.lastScore = -1
    this.ctx.audio.play('whistle', this.button.getWorldPosition(this.v), 0.6)
  }

  /** A crewmate bonked rat `index` of the round starting at `startAt`. */
  hitRemote(index: number, startAt: number): void {
    if (startAt !== this.startAt || this.hits.has(index)) return
    this.bonk(index, null)
  }

  update(dt: number, hands: Hand[], camera: THREE.Camera): void {
    this.sign.face(camera)
    this.buttonCooldown = Math.max(0, this.buttonCooldown - dt)
    for (const club of this.clubs) club.track(dt)
    // The button: touch it (with a hand or a pin) to start a round.
    if (this.finished && this.buttonCooldown === 0) {
      const at = this.button.getWorldPosition(this.v)
      const presser = hands.find((h) => h.connected && (h.worldPos(new THREE.Vector3()).distanceTo(at) < 0.09 || this.clubs.some((c) => c.holder === h && c.head.distanceTo(at) < 0.1)))
      if (presser) {
        this.buttonCooldown = 1
        presser.pulse(0.5, 60)
        this.ctx.audio.play('click', at)
        const seed = Math.floor(Math.random() * 1e9)
        const startAt = this.ctx.now() + COUNTDOWN * 1000
        this.start(seed, startAt)
        this.onStart(seed, startAt)
      }
    }
    this.button.position.y = BOX.h + (this.finished ? 0.09 : 0.075)

    const elapsed = (this.ctx.now() - this.startAt) / 1000
    // Which rats are up.
    const up = new Map<number, number>()
    if (!this.finished && elapsed >= 0) {
      this.pops.forEach((p, i) => {
        if (elapsed >= p.t && elapsed < p.t + p.duration && !this.hits.has(i)) up.set(p.hole, i)
      })
    }
    for (const rat of this.rats) {
      const pop = up.get(rat.hole)
      rat.update(dt, pop !== undefined)
      rat.pop = pop ?? -1
    }
    // Bonks: a pin you hold, swung into a rat that's up.
    if (!this.finished && elapsed >= 0) {
      for (const club of this.clubs) {
        if (!club.holder || club.speed < HIT_SPEED) continue
        for (const rat of this.rats) {
          if (rat.pop < 0 || rat.height < 0.5) continue
          if (club.head.distanceTo(rat.head(this.v)) > HIT_REACH) continue
          const i = rat.pop
          this.bonk(i, club.holder)
          this.onHit(i, this.startAt)
        }
      }
    }
    if (!this.finished && elapsed > ROUND_SECONDS) {
      this.finished = true
      this.best = Math.max(this.best, this.score)
      this.ctx.audio.play('pop', this.button.getWorldPosition(this.v), 0.8)
    }
    this.drawBoard(elapsed)
  }

  private bonk(index: number, by: Hand | null): void {
    this.hits.add(index)
    const rat = this.rats.find((r) => r.pop === index) ?? this.rats[this.pops[index]?.hole ?? 0]
    rat.whack()
    const at = rat.head(new THREE.Vector3())
    this.ctx.audio.play('thud', at, 0.9)
    this.ctx.audio.play('squeak', at, 0.8)
    this.ctx.sparks.emit({ position: at, velocity: new THREE.Vector3(0, 1.4, 0), spread: 1.6, color: 0xffe066, size: 0.05, life: 0.5, count: 10 })
    by?.pulse(0.9, 80)
  }

  private drawBoard(elapsed = -99): void {
    const counting = !this.finished && elapsed < 0
    const left = this.finished ? 0 : Math.max(0, Math.ceil(ROUND_SECONDS - elapsed))
    const key = `${this.finished}|${this.score}|${this.best}|${counting ? Math.ceil(-elapsed) : left}`
    if (key === this.drawKey) return
    this.drawKey = key
    const ctx = this.board.getContext('2d')!
    ctx.fillStyle = '#2b2f2c'
    ctx.fillRect(0, 0, 512, 256)
    ctx.strokeStyle = '#8a5a2b'
    ctx.lineWidth = 14
    ctx.strokeRect(7, 7, 498, 242)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#f2b64a'
    ctx.font = 'bold 40px Georgia, serif'
    ctx.fillText('WHACK-A-RAT', 256, 58)
    ctx.fillStyle = '#efeee6'
    if (counting) {
      ctx.font = 'bold 96px Georgia, serif'
      ctx.fillText(String(Math.ceil(-elapsed)), 256, 170)
    } else if (!this.finished) {
      ctx.font = 'bold 64px Georgia, serif'
      ctx.fillText(`${this.score} rats`, 256, 140)
      ctx.font = '36px Georgia, serif'
      ctx.fillStyle = left <= 5 ? '#ff6b5a' : '#c9c8bd'
      ctx.fillText(`0:${String(left).padStart(2, '0')}`, 256, 200)
    } else {
      ctx.font = '34px Georgia, serif'
      ctx.fillText(this.lastScore >= 0 || this.score > 0 ? `Last round: ${this.score} rats` : 'Hit the red button to play', 256, 130)
      ctx.fillStyle = '#ffd166'
      ctx.fillText(`Best this voyage: ${this.best}`, 256, 190)
      this.lastScore = this.score
    }
    this.boardTexture.needsUpdate = true
  }
}

/** A rat in a hole: pops up, looks about, ducks, or goes down seeing stars when bonked. */
class Rat {
  readonly group = new THREE.Group()
  /** Which pop of the round it's showing (-1: none). */
  pop = -1
  /** 0 down in its hole, 1 fully up. */
  height = 0
  private dazed = 0
  private readonly body = new THREE.Group()
  private time = Math.random() * 10

  constructor(readonly hole: number) {
    const fur = new THREE.MeshStandardMaterial({ color: 0x6f6660, roughness: 0.95 })
    const pink = new THREE.MeshStandardMaterial({ color: 0xe8a0a8, roughness: 0.8 })
    const eye = new THREE.MeshBasicMaterial({ color: 0x0a0a0a })
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.1, 4, 10), fur)
    torso.position.y = 0.07
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), fur)
    head.position.set(0, 0.16, 0.02)
    head.scale.set(1, 0.95, 1.25)
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), pink)
    nose.position.set(0, 0.155, 0.078)
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CircleGeometry(0.022, 12), pink)
      ear.position.set(s * 0.032, 0.205, 0.0)
      ear.rotation.y = s * 0.3
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), eye)
      e.position.set(s * 0.02, 0.175, 0.06)
      const whisker = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.07, 3).rotateZ(Math.PI / 2), eye)
      whisker.position.set(s * 0.04, 0.152, 0.066)
      this.body.add(ear, e, whisker)
    }
    this.body.add(torso, head, nose)
    this.group.add(this.body)
  }

  /** Where its head is (world). */
  head(target: THREE.Vector3): THREE.Vector3 {
    return this.body.localToWorld(target.set(0, 0.16, 0.02))
  }

  whack(): void {
    this.dazed = 0.5
  }

  update(dt: number, up: boolean): void {
    this.time += dt
    this.dazed = Math.max(0, this.dazed - dt)
    const want = up && this.dazed === 0 ? 1 : 0
    // Quick up, quicker down (and squashed flat when bonked).
    this.height += THREE.MathUtils.clamp(want - this.height, -dt * 9, dt * 7)
    this.group.position.y = BOX.h + THREE.MathUtils.lerp(RAT_DOWN, RAT_UP, this.height)
    this.body.scale.y = this.dazed > 0 ? 0.6 : 1
    // Looking about while it's up.
    this.body.rotation.y = Math.sin(this.time * 3 + this.hole) * 0.6 * this.height
  }
}

/** A belaying pin: a wooden club to bonk rats with. Hangs on a peg; grab it by the handle. */
class Club implements Interactable, HeldSyncable {
  readonly object = new THREE.Group()
  holder: Hand | null = null
  takenElsewhere = false
  /** Where the fat end is (world), and how fast it's moving (m/s). */
  readonly head = new THREE.Vector3()
  speed = 0
  private readonly prev = new THREE.Vector3()
  private readonly v = new THREE.Vector3()

  constructor(
    private readonly home: THREE.Object3D,
    private readonly homePos: THREE.Vector3,
  ) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.7 })
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.16, 8), wood)
    handle.position.y = 0.08
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.22, 12), wood)
    barrel.position.y = 0.27
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), wood)
    knob.position.y = -0.005
    this.object.add(handle, barrel, knob)
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

  grabGap(point: THREE.Vector3): number {
    if (this.holder) return Infinity
    return point.distanceTo(this.object.localToWorld(this.v.set(0, 0.1, 0))) - 0.08
  }

  grab(hand: Hand): void {
    this.holder = hand
    hand.grip.add(this.object)
    // Held by the handle, the fat end forward and up, like a hammer.
    this.object.position.set(0, -0.02, 0.03)
    this.object.rotation.set(-Math.PI / 2 + 0.5, 0, 0)
    hand.pulse(0.3, 30)
    this.object.localToWorld(this.prev.set(0, 0.3, 0))
    this.speed = 0
  }

  release(hand: Hand): void {
    if (hand !== this.holder) return
    this.holder = null
    this.goHome()
  }

  setHighlight(): void {}

  /** Keep up with where the fat end is and how fast it's going. */
  track(dt: number): void {
    this.object.localToWorld(this.head.set(0, 0.3, 0))
    this.speed = dt > 0 ? this.head.distanceTo(this.prev) / dt : 0
    this.prev.copy(this.head)
  }

  private goHome(): void {
    this.home.add(this.object)
    this.object.position.copy(this.homePos)
    // Hanging down off its peg.
    this.object.rotation.set(Math.PI, 0, 0)
    this.object.position.y += 0.02
  }
}
