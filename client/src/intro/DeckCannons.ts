import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { GrabSystem, Interactable } from '../interaction/GrabSystem'
import { Label } from '../ui/Label'
import { DECK_Y, type Galleon } from '../world/ship/Galleon'
import { SWIVEL_SPOT } from './Quarterdeck'

const GRAVITY = 9.8
/** Seconds of fizzing fuse between touching the flame to the hole and the bang. */
const FUSE_SECONDS = 1.1
/** Seconds before the same gun can fire again (swabbing and reloading, off-screen). */
const RELOAD_SECONDS = 5
const BALL_SPEED = 55
const BALL_LIFE = 8
/** A match burns this long once struck. */
const MATCH_SECONDS = 40
/** Flame this close to a touch hole lights the fuse. */
const TOUCH_REACH = 0.12
/** Striking: the match head drags across the box this fast (m/s), this close to it. */
const STRIKE_SPEED = 0.7
const STRIKE_REACH = 0.07
/** Where the match box sits (ship-local): on a small crate midships, starboard of the net. */
export const MATCH_CRATE = new THREE.Vector3(1.7, DECK_Y, 3.0)

export interface CannonContext {
  audio: AudioSystem
  smoke: Particles
  fire: Particles
  splash: Particles
  debris: Particles
  /** Does a cannonball moving from `a` to `b` (world) hit something (`swivel`: fired by the swivel gun)? Returns the hit point, if any. */
  hitTest: (a: THREE.Vector3, b: THREE.Vector3, swivel: boolean) => THREE.Vector3 | null
  /** This player fired cannon `index` (tell the crew). */
  onFire: (index: number) => void
  /** What the quarterdeck's swivel gun stays trained on (world): the other ship. */
  swivelTarget: () => THREE.Vector3
}

interface Gun {
  touchHole: THREE.Vector3
  muzzle: THREE.Vector3
  side: 1 | -1
  fuse: number
  reload: number
  /** Fired by this player (only their shots can hit something and count). */
  mine: boolean
  /** The quarterdeck's swivel gun: turns to follow its target, and lobs its ball onto it. */
  swivel?: SwivelGun
}

interface Ball {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  age: number
  mine: boolean
  /** The swivel gun's ball: seconds until it lands on its (moving) target. */
  landIn?: number
}

