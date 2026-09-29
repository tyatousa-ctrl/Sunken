import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'
import { Label } from '../ui/Label'
import { DECK_Y, halfWidthAt } from '../world/ship/Galleon'

export const SWORD_COUNT = 4
/** Blade from just past the guard to the tip (sword-local; the blade points along -z). */
const BLADE_BASE = new THREE.Vector3(0, 0, -0.1)
const BLADE_TIP = new THREE.Vector3(0, 0, -0.86)
/** Blades this close count as touching (a blade's width, more or less). */
const CLASH_DISTANCE = 0.045
/** A clash needs one of the blades moving at least this fast (tip, m/s): resting blades don't ring. */
const CLASH_SPEED = 0.8
/** A cut needs a real swing (tip speed, m/s). */
const CUT_SPEED = 1.4
const CUT_COOLDOWN = 0.35
const SWISH_SPEED = 6
/** Positions tested between frames, so a fast swing can't pass clean through another blade. */
const SUBSTEPS = 4
const HIGHLIGHT = new THREE.Color(0x2e7896)
const BLACK = new THREE.Color(0x000000)
/** Where the rack stands: against the port rail between the masts (ship-local). */
const RACK_Z = -6

/** Something a blade can cut: a crew member, bot or sailor, as a few spheres. */
export interface SwordTarget {
  /** "self", a session id, a bot id or "sailor:<name>" (a sword never cuts whoever holds it). */
  id: string
  spheres: { center: THREE.Vector3; radius: number }[]
  /** Only for you: something cut you (a nudge in both hands). */
  onHit?: () => void
}

export interface SwordWorld {
  audio: AudioSystem
  /** Everyone the blades could cut right now. */
  targets: () => SwordTarget[]
  /** The deck (or other floor) under a point, for blood drops to land on. */
  floor: (x: number, z: number) => number | null
}

// Four cutlasses in a rack on the deck. Grip one to draw it; blades that meet ring out with a clang,
// a shower of sparks and a jolt in the hand; a swipe across somebody leaves a little red blood
// dripping to the deck. Everyone's screen works this out for itself from where the swords are, so
// it needs no messages of its own: only who holds which sword is shared (claims, like the guns).
export class Swords {
  readonly swords: Sword[] = []
  private readonly sparks = new Particles({ max: 240, gravity: -6, drag: 0.8, blending: THREE.AdditiveBlending })
  private readonly blood = new Particles({ max: 400, gravity: -9.8, drag: 0.3 })
  private readonly splats: Splat[] = []
  private readonly drips: { at: THREE.Vector3; left: number; next: number }[] = []
  private readonly touching = new Set<string>()
  private readonly cutCooldowns = new Map<string, number>()
  private readonly sign = new Label({ width: 0.7, canvasWidth: 600, canvasHeight: 300, billboard: true })
  private splatIndex = 0
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly c = new THREE.Vector3()
  private readonly d = new THREE.Vector3()
  private readonly p = new THREE.Vector3()
  private readonly q = new THREE.Vector3()

