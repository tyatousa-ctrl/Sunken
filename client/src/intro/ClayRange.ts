import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import { DECK_Y, halfWidthAt, type Galleon } from '../world/ship/Galleon'

const GRAVITY = 9.8
const CLAY_HIT_RADIUS = 0.4
const MAX_CLAYS = 4
const BUTTON_COOLDOWN = 1.5

interface Clay {
  id: number
  seed: number
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  alive: boolean
  pendingAt: number
}

export interface Shooter {
  name: string
  color: string
  hits: number
  shots: number
}

export interface ClayFx {
  audio: AudioSystem
  debris: Particles
  splash: Particles
}

// Clay pigeon shooting off the stern: a thrower on the starboard rail with a big pull button,
// clays that shatter or splash, and a wooden scoreboard on the main mast.
export class ClayRange {
  readonly shooters: Shooter[] = [{ name: 'You', color: '#e8b930', hits: 0, shots: 0 }]
  readonly board: THREE.Mesh
  private readonly clays: Clay[] = []
  private readonly thrower = new THREE.Group()
  private readonly button: THREE.Mesh
  private readonly boardCanvas = document.createElement('canvas')
  private readonly boardTexture: THREE.CanvasTexture
  private time = 0
  private localId = 0
  private buttonCooldown = 0
  private boardBroken = false
  private readonly v = new THREE.Vector3()
  private readonly toClay = new THREE.Vector3()