// The galleon's six deck cannons, fired the old way: take a match from the box on the crate, strike
// it (pull the trigger, or drag it across the box), and touch the flame to the touch hole on top of
// a cannon's breech. The fuse fizzes, then BOOM: the ball flies out over the water.
export class DeckCannons {
  readonly box: MatchBox
  /** The quarterdeck's swivel gun (padlocked until someone finds the key). */
  readonly swivel: SwivelGun
  private readonly guns: Gun[]
  private readonly balls: Ball[] = []
  private readonly sign = new Label({ width: 0.75, canvasWidth: 640, canvasHeight: 380, billboard: true })
  private readonly ballGeometry = new THREE.SphereGeometry(0.09, 10, 8)
  private readonly ballMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.5, metalness: 0.5 })
  private readonly v = new THREE.Vector3()
  private readonly w = new THREE.Vector3()

  constructor(
    private readonly root: THREE.Object3D,
    private readonly ship: Galleon,
    grab: GrabSystem,
    private readonly ctx: CannonContext,
  ) {
    this.guns = ship.cannons.map((c) => ({ ...c, fuse: -1, reload: 0, mine: false }))
    const swivel = (this.swivel = new SwivelGun(ship.shake, SWIVEL_SPOT))
    this.guns.push({ touchHole: new THREE.Vector3(), muzzle: new THREE.Vector3(), side: 1, fuse: -1, reload: 0, mine: false, swivel })

    const crate = new THREE.Group()
    crate.position.copy(MATCH_CRATE)
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.85 })
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.5), wood)
    box.position.y = 0.35
    crate.add(box)
    ship.shake.add(crate)
    this.box = grab.add(new MatchBox(crate, ctx.audio))
    this.sign.mesh.position.set(0, 1.65, 0)
    crate.add(this.sign.mesh)
    this.sign.set([
      { text: 'Cannons', size: 42, bold: true, color: '#f2b64a' },
      { text: '1. Grip a match from the box', size: 27 },
      { text: '2. Pull the trigger to strike it (or drag it across the box)', size: 27 },
      { text: '3. Touch the flame to the hole on top of a cannon’s back end', size: 27 },
      { text: 'Stand clear!', size: 26, color: '#ff9a8a', bold: true },
    ])
  }

  update(dt: number, camera: THREE.Camera): void {
    this.sign.face(camera)
    const flame = this.box.flameTip(this.v)
    this.ship.shake.updateWorldMatrix(true, false)
    for (const gun of this.guns) {
      if (!gun.swivel) continue
      gun.swivel.aim(this.ctx.swivelTarget(), dt, camera)
      gun.swivel.points(this.ship.shake, gun.touchHole, gun.muzzle)
    }
    this.guns.forEach((gun, i) => {
      gun.reload = Math.max(0, gun.reload - dt)
      const hole = this.ship.shake.localToWorld(this.w.copy(gun.touchHole))
      if (gun.swivel?.locked && flame && flame.distanceTo(hole) < TOUCH_REACH * 2) {
        gun.swivel.nag(this.ctx.audio)
        return
      }
      if (gun.fuse < 0 && gun.reload === 0 && flame && flame.distanceTo(hole) < TOUCH_REACH) {
        gun.fuse = FUSE_SECONDS
        gun.mine = true
        this.box.holder?.pulse(0.3, 60)
        this.ctx.audio.play('pour', hole, 0.5)
      }
      if (gun.fuse >= 0) {
        gun.fuse -= dt
        // Sparks spit from the touch hole while the fuse burns.
        this.ctx.fire.emit({ position: hole, velocity: new THREE.Vector3(0, 1.2, 0), spread: 0.8, color: 0xffb347, size: 0.03, life: 0.25, count: 2 })
        if (gun.fuse < 0) this.fire(i)
      }
    })
    this.updateBalls(dt)
  }

  /** Another crew member fired cannon `index`: show and hear it (their ball can't hit anything here). */
  fireRemote(index: number): void {
    const gun = this.guns[index]
    if (!gun) return
    gun.mine = false
    this.fire(index)
  }

  private fire(index: number): void {
    const gun = this.guns[index]
    gun.fuse = -1
    gun.reload = RELOAD_SECONDS
    const muzzle = this.ship.shake.localToWorld(gun.muzzle.clone())
    const quat = this.ship.shake.getWorldQuaternion(new THREE.Quaternion())
    const out = new THREE.Vector3(gun.side, 0, 0).applyQuaternion(quat)
    // The swivel gun lobs its ball straight onto its target.
    const lob = gun.swivel ? lobVelocity(muzzle, this.ctx.swivelTarget()) : null
    gun.swivel?.fired()
    if (lob) out.copy(lob).normalize()
    this.ctx.audio.play('cannon', muzzle)
    this.ctx.fire.emit({ position: muzzle, velocity: out.clone().multiplyScalar(6), spread: 1.5, color: 0xffc56b, size: 0.9, endSize: 0.2, life: 0.15, count: 6 })
    this.ctx.smoke.emit({ position: muzzle, velocity: out.clone().multiplyScalar(4).setY(0.8), spread: 1.6, color: 0xc9c2b8, size: 0.5, endSize: 3, life: 3.5, count: 22, alpha: 0.7 })
    const mesh = new THREE.Mesh(this.ballGeometry, this.ballMaterial)
    mesh.position.copy(muzzle)
    this.root.add(mesh)
    const velocity = lob ?? out.multiplyScalar(BALL_SPEED)
    if (!lob) velocity.y += 3
    this.balls.push({ mesh, velocity, age: 0, mine: gun.mine, landIn: lob ? lobTime(muzzle.distanceTo(this.ctx.swivelTarget())) : undefined })
    if (gun.mine) this.ctx.onFire(index)
    gun.mine = false
  }

  private updateBalls(dt: number): void {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i]
      ball.age += dt
      const from = this.v.copy(ball.mesh.position)
      // The swivel gun's ball follows its target (the ships move while it flies), so it always lands.
      if (ball.landIn !== undefined) {
        ball.landIn = Math.max(0.05, ball.landIn - dt)
        ball.velocity.copy(lobVelocity(from, this.ctx.swivelTarget(), ball.landIn + dt))
      }
      ball.mesh.position.addScaledVector(ball.velocity, dt)
      ball.mesh.position.y -= 0.5 * GRAVITY * dt * dt
      ball.velocity.y -= GRAVITY * dt
      const to = ball.mesh.position
      const hit = ball.mine ? this.ctx.hitTest(from, to, ball.landIn !== undefined) : null
      let done = ball.age > BALL_LIFE
      if (hit) {
        // A hit: a few splinters and a thump (she's built to take it, and she'll answer).
        this.ctx.debris.emit({ position: hit, velocity: new THREE.Vector3(0, 1.5, 0), spread: 1.5, color: 0x5b3a21, size: 0.12, life: 1.4, count: 8 })
        this.ctx.audio.play('thud', hit, 0.8)
        done = true
      } else if (to.y < 0) {
        this.ctx.splash.emit({ position: to.clone().setY(0.1), velocity: new THREE.Vector3(0, 7, 0), spread: 2.5, color: 0xeaf6ff, size: 0.35, life: 1.6, count: 30 })
        this.ctx.audio.play('bigSplash', to)
        done = true
      }
      if (done) {
        ball.mesh.removeFromParent()
        this.balls.splice(i, 1)
      }
    }
  }
}

