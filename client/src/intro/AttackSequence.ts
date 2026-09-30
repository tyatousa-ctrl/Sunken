import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import { DECK_Y, type Galleon } from '../world/ship/Galleon'
import {
  FLAG_SWAP_AT,
  FLIGHT_SECONDS,
  MAX_PITCH_DEG,
  MAX_SINK_METRES,
  MAX_TILT_DEG,
  planVolleys,
  sinkProgress,
  turnProgress,
  type CannonShot,
} from './attackTimeline'

const SPEED_OF_SOUND = 343
const MAX_FIRES = 7

interface Ball {
  mesh: THREE.Mesh
  from: THREE.Vector3
  to: THREE.Vector3
  shot: CannonShot
  t: number
}

export interface AttackFx {
  audio: AudioSystem
  smoke: Particles
  fire: Particles
  debris: Particles
  splash: Particles
  /** Called when a cannonball lands on the scoreboard (so the clay range can break it). */
  onScoreboardHit: () => void
  hands: () => Hand[]
  /** Where the listener's head is, for the flash-to-boom delay. */
  head: () => THREE.Vector3
}

// Runs the scripted attack: the enemy swings broadside and fires volleys; cannonballs arc in and
// smash the scoreboard, the deck and the foremast; fires break out; our ship settles and tilts.
export class AttackSequence {
  t = 0
  private readonly shots = planVolleys()
  private nextShot = 0
  private readonly balls: Ball[] = []
  private readonly fires: THREE.Vector3[] = []
  private readonly pendingBooms: { at: number; pos: THREE.Vector3 }[] = []
  private shakeTime = 0
  private mastFall = -1
  private flagSwapped = false
  private readonly ballGeometry = new THREE.SphereGeometry(0.14, 10, 8)
  private readonly ballMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.6, metalness: 0.4 })
  private readonly enemyStartYaw: number
  private readonly v = new THREE.Vector3()

  constructor(
    private readonly root: THREE.Group,
    private readonly ship: Galleon,
    private readonly enemy: Galleon,
    private readonly broadsideYaw: number,
    private readonly fx: AttackFx,
  ) {
    this.enemyStartYaw = enemy.group.rotation.y
  }

  update(dt: number, elapsed: number): void {
    this.t += dt
    const t = this.t

    if (!this.flagSwapped && t >= FLAG_SWAP_AT) {
      this.flagSwapped = true
      this.enemy.setFlag('pirate')
    }
    this.enemy.group.rotation.y = THREE.MathUtils.lerp(this.enemyStartYaw, this.broadsideYaw, turnProgress(t))

    // Our ship settles by the bow and rolls to starboard as she fills (< 10° for comfort).
    const sink = sinkProgress(t)
    this.ship.group.position.y = -MAX_SINK_METRES * sink
    this.ship.group.rotation.z = -THREE.MathUtils.degToRad(MAX_TILT_DEG) * sink
    this.ship.group.rotation.x = -THREE.MathUtils.degToRad(MAX_PITCH_DEG) * sink

    while (this.nextShot < this.shots.length && t >= this.shots[this.nextShot].fireAt) this.fire(this.shots[this.nextShot++])
    this.updateBalls(dt)
    this.updateBooms()
    this.updateFires(dt)
    this.updateShake(dt, elapsed)
    this.updateMast(dt)
  }

  private fire(shot: CannonShot): void {
    const guns = this.enemy.portGuns
    const muzzle = this.enemy.group.localToWorld(guns[Math.floor(Math.random() * guns.length)].clone())
    this.fx.fire.emit({ position: muzzle, spread: 2, color: 0xffb24a, size: 3, endSize: 1, life: 0.25, count: 6 })
    this.fx.smoke.emit({ position: muzzle, spread: 1.5, velocity: new THREE.Vector3(0, 1, 0), color: 0xcfc9bf, size: 2, endSize: 9, life: 6, count: 14, alpha: 0.6 })
    // The boom arrives after the flash, at the speed of sound.
    this.pendingBooms.push({ at: this.t + muzzle.distanceTo(this.fx.head()) / SPEED_OF_SOUND, pos: muzzle })

    const target = this.targetPoint(shot)
    const mesh = new THREE.Mesh(this.ballGeometry, this.ballMaterial)
    mesh.position.copy(muzzle)
    this.root.add(mesh)
    this.balls.push({ mesh, from: muzzle, to: target, shot, t: 0 })
  }

  private targetPoint(shot: CannonShot): THREE.Vector3 {
    const local = new THREE.Vector3()
    const fore = this.ship.foremast.position.z
    // The plan's deck spans z -11..8 of a short ship; spread it along a stretched one's whole deck.
    const z = this.ship.stretch > 0 ? THREE.MathUtils.mapLinear(shot.z, -11, 8, fore - 12, 8) : shot.z
    // The scoreboard hangs on the foremast (facing the bow) on a stretched ship, on the main mast otherwise.
    if (shot.target === 'scoreboard') local.set(0, DECK_Y + 2.7, this.ship.stretch > 0 ? fore - 0.3 : 0.3)
    else if (shot.target === 'foremast') local.set(0, DECK_Y + 5, fore)
    else if (shot.target === 'miss') local.set(shot.x, -DECK_Y, z)
    else local.set(shot.x, DECK_Y, z)
    return this.ship.group.localToWorld(local)
  }

  private updateBalls(dt: number): void {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i]
      ball.t += dt / FLIGHT_SECONDS
      const u = Math.min(1, ball.t)
      ball.mesh.position.lerpVectors(ball.from, ball.to, u)
      ball.mesh.position.y += Math.sin(Math.PI * u) * 14
      if (u < 1) continue
      this.root.remove(ball.mesh)
      this.balls.splice(i, 1)
      this.impact(ball.shot, ball.to)
    }
  }

  private impact(shot: CannonShot, at: THREE.Vector3): void {
    if (shot.target === 'miss') {
      this.fx.splash.emit({ position: at.clone().setY(0.2), velocity: new THREE.Vector3(0, 9, 0), spread: 2.5, color: 0xeaf6ff, size: 0.5, life: 1.6, count: 40 })
      this.fx.audio.play('bigSplash', at)
      return
    }
    this.fx.audio.play('impact', at)
    this.fx.debris.emit({ position: at, velocity: new THREE.Vector3(0, 4, 0), spread: 5, color: 0x6b4527, size: 0.14, life: 2, count: 45 })
    this.fx.fire.emit({ position: at, spread: 2, color: 0xffa640, size: 1.5, endSize: 0.3, life: 0.35, count: 10 })
    this.fx.smoke.emit({ position: at, spread: 1, velocity: new THREE.Vector3(0, 1.5, 0), color: 0x55504a, size: 0.8, endSize: 4, life: 4, count: 12, alpha: 0.7 })
    this.shakeTime = 0.5
    for (const hand of this.fx.hands()) hand.pulse(0.6, 150)
    if (shot.target === 'scoreboard') this.fx.onScoreboardHit()
    if (shot.target === 'foremast') this.mastFall = 0
    if (this.fires.length < MAX_FIRES && shot.target !== 'scoreboard') this.fires.push(this.ship.group.worldToLocal(at.clone()))
  }

  private updateBooms(): void {
    for (let i = this.pendingBooms.length - 1; i >= 0; i--) {
      if (this.t < this.pendingBooms[i].at) continue
      this.fx.audio.play('cannon', this.pendingBooms[i].pos)
      this.pendingBooms.splice(i, 1)
    }
  }

  private updateFires(dt: number): void {
    for (const local of this.fires) {
      if (Math.random() > dt * 25) continue
      const at = this.ship.group.localToWorld(this.v.copy(local))
      // Fires go out once the sea reaches them.
      if (at.y < 0.1) continue
      this.fx.fire.emit({ position: at, velocity: new THREE.Vector3(0, 1.8, 0), spread: 0.35, color: Math.random() < 0.5 ? 0xff8a2a : 0xffc34d, size: 0.5, endSize: 0.1, life: 0.9, count: 2 })
      if (Math.random() < 0.3) this.fx.smoke.emit({ position: at.setY(at.y + 1), velocity: new THREE.Vector3(0.4, 2, 0), spread: 0.3, color: 0x3d3a37, size: 0.6, endSize: 3, life: 5, count: 1, alpha: 0.6 })
    }
  }

  /** World shake: only the ship's visuals jitter, never the deck the player stands on. */
  private updateShake(dt: number, elapsed: number): void {
    this.shakeTime = Math.max(0, this.shakeTime - dt)
    const a = this.shakeTime * 0.12
    this.ship.shake.position.set(Math.sin(elapsed * 61) * a, Math.sin(elapsed * 47) * a * 0.5, Math.sin(elapsed * 53) * a)
  }

  private updateMast(dt: number): void {
    if (this.mastFall < 0 || this.mastFall >= 1) return
    this.mastFall = Math.min(1, this.mastFall + dt / 1.8)
    // Topples to port, away from the gear rack's walkway, accelerating as it goes.
    const u = this.mastFall * this.mastFall
    this.ship.foremast.rotation.z = u * 1.35
    this.ship.foremast.position.y = DECK_Y - u * 0.8
    if (this.mastFall >= 1) {
      const at = this.ship.group.localToWorld(new THREE.Vector3(-6, 0, this.ship.foremast.position.z))
      this.fx.splash.emit({ position: at.setY(0.3), velocity: new THREE.Vector3(0, 7, 0), spread: 3, color: 0xeaf6ff, size: 0.6, life: 1.5, count: 50 })
      this.fx.audio.play('bigSplash', at)
      this.shakeTime = 0.6
    }
  }
}
