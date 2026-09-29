import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'
import { Label } from '../ui/Label'
import { FlickDetector, SHELLS, ShotgunAction } from './shotgunLogic'

const PELLETS = 8
const SPREAD = THREE.MathUtils.degToRad(2.2)
const MUZZLE = new THREE.Vector3(0, 0, -0.7)
const BARREL_MID = new THREE.Vector3(0, 0, -0.38)
const HIGHLIGHT = new THREE.Color(0x2e7896)
const BLACK = new THREE.Color(0x000000)

export interface ShotgunEffects {
  audio: AudioSystem
  smoke: Particles
  flash: Particles
  /** Called with the muzzle position and each pellet's direction. */
  onFire: (origin: THREE.Vector3, directions: THREE.Vector3[]) => void
  /** Playing with keyboard and mouse (changes the reload hint). */
  desktop: () => boolean
}

// Pirate blunderbuss. Grip to pick it up (it snaps into the hand), trigger to fire, flick to reload,
// A/X to reload instantly. The other hand can grip the barrel to steady it two-handed.
// Dropped or thrown, it glides back to its rack.
export class Shotgun implements Interactable {
  readonly object = new THREE.Group()
  readonly action = new ShotgunAction()
  main: Hand | null = null
  support: Hand | null = null
  /** Drunk aim sway (radians); steadied by half when held two-handed. */
  sway = 0
  /** Set while another crew member holds this gun: it rides in their hand and can't be grabbed. */
  remoteHand: THREE.Object3D | null = null
  onGrabbed: () => void = () => {}
  onReleased: () => void = () => {}

  private readonly model = new THREE.Group()
  /** Floating shell count over the breech, facing the shooter; tells you how to reload at zero. */
  private readonly ammo = new Label({ width: 0.13, canvasWidth: 512, canvasHeight: 200 })
  private readonly hinge = new THREE.Group()
  private readonly flick = new FlickDetector()
  private readonly materials: THREE.MeshStandardMaterial[] = []
  private readonly rackParent: THREE.Object3D
  private readonly rackPos = new THREE.Vector3()
  private readonly rackQuat = new THREE.Quaternion()
  private returning = 0
  private recoil = 0
  private prevPitch = 0
  private quickReloadTimer = 0
  private swayTime = 0
  private readonly v = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  private readonly m = new THREE.Matrix4()

  constructor(
    rack: THREE.Object3D,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    private readonly fx: ShotgunEffects,
  ) {
    this.buildModel()
    this.object.add(this.model)
    this.ammo.mesh.position.set(0, 0.085, 0.0)
    this.ammo.mesh.rotation.x = -0.55
    this.ammo.visible = false
    this.object.add(this.ammo.mesh)
    rack.add(this.object)
    this.object.position.copy(position)
    this.object.quaternion.copy(quaternion)
    this.rackParent = rack
    this.rackPos.copy(position)
    this.rackQuat.copy(quaternion)
  }

  get held(): boolean {
    return this.main !== null
  }

  grabGap(point: THREE.Vector3, hand: Hand): number {
    if (this.remoteHand) return Infinity
    if (!this.main) return point.distanceTo(this.object.getWorldPosition(this.v)) - 0.12
    if (hand !== this.main && !this.support) return point.distanceTo(this.object.localToWorld(this.v.copy(BARREL_MID))) - 0.12
    return Infinity
  }

  grab(hand: Hand): void {
    if (!this.main) {
      this.main = hand
      this.returning = 0
      hand.ray.add(this.object)
      this.object.position.set(0, -0.03, 0.05)
      this.object.quaternion.identity()
      this.prevPitch = this.pitch()
      hand.pulse(0.4, 40)
      this.onGrabbed()
    } else {
      this.support = hand
      hand.pulse(0.25, 30)
    }
  }

  release(hand: Hand): void {
    if (hand === this.support) {
      this.support = null
      this.object.quaternion.identity()
      return
    }
    if (hand !== this.main) return
    this.main = null
    if (this.support) {
      this.support.held = null
      this.support = null
    }
    // Snap back to the rack (never lost overboard).
    this.rackParent.attach(this.object)
    this.returning = 0.4
    this.onReleased()
  }

  /** Someone else got it first (the server said no): let go. */
  forceDrop(): void {
    const main = this.main
    if (!main) return
    main.held = null
    this.release(main)
  }