/** Flight time for a lob over this distance. */
const lobTime = (distance: number) => THREE.MathUtils.clamp(distance / 70, 0.6, 5)

/** Launch velocity that carries a ball from `from` onto `to` in `t` seconds (a gently arcing flight). */
function lobVelocity(from: THREE.Vector3, to: THREE.Vector3, t = lobTime(from.distanceTo(to))): THREE.Vector3 {
  return to.clone().sub(from).divideScalar(t).add(new THREE.Vector3(0, 0.5 * GRAVITY * t, 0))
}

// A swivel gun on a post at the quarterdeck rail: it turns on its own to stay trained on the other
// ship. Light it like the deck cannons (a lit match to the touch hole) and it lobs a ball onto her.
export class SwivelGun {
  /** Padlocked over the touch hole: the key has to be found first. */
  locked = true
  /** Someone held a flame to the locked gun. */
  onNag: () => void = () => {}
  private readonly padlock = new THREE.Group()
  private dropT = -1
  private nagCooldown = 0
  private readonly yawPivot = new THREE.Group()
  private readonly barrel = new THREE.Group()
  private readonly sign = new Label({ width: 0.55, canvasWidth: 560, canvasHeight: 240, billboard: true })
  private readonly local = new THREE.Vector3()
  private yaw = 0
  private pitch = 0