  constructor(
    root: THREE.Group,
    private readonly ship: Galleon,
    private readonly fx: ClayFx,
  ) {
    // Thrower on the starboard rail, aimed out over the water.
    const z = 6.2
    this.thrower.position.set(halfWidthAt(z) - 0.5, DECK_Y, z)
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.6 })
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.8 })
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), wood)
    base.position.y = 0.25
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.12), iron)
    arm.position.set(0.25, 0.6, 0)
    arm.rotation.z = 0.35
    this.button = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0xc0271d, roughness: 0.4, emissive: 0x220000 }))
    this.button.position.set(-0.15, 0.53, 0.18)
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.25, 16), new THREE.MeshStandardMaterial({ color: 0xd9632b, roughness: 0.8 }))
    stack.position.set(-0.12, 0.62, -0.15)
    this.thrower.add(base, arm, this.button, stack)
    ship.shake.add(this.thrower)

    const clayGeometry = new THREE.CylinderGeometry(0.11, 0.08, 0.03, 16)
    const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xe0662c, roughness: 0.8 })
    for (let i = 0; i < MAX_CLAYS; i++) {
      const mesh = new THREE.Mesh(clayGeometry, clayMaterial)
      mesh.visible = false
      root.add(mesh)
      this.clays.push({ id: 0, seed: 0, mesh, velocity: new THREE.Vector3(), alive: false, pendingAt: -1 })
    }

    // Scoreboard hangs on the main mast, facing the stern where the shooters stand.
    this.boardCanvas.width = 512
    this.boardCanvas.height = 320
    this.boardTexture = new THREE.CanvasTexture(this.boardCanvas)
    this.boardTexture.colorSpace = THREE.SRGBColorSpace
    this.board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.06), [
      wood,
      wood,
      wood,
      wood,
      new THREE.MeshStandardMaterial({ map: this.boardTexture, roughness: 0.9 }),
      wood,
    ])
    this.board.position.set(0, DECK_Y + 2.7, 0.3)
    ship.shake.add(this.board)
    this.drawBoard()
  }

  get anyInFlight(): boolean {
    return this.clays.some((c) => c.alive || c.pendingAt >= 0)
  }

  /** Launch one or two clays (solo play). */
  pull(count: number): void {
    for (let i = 0; i < count; i++) this.launchSeeded(++this.localId, Math.floor(Math.random() * 2 ** 31), i * 0.3)
  }

  /** Launch a clay the server announced: the seed gives every player the same flight. */
  launchSeeded(id: number, seed: number, delay: number): void {
    const clay = this.clays.find((c) => !c.alive && c.pendingAt < 0)
    if (!clay) return
    clay.id = id
    clay.seed = seed
    clay.pendingAt = this.time + delay
  }

  /**
   * Which clays a shot's pellets pass through. With `apply` (solo), they shatter and count here;
   * in a crew the server confirms the hit first.
   */
  shoot(shooter: Shooter, origin: THREE.Vector3, directions: THREE.Vector3[], apply = true): number[] {
    if (apply) shooter.shots++
    const hit: number[] = []
    for (const clay of this.clays) {
      if (!clay.alive) continue
      for (const dir of directions) {
        this.toClay.subVectors(clay.mesh.position, origin)
        const along = this.toClay.dot(dir)
        if (along < 0) continue
        const miss = this.toClay.addScaledVector(dir, -along).length()
        if (miss < CLAY_HIT_RADIUS) {
          hit.push(clay.id)
          if (apply) this.shatter(clay)
          break
        }
      }
    }
    if (apply) {
      shooter.hits += hit.length
      this.drawBoard()
    }
    return hit
  }

  /** The server confirmed a hit. */
  shatterById(id: number): void {
    const clay = this.clays.find((c) => c.alive && c.id === id)
    if (clay) this.shatter(clay)
  }

  /** Crew scoreboard from the server's roster. */
  setShooters(list: Shooter[]): void {
    const same = list.length === this.shooters.length && list.every((s, i) => {
      const o = this.shooters[i]
      return o.name === s.name && o.hits === s.hits && o.shots === s.shots && o.color === s.color
    })
    if (same) return
    this.shooters.splice(0, this.shooters.length, ...list)
    this.drawBoard()
  }

  /** Touching the red button launches clays too. */
  checkButton(hands: Hand[]): boolean {
    if (this.buttonCooldown > 0) return false
    this.button.getWorldPosition(this.v)
    const hand = hands.find((h) => h.connected && !h.held && h.worldPos(new THREE.Vector3()).distanceTo(this.v) < 0.1)
    if (!hand) return false
    hand.pulse(0.5, 40)
    this.buttonCooldown = BUTTON_COOLDOWN
    this.fx.audio.play('thud', this.v)
    return true
  }

  breakBoard(): void {
    if (this.boardBroken) return
    this.boardBroken = true
    this.board.getWorldPosition(this.v)
    this.board.visible = false
    this.fx.debris.emit({ position: this.v, spread: 5, velocity: new THREE.Vector3(0, 2, 2), color: 0x6b4527, size: 0.12, life: 2.2, count: 40 })
    this.fx.debris.emit({ position: this.v, spread: 3, color: 0x2a2a2a, size: 0.08, life: 1.5, count: 20 })
  }

  update(dt: number): void {
    this.time += dt
    this.buttonCooldown = Math.max(0, this.buttonCooldown - dt)
    for (const clay of this.clays) {
      if (clay.pendingAt >= 0 && this.time >= clay.pendingAt) this.launch(clay)
      if (!clay.alive) continue
      clay.velocity.y -= GRAVITY * dt
      clay.mesh.position.addScaledVector(clay.velocity, dt)
      clay.mesh.rotation.y += dt * 20
      if (clay.mesh.position.y < 0) {
        clay.alive = false
        clay.mesh.visible = false
        this.fx.splash.emit({ position: clay.mesh.position.clone().setY(0.05), velocity: new THREE.Vector3(0, 3, 0), spread: 1.2, color: 0xeaf6ff, size: 0.18, life: 0.9, count: 18 })
        this.fx.audio.play('splash', clay.mesh.position, 0.7)
      }
    }
  }

  private launch(clay: Clay): void {
    clay.pendingAt = -1
    clay.alive = true
    clay.mesh.visible = true
    this.thrower.localToWorld(clay.mesh.position.set(0.6, 0.75, 0))
    // Out to starboard, anywhere from slightly forward to well astern (seeded, so everyone agrees).
    let s = clay.seed || 1
    const random = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
    const yaw = -0.6 + random() * 0.75
    const speed = 12 + random() * 4
    clay.velocity.set(Math.cos(yaw) * speed, 7 + random() * 2.2, -Math.sin(yaw) * speed)
    clay.velocity.applyQuaternion(this.ship.group.quaternion)
    this.fx.audio.play('thud', clay.mesh.position, 0.8)
  }

  private shatter(clay: Clay): void {
    clay.alive = false
    clay.mesh.visible = false
    const at = clay.mesh.position
    this.fx.debris.emit({ position: at, velocity: clay.velocity.clone().multiplyScalar(0.4), spread: 2.5, color: 0xe0662c, size: 0.06, life: 1.6, count: 24 })
    this.fx.debris.emit({ position: at, velocity: clay.velocity.clone().multiplyScalar(0.3), spread: 1, color: 0x8a6a55, size: 0.2, endSize: 0.5, life: 0.5, count: 4, alpha: 0.5 })
    this.fx.audio.play('crack', at)
  }

  private drawBoard(): void {
    const ctx = this.boardCanvas.getContext('2d')!
    ctx.fillStyle = '#2f3b2c'
    ctx.fillRect(0, 0, 512, 320)
    ctx.strokeStyle = '#8a5a2b'
    ctx.lineWidth = 14
    ctx.strokeRect(7, 7, 498, 306)
    ctx.fillStyle = '#f0ead8'
    ctx.font = 'bold 40px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.fillText('Clay Shoot', 256, 62)
    ctx.font = '24px Georgia, serif'
    ctx.fillStyle = '#cfc7b0'
    ctx.textAlign = 'left'
    ctx.fillText('Shooter', 40, 110)
    ctx.textAlign = 'right'
    ctx.fillText('Hits', 360, 110)
    ctx.fillText('Shots', 470, 110)
    const sorted = [...this.shooters].sort((a, b) => b.hits - a.hits)
    sorted.forEach((s, i) => {
      const y = 158 + i * 44
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(52, y - 10, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#f0ead8'
      ctx.font = 'bold 32px Georgia, serif'
      ctx.textAlign = 'left'
      ctx.fillText(s.name, 76, y)
      ctx.textAlign = 'right'
      ctx.fillText(String(s.hits), 360, y)
      ctx.fillText(String(s.shots), 470, y)
    })
    this.boardTexture.needsUpdate = true
  }
}