  constructor(
    rackParent: THREE.Object3D,
    private readonly root: THREE.Object3D,
    private readonly world: SwordWorld,
  ) {
    const rack = new THREE.Group()
    rack.position.set(-(halfWidthAt(RACK_Z) - 0.4), DECK_Y, RACK_Z)
    // Faces inboard (+x), swords in a row along the rail.
    rack.rotation.y = Math.PI / 2
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: 0.85 })
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.4, metalness: 0.8 })
    for (const x of [-0.72, 0.72]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.05, 0.07), wood)
      post.position.set(x, 0.525, 0)
      rack.add(post)
    }
    // Two slotted boards the blades hang through, hilts up at waist height.
    for (const y of [0.88, 0.3]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.16), wood)
      board.position.y = y
      rack.add(board)
    }
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.02), brass)
    trim.position.set(0, 0.91, 0.08)
    rack.add(trim)
    rackParent.add(rack)

    this.sign.mesh.position.set(0, 1.5, 0)
    rack.add(this.sign.mesh)
    this.sign.set([
      { text: 'Cutlasses', size: 40, bold: true, color: '#f2b64a' },
      { text: 'Grip a hilt to draw a sword', size: 28 },
      { text: 'Cross blades with a crewmate: they ring!', size: 28 },
      { text: 'Let go (or press A/X) and it slides back into the rack', size: 24, color: '#b9c7cf' },
    ])

    // Blades hang point-down: the sword's -z (the blade) points at the deck.
    const hanging = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
    for (let i = 0; i < SWORD_COUNT; i++) {
      const sword = new Sword(rack, new THREE.Vector3(-0.54 + i * 0.36, 0.98, 0), hanging, i, world.audio)
      this.swords.push(sword)
    }

    this.root.add(this.sparks.points, this.blood.points)
    for (let i = 0; i < 24; i++) this.splats.push(new Splat(this.root))
  }

  /** Keep the sign facing you. */
  face(camera: THREE.Camera): void {
    this.sign.face(camera)
  }

  update(dt: number, halfHeight: number): void {
    // (Each sword's own update runs with the grab system's.)
    for (const sword of this.swords) sword.measure(dt)
    this.clashes()
    this.cuts(dt)
    this.updateDrips(dt)
    for (const splat of this.splats) splat.update(dt)
    this.sparks.update(dt, halfHeight)
    this.blood.update(dt, halfHeight)
  }

  // Blade against blade: check every pair of drawn swords at a few points between last frame and this.
  private clashes(): void {
    const drawn = this.swords.filter((s) => s.drawn)
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        const s1 = drawn[i]
        const s2 = drawn[j]
        const key = `${s1.index}:${s2.index}`
        let hit = false
        for (let k = 1; k <= SUBSTEPS && !hit; k++) {
          const t = k / SUBSTEPS
          s1.bladeAt(t, this.a, this.b)
          s2.bladeAt(t, this.c, this.d)
          if (closestBetweenSegments(this.a, this.b, this.c, this.d, this.p, this.q) < CLASH_DISTANCE) hit = true
        }
        const was = this.touching.has(key)
        if (hit) this.touching.add(key)
        else this.touching.delete(key)
        if (!hit || was) continue
        const speed = Math.max(s1.tipSpeed, s2.tipSpeed)
        if (speed < CLASH_SPEED) continue
        const at = this.p.clone().lerp(this.q, 0.5)
        const strength = THREE.MathUtils.clamp(speed / 6, 0.25, 1)
        this.world.audio.play('clang', at, 0.35 + 0.65 * strength)
        this.sparks.emit({ position: at, spread: 1.2 + 1.5 * strength, count: Math.round(8 + 14 * strength), color: 0xffd27a, size: 0.018, endSize: 0.004, life: 0.3 })
        this.sparks.emit({ position: at, count: 2, color: 0xfff2c0, size: 0.07, endSize: 0.01, life: 0.06 })
        // The jolt of steel on steel, in whichever of these hands are yours.
        for (const s of [s1, s2]) s.holder?.pulse(0.55 + 0.45 * strength, 70)
      }
    }
  }

  // Blade across a body: a swing (not a resting blade) leaves a spray of blood that drips down.
  private cuts(dt: number): void {
    for (const [key, left] of this.cutCooldowns) {
      if (left - dt <= 0) this.cutCooldowns.delete(key)
      else this.cutCooldowns.set(key, left - dt)
    }
    const drawn = this.swords.filter((s) => s.drawn && s.tipSpeed > CUT_SPEED)
    if (drawn.length === 0) return
    const targets = this.world.targets()
    for (const sword of drawn) {
      for (const target of targets) {
        if (target.id === sword.ownerId) continue
        const key = `${sword.index}:${target.id}`
        if (this.cutCooldowns.has(key)) continue
        const hit = this.touch(sword, target)
        if (!hit) continue
        this.cutCooldowns.set(key, CUT_COOLDOWN)
        this.bleed(hit, sword)
        sword.bloody()
        sword.holder?.pulse(0.4, 50)
        target.onHit?.()
        this.world.audio.play('slash', hit, 0.6)
      }
    }
  }

  /** Where the blade meets the target this frame (the point on the body's surface), if it does. */
  private touch(sword: Sword, target: SwordTarget): THREE.Vector3 | null {
    const line = new THREE.Line3()
    for (let k = 1; k <= SUBSTEPS; k++) {
      sword.bladeAt(k / SUBSTEPS, line.start, line.end)
      for (const s of target.spheres) {
        line.closestPointToPoint(s.center, true, this.p)
        if (this.p.distanceTo(s.center) >= s.radius) continue
        // The wound faces whoever swung (blade passing right through the middle: toward the hilt).
        const out = this.p.sub(s.center)
        if (out.length() < s.radius * 0.3) out.subVectors(line.start, s.center)
        return s.center.clone().add(out.setLength(s.radius * 1.02))
      }
    }
    return null
  }

  private bleed(at: THREE.Vector3, sword: Sword): void {
    const push = sword.tipVelocity.clone().multiplyScalar(0.12).setY(0.4)
    this.blood.emit({ position: at, velocity: push, spread: 0.6, count: 12, color: 0xb00d0d, size: 0.032, endSize: 0.02, life: 0.75 })
    this.blood.emit({ position: at, velocity: push, spread: 0.35, count: 8, color: 0x6e0404, size: 0.04, endSize: 0.024, life: 0.85 })
    // A few more drops run down and fall for a second afterwards.
    this.drips.push({ at: at.clone(), left: 1.2, next: 0 })
    const floor = this.world.floor(at.x, at.z)
    if (floor !== null && at.y - floor < 2.5) {
      const splat = this.splats[this.splatIndex++ % this.splats.length]
      splat.place(this.c.set(at.x + (Math.random() - 0.5) * 0.25, floor + 0.006, at.z + (Math.random() - 0.5) * 0.25), 0.7 + Math.random() * 0.25)
    }
  }

  private updateDrips(dt: number): void {
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const drip = this.drips[i]
      drip.left -= dt
      drip.next -= dt
      if (drip.next <= 0) {
        drip.next = 0.09 + Math.random() * 0.08
        this.blood.emit({ position: drip.at, spread: 0.05, count: 1, color: 0x9a0808, size: 0.026, endSize: 0.02, life: 0.65 })
      }
      if (drip.left <= 0) this.drips.splice(i, 1)
    }
  }
}