  constructor(parent: THREE.Object3D, at: THREE.Vector3) {
    const group = new THREE.Group()
    group.position.copy(at)
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1b, roughness: 0.85 })
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.45, metalness: 0.7 })
    const bronze = new THREE.MeshStandardMaterial({ color: 0x8a6a2e, roughness: 0.35, metalness: 0.8 })
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.95, 10), wood)
    post.position.y = 0.475
    group.add(post)
    this.yawPivot.position.y = 1.0
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.08), iron)
    for (const x of [-0.12, 0.12]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.06), iron)
      arm.position.set(x, 0.07, 0)
      this.yawPivot.add(arm)
    }
    this.yawPivot.add(yoke)
    this.barrel.position.y = 0.12
    // Bronze barrel along -z: muzzle forward, a knob (cascabel) behind the breech.
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.95, 14).rotateX(Math.PI / 2), bronze)
    tube.position.z = -0.12
    const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.014, 6, 14), bronze)
    muzzleRing.position.z = -0.59
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), bronze)
    knob.position.z = 0.4
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8), iron)
    hole.position.set(0, 0.085, 0.27)
    this.barrel.add(tube, muzzleRing, knob, hole)
    // An iron hasp over the touch hole, and a padlock hanging from it.
    const hasp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.12), iron)
    hasp.position.set(0, 0.095, 0.27)
    const brassy = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.4, metalness: 0.8 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.03), brassy)
    body.position.y = -0.05
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 12, Math.PI), iron)
    const keyhole = new THREE.Mesh(new THREE.CircleGeometry(0.008, 8), new THREE.MeshBasicMaterial({ color: 0x111111 }))
    keyhole.position.set(0, -0.05, 0.016)
    this.padlock.add(hasp, body, shackle, keyhole)
    this.padlock.position.set(0.075, 0.05, 0.27)
    this.padlock.rotation.y = Math.PI / 2
    this.barrel.add(this.padlock)
    this.yawPivot.add(this.barrel)
    group.add(this.yawPivot)
    this.sign.mesh.position.set(0, 1.75, 0)
    group.add(this.sign.mesh)
    this.sign.set([
      { text: '⚠ DON\'T LIGHT THIS! ⚠', size: 44, bold: true, color: '#ff5a4a' },
      { text: 'Captain\'s orders: it stays trained on that ship', size: 24 },
      { text: 'Padlocked, and the key put well out of the way', size: 24, color: '#d8cfb8' },
    ])
    parent.add(group)
  }

  /** The padlock (world), where the key goes. */
  get lockPoint(): THREE.Vector3 {
    return this.padlock.localToWorld(new THREE.Vector3(0, -0.05, 0))
  }

  /** The key turns: the padlock drops away (`now`: catching up, no fall). */
  unlock(now = false): void {
    if (!this.locked) return
    this.locked = false
    if (now) this.padlock.visible = false
    else this.dropT = 0
  }

  /** Fired: the warning is moot now, so take it down (it would hide the enemy). */
  fired(): void {
    this.sign.mesh.visible = false
  }

  /** A flame held to the locked touch hole. */
  nag(audio: AudioSystem): void {
    if (this.nagCooldown > 0) return
    this.nagCooldown = 3
    audio.play('click', this.lockPoint, 0.6)
    this.onNag()
  }

  /** Turn (smoothly) to point along the lob that lands on `target` (world). */
  aim(target: THREE.Vector3, dt: number, camera: THREE.Camera): void {
    this.sign.face(camera)
    this.nagCooldown = Math.max(0, this.nagCooldown - dt)
    if (this.dropT >= 0 && this.dropT < 1) {
      // The opened padlock tumbles off onto the deck.
      this.dropT = Math.min(1, this.dropT + dt / 0.8)
      this.padlock.position.y = 0.05 - this.dropT * this.dropT * 1.1
      this.padlock.rotation.z = this.dropT * 2
      if (this.dropT === 1) this.padlock.visible = false
    }
    const muzzle = this.barrel.localToWorld(this.local.set(0, 0, -0.6))
    const dir = lobVelocity(muzzle, target)
    // Into the post's frame (the ship may be turning or shaking).
    const parent = this.yawPivot.parent!
    parent.updateWorldMatrix(true, false)
    const q = parent.getWorldQuaternion(new THREE.Quaternion()).invert()
    dir.applyQuaternion(q)
    const yaw = Math.atan2(-dir.x, -dir.z)
    const pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z))
    const k = 1 - Math.exp(-4 * dt)
    let dy = yaw - this.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    this.yaw += dy * k
    this.pitch += (THREE.MathUtils.clamp(pitch, -0.3, 0.9) - this.pitch) * k
    this.yawPivot.rotation.y = this.yaw
    this.barrel.rotation.x = this.pitch
  }

  /** Current touch hole and muzzle, in `frame`'s space (ship-local). */
  points(frame: THREE.Object3D, touchHole: THREE.Vector3, muzzle: THREE.Vector3): void {
    this.barrel.updateWorldMatrix(true, false)
    frame.worldToLocal(this.barrel.localToWorld(touchHole.set(0, 0.1, 0.27)))
    frame.worldToLocal(this.barrel.localToWorld(muzzle.set(0, 0, -0.62)))
  }
}

// The match box on the crate: grip it to take a match. The match stays in your hand until you let
// go (then it's dropped and snuffed).
export class MatchBox implements Interactable {
  readonly object: THREE.Group
  holder: Hand | null = null
  private readonly match = new THREE.Group()
  private readonly flame: THREE.Sprite
  private readonly head: THREE.Mesh
  private readonly home: THREE.Vector3
  private burning = 0
  private readonly materials: THREE.MeshStandardMaterial[] = []
  private readonly prevTip = new THREE.Vector3()
  private readonly v = new THREE.Vector3()
  private time = 0