  /** Show the gun in another player's hand (or back on the rack with null). */
  setRemoteHand(hand: THREE.Object3D | null): void {
    if (hand === this.remoteHand) return
    this.remoteHand = hand
    if (hand) {
      hand.add(this.object)
      this.object.position.set(0, -0.03, 0.05)
      this.object.quaternion.identity()
      this.returning = 0
    } else {
      this.rackParent.attach(this.object)
      this.returning = 0.4
    }
  }

  /** Muzzle flash, smoke and boom for a shot fired by the player holding it remotely. */
  playRemoteFire(): void {
    this.object.updateMatrixWorld(true)
    const origin = this.object.localToWorld(this.v.copy(MUZZLE)).clone()
    const forward = this.forward(new THREE.Vector3())
    this.recoil = 1
    this.fx.audio.play('gunshot', origin)
    this.fx.flash.emit({ position: origin, velocity: forward.clone().multiplyScalar(3), color: 0xffc56b, size: 0.45, endSize: 0.1, life: 0.08, count: 3 })
    this.fx.smoke.emit({ position: origin, velocity: forward.clone().multiplyScalar(2.5), spread: 0.4, color: 0xb9b2a8, size: 0.15, endSize: 0.9, life: 1.8, count: 10, alpha: 0.7 })
  }

  setHighlight(on: boolean): void {
    for (const m of this.materials) m.emissive.copy(on ? HIGHLIGHT : BLACK)
  }

  update(dt: number): void {
    this.ammo.visible = this.main !== null
    this.recoil *= Math.exp(-14 * dt)
    this.model.position.z = 0.07 * this.recoil
    this.model.rotation.x = 0.22 * this.recoil
    const openTarget = this.action.open || this.quickReloadTimer > 0.25 ? -0.75 : 0
    this.hinge.rotation.x += (openTarget - this.hinge.rotation.x) * (1 - Math.exp(-25 * dt))

    if (this.returning > 0) {
      this.returning = Math.max(0, this.returning - dt)
      const k = 1 - Math.exp(-12 * dt)
      this.object.position.lerp(this.rackPos, k)
      this.object.quaternion.slerp(this.rackQuat, k)
      if (this.returning === 0) {
        this.object.position.copy(this.rackPos)
        this.object.quaternion.copy(this.rackQuat)
      }
      return
    }
    const main = this.main
    if (!main) return
    this.updateAmmo()

    if (this.support) this.aimTwoHanded(main, this.support)
    else this.object.quaternion.identity()
    if (this.sway > 0) {
      this.swayTime += dt
      const s = this.sway * (this.support ? 0.5 : 1)
      this.object.rotateX(Math.sin(this.swayTime * 1.7) * s)
      this.object.rotateY(Math.sin(this.swayTime * 1.1 + 1) * s)
    }

    if (this.quickReloadTimer > 0) {
      this.quickReloadTimer = Math.max(0, this.quickReloadTimer - dt)
      if (this.quickReloadTimer === 0) this.fx.audio.play('click', this.object.getWorldPosition(this.v))
    }

    // Wrist flicks: pitch rate of the barrel.
    const pitch = this.pitch()
    const flick = this.flick.feed((pitch - this.prevPitch) / Math.max(dt, 1e-3), dt)
    this.prevPitch = pitch
    if (flick === 'down' && this.action.flickDown()) this.clack(0.5)
    if (flick === 'up' && this.action.flickUp()) this.clack(0.7)
    if (main.primaryPressed && this.action.quickReload()) {
      this.quickReloadTimer = 0.5
      this.clack(0.4)
    }

    if (main.triggerPressed && this.quickReloadTimer === 0) {
      const result = this.action.pull()
      if (result === 'fired') this.fire(main)
      else this.fx.audio.play('click', this.object.getWorldPosition(this.v), 0.6)
    }
  }