// A pirate cutlass: brass guard and pommel, a wrapped grip, a curved-looking steel blade.
export class Sword implements Interactable {
  readonly object = new THREE.Group()
  holder: Hand | null = null
  /** Set while another crew member holds it: it rides in their hand and can't be grabbed. */
  remoteHand: THREE.Object3D | null = null
  /** Session id of whoever holds it remotely. */
  remoteOwner: string | null = null
  onGrabbed: (hand: Hand) => void = () => {}
  onReleased: () => void = () => {}
  /** Tip speed (m/s) this frame. */
  tipSpeed = 0
  readonly tipVelocity = new THREE.Vector3()

  private readonly rackPos = new THREE.Vector3()
  private readonly rackQuat = new THREE.Quaternion()
  private readonly materials: THREE.MeshStandardMaterial[] = []
  private readonly blood: THREE.Mesh
  private bloodTime = 0
  private returning = 0
  private swishCooldown = 0
  private readonly base = new THREE.Vector3()
  private readonly tip = new THREE.Vector3()
  private readonly prevBase = new THREE.Vector3()
  private readonly prevTip = new THREE.Vector3()
  private measured = false

  constructor(
    private readonly rack: THREE.Object3D,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    readonly index: number,
    private readonly audio: AudioSystem,
  ) {
    const steel = new THREE.MeshStandardMaterial({ color: 0xe4eaee, roughness: 0.3, metalness: 0.45 })
    const brass = new THREE.MeshStandardMaterial({ color: 0xc19a3e, roughness: 0.35, metalness: 0.85 })
    const leather = new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.9 })
    this.materials.push(steel, brass, leather)

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.13, 10).rotateX(Math.PI / 2), leather)
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), brass)
    pommel.position.z = 0.075
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 0.025), brass)
    guard.position.z = -0.075
    // A cup of a hand guard, curving over the knuckles.
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.007, 6, 14, Math.PI), brass)
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2)
    bow.position.set(0, 0.0, 0.0)
    bow.scale.set(1.25, 0.8, 1)
    // Blade: flat, a touch wider towards the point, ending in a clipped tip.
    const bladeShape = new THREE.Shape()
    bladeShape.moveTo(-0.016, 0)
    bladeShape.lineTo(-0.02, -0.66)
    bladeShape.quadraticCurveTo(-0.02, -0.75, 0.012, -0.78)
    bladeShape.lineTo(0.016, -0.66)
    bladeShape.lineTo(0.014, 0)
    const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.004, bevelEnabled: false })
    bladeGeometry.translate(0, 0, -0.002)
    bladeGeometry.rotateX(Math.PI / 2)
    // Edge up (+y), flat faces to the sides.
    bladeGeometry.rotateZ(Math.PI / 2)
    const blade = new THREE.Mesh(bladeGeometry, steel)
    blade.position.z = -0.085
    // A smear of blood near the point, shown for a while after a cut.
    this.blood = new THREE.Mesh(
      new THREE.PlaneGeometry(0.03, 0.22).rotateX(-Math.PI / 2).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x7a0606, roughness: 0.4, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    )
    this.blood.position.set(0.0035, 0, -0.7)
    this.blood.visible = false
    const otherSide = new THREE.Mesh(this.blood.geometry, this.blood.material)
    otherSide.position.x = -0.007
    this.blood.add(otherSide)
    this.object.add(grip, pommel, guard, bow, blade, this.blood)

    rack.add(this.object)
    this.object.position.copy(position)
    this.object.quaternion.copy(quaternion)
    this.rackPos.copy(position)
    this.rackQuat.copy(quaternion)
  }

  /** Held by someone (you or a crewmate). */
  get drawn(): boolean {
    return this.holder !== null || this.remoteHand !== null
  }

  /** Who holds it, as a target id ("self" for you). */
  get ownerId(): string | null {
    return this.holder ? 'self' : this.remoteOwner
  }

  grabGap(point: THREE.Vector3): number {
    if (this.holder || this.remoteHand) return Infinity
    // The hilt: from pommel to guard.
    return point.distanceTo(this.object.getWorldPosition(this.base)) - 0.1
  }

  grab(hand: Hand): void {
    this.holder = hand
    this.returning = 0
    hand.ray.add(this.object)
    this.object.position.set(0, -0.02, 0.03)
    this.object.quaternion.identity()
    this.measured = false
    hand.pulse(0.35, 40)
    this.audio.play('click', this.object.getWorldPosition(this.base), 0.5)
    this.onGrabbed(hand)
  }

  release(hand: Hand): void {
    if (hand !== this.holder) return
    this.holder = null
    this.rack.attach(this.object)
    this.returning = 0.45
    this.measured = false
    this.onReleased()
  }

  /** Someone else got it first (the server said no): let go. */
  forceDrop(): void {
    const hand = this.holder
    if (!hand) return
    hand.held = null
    this.release(hand)
  }

  /** Show the sword in another player's hand (or back in the rack with null). */
  setRemoteHand(hand: THREE.Object3D | null, owner: string | null): void {
    this.remoteOwner = hand ? owner : null
    if (hand === this.remoteHand) return
    this.remoteHand = hand
    this.measured = false
    if (hand) {
      hand.add(this.object)
      this.object.position.set(0, -0.02, 0.03)
      this.object.quaternion.identity()
      this.returning = 0
    } else {
      this.rack.attach(this.object)
      this.returning = 0.45
    }
  }

  setHighlight(on: boolean): void {
    for (const m of this.materials) m.emissive.copy(on ? HIGHLIGHT : BLACK)
  }

  bloody(): void {
    this.bloodTime = 8
  }

  update(dt: number): void {
    // A/X or B/Y on the hand holding it: back in the rack.
    const holder = this.holder
    if (holder && (holder.primaryPressed || holder.secondaryPressed)) {
      holder.primaryPressed = holder.secondaryPressed = false
      this.forceDrop()
    }
    if (this.bloodTime > 0) {
      this.bloodTime = Math.max(0, this.bloodTime - dt)
      this.blood.visible = this.bloodTime > 0
      ;(this.blood.material as THREE.MeshStandardMaterial).opacity = Math.min(0.9, this.bloodTime / 3)
    }
    if (this.returning > 0) {
      this.returning = Math.max(0, this.returning - dt)
      const k = 1 - Math.exp(-12 * dt)
      this.object.position.lerp(this.rackPos, k)
      this.object.quaternion.slerp(this.rackQuat, k)
      if (this.returning === 0) {
        this.object.position.copy(this.rackPos)
        this.object.quaternion.copy(this.rackQuat)
      }
    }
  }

  /** Track the blade (world) and how fast its tip moves; call once a frame after hands have moved. */
  measure(dt: number): void {
    this.prevBase.copy(this.base)
    this.prevTip.copy(this.tip)
    this.object.updateWorldMatrix(true, false)
    this.object.localToWorld(this.base.copy(BLADE_BASE))
    this.object.localToWorld(this.tip.copy(BLADE_TIP))
    if (!this.measured || !this.drawn || dt <= 0) {
      this.prevBase.copy(this.base)
      this.prevTip.copy(this.tip)
      this.measured = this.drawn
      this.tipVelocity.set(0, 0, 0)
      this.tipSpeed = 0
      return
    }
    this.tipVelocity.subVectors(this.tip, this.prevTip).divideScalar(dt)
    this.tipSpeed = this.tipVelocity.length()
    this.swishCooldown = Math.max(0, this.swishCooldown - dt)
    if (this.tipSpeed > SWISH_SPEED && this.swishCooldown === 0) {
      this.swishCooldown = 0.35
      this.audio.play('swish', this.tip, THREE.MathUtils.clamp(this.tipSpeed / 12, 0.3, 0.8))
    }
  }

  /** The blade at a fraction of the way from last frame's position (0) to this frame's (1). */
  bladeAt(t: number, base: THREE.Vector3, tip: THREE.Vector3): void {
    base.lerpVectors(this.prevBase, this.base, t)
    tip.lerpVectors(this.prevTip, this.tip, t)
  }
}

