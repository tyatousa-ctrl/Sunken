import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'

/** A named wreck's lantern burns this long before its rotten wick gutters out. */
const GUTTER_SECONDS = 2.2
const REACH = 0.22

// An old ship's lantern hanging at a wreck's stern: brass frame, thick glass, a flint wheel. Grip it and
// pull the trigger to strike the flint (or bring a Light Orb close) and it lights. A `true` lantern
// (the nameless wreck's) burns on, warm and bright; the others sputter and go out.
export class Lantern implements Interactable {
  readonly group = new THREE.Group()
  readonly pullable = false
  /** Burning steadily for good. */
  lit = false
  /** Lit (steadily) by this player: tell the stage. */
  onLit: () => void = () => {}
  /** Tried and guttered out. */
  onGutter: () => void = () => {}
  private readonly glass: THREE.MeshStandardMaterial
  private readonly light: THREE.PointLight
  private readonly holds = new Set<Hand>()
  private flicker = -1
  private cooldown = 0
  private time = 0
  private readonly v = new THREE.Vector3()

  constructor(
    parent: THREE.Object3D,
    at: THREE.Vector3,
    private readonly real: boolean,
    private readonly audio: AudioSystem,
    private readonly sparks: Particles,
  ) {
    const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a2e, roughness: 0.5, metalness: 0.7 })
    this.glass = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.2, transparent: true, opacity: 0.75, emissive: 0x000000 })
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 10), this.glass)
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.12, 10), brass)
    top.position.y = 0.19
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.05, 10), brass)
    base.position.y = -0.15
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), brass)
    ring.position.y = 0.3
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.28, 0.015), brass)
      const a = (i / 4) * Math.PI * 2
      bar.position.set(Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11)
      this.group.add(bar)
    }
    this.light = new THREE.PointLight(0xffb45a, 0, 16, 1.4)
    this.group.add(body, top, base, ring, this.light)
    this.group.position.copy(at)
    parent.add(this.group)
  }

  /** Where the flame is (world). */
  get center(): THREE.Vector3 {
    return this.group.getWorldPosition(new THREE.Vector3())
  }

  grabGap(point: THREE.Vector3): number {
    return point.distanceTo(this.group.getWorldPosition(this.v)) - REACH
  }

  grab(hand: Hand): void {
    this.holds.add(hand)
    hand.pulse(0.3, 30)
    // Keyboard and mouse: one grab strikes it.
    if (hand.virtual) {
      this.strike(hand)
      this.holds.delete(hand)
      hand.held = null
    }
  }

  release(hand: Hand): void {
    this.holds.delete(hand)
  }

  setHighlight(on: boolean): void {
    if (!this.lit && this.flicker < 0) this.glass.emissive.setHex(on ? 0x2e3a44 : 0x000000)
  }

  update(dt: number): void {
    this.time += dt
    this.cooldown = Math.max(0, this.cooldown - dt)
    for (const hand of this.holds) if (hand.triggerPressed) this.strike(hand)
    if (this.lit) {
      this.light.intensity = 9 + Math.sin(this.time * 9) * 0.6 + Math.sin(this.time * 23) * 0.3
      return
    }
    if (this.flicker >= 0) {
      // A named wreck's lantern: a brave little flame that sputters out.
      this.flicker += dt
      const dying = 1 - this.flicker / GUTTER_SECONDS
      const on = Math.random() < 0.3 + dying * 0.6
      this.light.intensity = on ? 6 * dying : 0.5
      this.glass.emissive.setHex(on ? 0xffa040 : 0x331800)
      if (this.flicker >= GUTTER_SECONDS) {
        this.flicker = -1
        this.light.intensity = 0
        this.glass.emissive.setHex(0x000000)
        this.onGutter()
      }
    }
  }

  /** Strike the flint (or a Light Orb came close): light it if it isn't already. */
  strike(hand: Hand | null): void {
    if (this.lit || this.flicker >= 0 || this.cooldown > 0) return
    this.cooldown = 1
    const at = this.group.getWorldPosition(this.v)
    this.audio.play('click', at, 0.8)
    this.sparks.emit({ position: at, velocity: new THREE.Vector3(0, 0.6, 0), spread: 0.8, color: 0xffc56b, size: 0.03, life: 0.3, count: 12 })
    hand?.pulse(0.6, 60)
    if (this.real) {
      this.lightNow()
      this.onLit()
    } else this.flicker = 0
  }

  /** Burning for good (lit here, by a crewmate, or already when we arrived). */
  lightNow(): void {
    if (this.lit) return
    this.lit = true
    this.flicker = -1
    this.glass.emissive.setHex(0xffa040)
    this.glass.emissiveIntensity = 1.4
  }
}