  private fire(main: Hand): void {
    this.object.updateMatrixWorld(true)
    const origin = this.object.localToWorld(this.v.copy(MUZZLE)).clone()
    const forward = this.forward(new THREE.Vector3())
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.object.getWorldQuaternion(this.q))
    const right = new THREE.Vector3().crossVectors(forward, up).normalize()
    const directions: THREE.Vector3[] = []
    for (let i = 0; i < PELLETS; i++) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.sqrt(Math.random()) * SPREAD
      directions.push(
        forward
          .clone()
          .addScaledVector(right, Math.cos(angle) * radius)
          .addScaledVector(up, Math.sin(angle) * radius)
          .normalize(),
      )
    }
    this.recoil = 1
    main.pulse(1, 90)
    this.support?.pulse(0.45, 70)
    this.fx.audio.play('gunshot', origin)
    this.fx.flash.emit({ position: origin, velocity: forward.clone().multiplyScalar(3), color: 0xffc56b, size: 0.45, endSize: 0.1, life: 0.08, count: 3 })
    this.fx.smoke.emit({ position: origin, velocity: forward.clone().multiplyScalar(2.5), spread: 0.4, color: 0xb9b2a8, size: 0.15, endSize: 0.9, life: 1.8, count: 10, alpha: 0.7 })
    this.fx.onFire(origin, directions)
  }

  private updateAmmo(): void {
    const { shells, open } = this.action
    const pips = '●'.repeat(shells) + '○'.repeat(SHELLS - shells)
    const reload = this.fx.desktop() ? 'or press R' : 'or press A / X'
    if (open) {
      this.ammo.set([
        { text: 'Open', color: '#ffd27a', size: 44, bold: true },
        { text: 'Flick up to load', size: 40, bold: true },
      ])
    } else if (shells === 0 || this.quickReloadTimer > 0) {
      this.ammo.set([
        { text: this.quickReloadTimer > 0 ? 'Loading…' : `${pips}  Empty`, color: '#ff8a7a', size: 44, bold: true },
        { text: 'Flick down to open', size: 40, bold: true },
        { text: reload, size: 28, color: '#b9c7cf' },
      ])
    } else {
      this.ammo.set([{ text: `${pips}  ${shells} ${shells === 1 ? 'shell' : 'shells'}`, color: '#ffe7a8', size: 50, bold: true }])
    }
  }

  private clack(intensity: number): void {
    this.main?.pulse(intensity, 30)
    this.fx.audio.play('click', this.object.getWorldPosition(this.v))
  }

  /** Front hand steadies the barrel: point the gun from the trigger hand toward the front hand. */
  private aimTwoHanded(main: Hand, support: Hand): void {
    const from = main.worldPos(this.v)
    const to = support.worldPos(this.v2)
    if (from.distanceToSquared(to) < 0.01) return
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(main.ray.getWorldQuaternion(this.q))
    this.m.lookAt(from, to, up)
    const desired = new THREE.Quaternion().setFromRotationMatrix(this.m)
    const parentWorld = main.ray.getWorldQuaternion(this.q)
    this.object.quaternion.copy(parentWorld.invert().multiply(desired))
  }

  private forward(target: THREE.Vector3): THREE.Vector3 {
    return target.set(0, 0, -1).applyQuaternion(this.object.getWorldQuaternion(this.q))
  }

  private pitch(): number {
    return Math.asin(THREE.MathUtils.clamp(this.forward(this.v2).y, -1, 1))
  }

  private buildModel(): void {
    const wood = this.mat(0x5e3a1e, 0.7)
    const brass = this.mat(0xc59a3c, 0.35, 0.7)
    const iron = this.mat(0x2d2f33, 0.4, 0.7)

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.09, 0.3), wood)
    stock.position.set(0, -0.045, 0.16)
    stock.rotation.x = 0.18
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.05), wood)
    grip.position.set(0, -0.04, 0.02)
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.08), brass)
    lock.position.set(0, 0.0, -0.03)
    this.model.add(stock, grip, lock)

    // Barrel hinges open downward at the breech.
    this.hinge.position.set(0, 0, -0.06)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.56, 12), iron)
    barrel.rotation.x = Math.PI / 2
    barrel.position.z = -0.3
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.022, 0.1, 14, 1, true), brass)
    bell.rotation.x = -Math.PI / 2
    bell.position.z = -0.62
    const foreStock = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.3), wood)
    foreStock.position.set(0, -0.03, -0.25)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 12), brass)
    band.rotation.x = Math.PI / 2
    band.position.z = -0.42
    this.hinge.add(barrel, bell, foreStock, band)
    this.model.add(this.hinge)
  }

  private mat(color: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness })
    this.materials.push(m)
    return m
  }
}