// A drop of blood on the deck that slowly fades away.
class Splat {
  private readonly mesh: THREE.Mesh
  private life = 0

  constructor(root: THREE.Object3D) {
    this.mesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.05, 12).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x6e0505, roughness: 0.35, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    )
    this.mesh.visible = false
    root.add(this.mesh)
  }

  place(at: THREE.Vector3, delay: number): void {
    this.mesh.position.copy(at)
    this.mesh.scale.setScalar(0.5 + Math.random() * 0.8)
    this.mesh.rotation.y = Math.random() * Math.PI
    // Appears once the drops have had time to fall.
    this.life = 20 + delay
    this.mesh.visible = false
  }

  update(dt: number): void {
    if (this.life <= 0) return
    this.life = Math.max(0, this.life - dt)
    const material = this.mesh.material as THREE.MeshStandardMaterial
    this.mesh.visible = this.life > 0 && this.life < 20
    material.opacity = Math.min(0.85, this.life / 5)
  }
}

/**
 * Closest points between segments p1–q1 and p2–q2 (written to `c1`, `c2`); returns their distance.
 * (Ericson, Real-Time Collision Detection, 5.1.9.)
 */
export function closestBetweenSegments(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, c1: THREE.Vector3, c2: THREE.Vector3): number {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z
  const a = d1x * d1x + d1y * d1y + d1z * d1z
  const e = d2x * d2x + d2y * d2y + d2z * d2z
  const f = d2x * rx + d2y * ry + d2z * rz
  let s: number
  let t: number
  if (a <= 1e-9 && e <= 1e-9) {
    s = t = 0
  } else if (a <= 1e-9) {
    s = 0
    t = THREE.MathUtils.clamp(f / e, 0, 1)
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz
    if (e <= 1e-9) {
      t = 0
      s = THREE.MathUtils.clamp(-c / a, 0, 1)
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z
      const denom = a * e - b * b
      s = denom > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = THREE.MathUtils.clamp(-c / a, 0, 1)
      } else if (t > 1) {
        t = 1
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1)
      }
    }
  }
  c1.set(p1.x + d1x * s, p1.y + d1y * s, p1.z + d1z * s)
  c2.set(p2.x + d2x * t, p2.y + d2y * t, p2.z + d2z * t)
  return c1.distanceTo(c2)
}