  constructor(
    crate: THREE.Object3D,
    private readonly audio: AudioSystem,
  ) {
    // The box: red with a dark striker strip along the side.
    this.object = new THREE.Group()
    const card = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.7 })
    this.materials.push(card)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.09), card)
    const striker = new THREE.Mesh(new THREE.BoxGeometry(0.142, 0.03, 0.005), new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 1 }))
    striker.position.z = 0.047
    this.object.add(body, striker)
    this.object.position.set(0, 0.725, 0)
    crate.add(this.object)
    this.home = this.object.position.clone()

    // The match you hold: a stick with a red head, and a flame sprite on the head once lit.
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.09, 6), new THREE.MeshStandardMaterial({ color: 0xe8d7a8, roughness: 0.9 }))
    stick.rotation.x = Math.PI / 2
    stick.position.z = -0.045
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc0271d, roughness: 0.6 }))
    this.head.position.z = -0.092
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeFlameTexture(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
    this.flame.scale.set(0.03, 0.05, 1)
    this.flame.position.set(0, 0.012, -0.095)
    this.flame.visible = false
    this.match.add(stick, this.head, this.flame)
  }

  get lit(): boolean {
    return this.holder !== null && this.burning > 0
  }

  /** The lit match's flame (world), or null. */
  flameTip(target: THREE.Vector3): THREE.Vector3 | null {
    return this.lit ? this.flame.getWorldPosition(target) : null
  }

  grabGap(point: THREE.Vector3, hand: Hand): number {
    if (this.holder === hand) return Infinity
    return point.distanceTo(this.object.getWorldPosition(this.v)) - 0.1
  }

  grab(hand: Hand): void {
    // Pulled from a distance: the box goes back on the crate; you keep a match.
    this.object.position.copy(this.home)
    if (this.holder && this.holder !== hand) this.holder.held = null
    this.holder = hand
    this.burning = 0
    this.flame.visible = false
    this.head.visible = true
    hand.ray.add(this.match)
    this.match.position.set(0, -0.01, 0)
    this.match.quaternion.identity()
    this.match.updateWorldMatrix(true, true)
    this.head.getWorldPosition(this.prevTip)
    hand.pulse(0.15, 15)
  }

  release(hand: Hand): void {
    if (hand !== this.holder) return
    this.holder = null
    this.burning = 0
    this.match.removeFromParent()
  }

  setHighlight(on: boolean): void {
    for (const m of this.materials) m.emissive.setHex(on ? 0x2e7896 : 0x000000)
  }

  update(dt: number): void {
    this.time += dt
    const hand = this.holder
    if (!hand) return
    const tip = this.head.getWorldPosition(this.v)
    if (this.burning <= 0) {
      // Strike: the trigger, or the head dragged quickly across the box.
      const speed = tip.distanceTo(this.prevTip) / Math.max(dt, 1e-3)
      const nearBox = tip.distanceTo(this.object.getWorldPosition(new THREE.Vector3())) < 0.07 + STRIKE_REACH
      if (hand.triggerPressed || (nearBox && speed > STRIKE_SPEED)) this.strike(hand)
    } else {
      this.burning -= dt
      // Flicker.
      const f = 1 + Math.sin(this.time * 31) * 0.12 + Math.sin(this.time * 17) * 0.08
      this.flame.scale.set(0.03 * f, 0.05 * f, 1)
      if (this.burning <= 0) {
        this.flame.visible = false
        this.head.visible = false
      }
    }
    this.prevTip.copy(tip)
  }

  private strike(hand: Hand): void {
    this.burning = MATCH_SECONDS
    this.flame.visible = true
    hand.pulse(0.4, 40)
    this.audio.play('crack', this.v, 0.25)
  }
}

function makeFlameTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 96
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(32, 62, 2, 32, 56, 34)
  g.addColorStop(0, 'rgba(255,255,220,1)')
  g.addColorStop(0.35, 'rgba(255,190,60,0.9)')
  g.addColorStop(0.7, 'rgba(255,90,20,0.35)')
  g.addColorStop(1, 'rgba(255,60,0,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(32, 56, 22, 40, 0, 0, Math.PI * 2)
  ctx.fill()
  return new THREE.CanvasTexture(canvas)
}
