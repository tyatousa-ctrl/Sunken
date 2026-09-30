import * as THREE from 'three'
import type { Particles } from '../fx/Particles'
import { STERN_Z, type Galleon } from '../world/ship/Galleon'
import { deckHalfWidth, DECK_BOW_Z } from './deck'

/** Cruising speed under sail (m/s, about 4 knots). */
export const SAIL_SPEED = 2.2
/** Hardest turn, at full rudder and cruising speed (degrees per second): gentle, for comfort. */
const MAX_TURN_DEG = 4
/** Stay inside this box of the bay (world x/z): the cliffs are to port (x < -330). */
const BAY = { minX: -250, maxX: 700, minZ: -1400, maxZ: 1400 }
/** Keep this far from the ship anchored in the bay (m). */
const KEEP_CLEAR = 45

export interface SailState {
  /** The ship's position on the chart (world x, z) and heading (radians, CCW from above). */
  x: number
  z: number
  heading: number
  speed: number
  /** The helm's wheel angle (for everyone to see it turn). */
  wheel: number
}

// The galleon under way. The ship itself never moves in the scene (so everyone and everything on
// deck stays put); instead the sea, the coast and the ship in the bay slide and turn around it,
// which looks exactly the same from on board. A foam wake and bow spray show the speed.
export class Sailing {
  /** Everything that's part of the world rather than the ship: sea, coast, the other ship. */
  readonly scenery = new THREE.Group()
  /** Starts already under way. */
  readonly state: SailState = { x: 0, z: 0, heading: 0, speed: SAIL_SPEED, wheel: 0 }
  /** Sailing at all (stops for good when the attack starts). */
  underway = true
  /** Set by the stage: an automatic course correction is steering (shoals, the other ship). */
  correcting = false
  private readonly target: SailState = { x: 0, z: 0, heading: 0, speed: 0, wheel: 0 }
  private remote = false
  private readonly wake: THREE.Mesh
  private readonly wakeTexture: THREE.CanvasTexture
  private readonly bowFoam: THREE.Mesh
  private sprayTimer = 0
  private readonly q = new THREE.Quaternion()
  private readonly up = new THREE.Vector3(0, 1, 0)

  constructor(
    root: THREE.Object3D,
    private readonly ship: Galleon,
    private readonly spray: Particles,
    /** World points to keep clear of (the anchored ship). */
    private readonly avoid: () => THREE.Vector3[],
  ) {
    root.add(this.scenery)

    // Wake: a widening band of foam streaming astern, and a collar of foam around the hull.
    this.wakeTexture = makeFoamTexture()
    this.wakeTexture.wrapS = this.wakeTexture.wrapT = THREE.RepeatWrapping
    this.wakeTexture.repeat.set(1, 6)
    const wakeGeometry = new THREE.BufferGeometry()
    const w0 = deckHalfWidth(STERN_Z) * 0.9
    const w1 = 16
    const len = 90
    wakeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-w0, 0, 0, w0, 0, 0, w1, 0, len, -w1, 0, len], 3))
    wakeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
    wakeGeometry.setIndex([0, 2, 1, 0, 3, 2])
    this.wake = new THREE.Mesh(
      wakeGeometry,
      new THREE.MeshBasicMaterial({ map: this.wakeTexture, alphaMap: makeFadeTexture(), transparent: true, depthWrite: false, opacity: 0 }),
    )
    this.wake.position.set(0, 0.03, STERN_Z - 0.5)
    ship.group.add(this.wake)

    const collar = new THREE.Shape()
    const pts: THREE.Vector2[] = []
    for (let z = DECK_BOW_Z; z <= STERN_Z; z += 1) pts.push(new THREE.Vector2(deckHalfWidth(z) + 0.9, z))
    for (let z = STERN_Z; z >= DECK_BOW_Z; z -= 1) pts.push(new THREE.Vector2(-(deckHalfWidth(z) + 0.9), z))
    collar.setFromPoints(pts)
    const collarGeometry = new THREE.ShapeGeometry(collar)
    collarGeometry.rotateX(Math.PI / 2)
    this.bowFoam = new THREE.Mesh(collarGeometry, new THREE.MeshBasicMaterial({ map: this.wakeTexture, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide }))
    this.bowFoam.position.y = 0.02
    ship.group.add(this.bowFoam)
  }

  /** In a crew, another player (the helmsman or the host) sails the ship: follow their state. */
  receive(state: SailState): void {
    this.remote = true
    Object.assign(this.target, state)
  }

  /** This device sails the ship (it holds the helm, or it's the host and nobody does). */
  takeCommand(): void {
    this.remote = false
  }

  get commanding(): boolean {
    return !this.remote
  }

  /**
   * Advance the voyage. `rudder` is the helm (-1 port … 1 starboard). Returns the rudder actually
   * used (an automatic correction can override the helm near shoals or the other ship).
   */
  update(dt: number, elapsed: number, rudder: number): number {
    const s = this.state
    let used = rudder
    this.correcting = false
    if (this.remote) {
      // Follow the commanding player: extrapolate their last state and ease toward it.
      const t = this.target
      t.x += -Math.sin(t.heading) * t.speed * dt
      t.z += -Math.cos(t.heading) * t.speed * dt
      const k = 1 - Math.exp(-3 * dt)
      s.x += (t.x - s.x) * k
      s.z += (t.z - s.z) * k
      let dh = t.heading - s.heading
      dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      s.heading += dh * k
      s.speed += (t.speed - s.speed) * k
      s.wheel = t.wheel
    } else {
      const wanted = this.underway ? SAIL_SPEED : 0
      s.speed += (wanted - s.speed) * Math.min(1, dt * (this.underway ? 0.08 : 0.5))
      const correction = this.courseCorrection()
      if (correction !== null) {
        used = correction
        this.correcting = true
      }
      // Starboard rudder turns the bow right (clockwise from above), i.e. heading decreases.
      s.heading -= used * THREE.MathUtils.degToRad(MAX_TURN_DEG) * (s.speed / SAIL_SPEED) * dt
      s.x += -Math.sin(s.heading) * s.speed * dt
      s.z += -Math.cos(s.heading) * s.speed * dt
    }
    this.placeScenery()
    this.animateWater(dt, elapsed)
    return used
  }

  /** The world as seen from the ship: M = R(-heading) · T(-position). */
  private placeScenery(): void {
    const s = this.state
    this.q.setFromAxisAngle(this.up, -s.heading)
    this.scenery.quaternion.copy(this.q)
    this.scenery.position.set(-s.x, 0, -s.z).applyQuaternion(this.q)
    this.scenery.updateMatrixWorld(true)
  }

  /** Steer away from the shore, the edges of the bay and the anchored ship; null when all's clear. */
  private courseCorrection(): number | null {
    const s = this.state
    const ahead = new THREE.Vector3(s.x - Math.sin(s.heading) * 80, 0, s.z - Math.cos(s.heading) * 80)
    let away: THREE.Vector3 | null = null
    if (ahead.x < BAY.minX || ahead.x > BAY.maxX || ahead.z < BAY.minZ || ahead.z > BAY.maxZ) {
      away = new THREE.Vector3(200 - s.x, 0, -s.z)
    }
    for (const p of this.avoid()) {
      // The avoid points are in the scene; bring them onto the chart (undo the scenery transform).
      const chart = this.scenery.worldToLocal(p.clone())
      const d = Math.hypot(chart.x - s.x, chart.z - s.z)
      const dAhead = Math.hypot(chart.x - ahead.x * 0.5 - s.x * 0.5, chart.z - ahead.z * 0.5 - s.z * 0.5)
      if (d < KEEP_CLEAR * 2 && dAhead < KEEP_CLEAR * 1.5) away = new THREE.Vector3(s.x - chart.x, 0, s.z - chart.z)
    }
    if (!away) return null
    // Turn toward `away`: positive rudder (starboard) if it's to the right of the bow.
    const bow = new THREE.Vector3(-Math.sin(s.heading), 0, -Math.cos(s.heading))
    const cross = bow.x * away.z - bow.z * away.x
    return cross > 0 ? 1 : -1
  }

  private animateWater(dt: number, elapsed: number): void {
    const u = THREE.MathUtils.clamp(this.state.speed / SAIL_SPEED, 0, 1)
    // Foam streams aft at the ship's speed.
    this.wakeTexture.offset.y -= (this.state.speed * dt) / 15
    ;(this.wake.material as THREE.MeshBasicMaterial).opacity = 0.55 * u
    ;(this.bowFoam.material as THREE.MeshBasicMaterial).opacity = 0.45 * u
    this.wake.visible = this.bowFoam.visible = u > 0.02
    this.sprayTimer -= dt
    if (u > 0.3 && this.sprayTimer <= 0) {
      this.sprayTimer = 0.25
      const bow = this.ship.group.localToWorld(new THREE.Vector3(0, 0.4, DECK_BOW_Z + 0.4))
      for (const side of [-1, 1]) {
        const out = new THREE.Vector3(side * 1.4, 1.2 + Math.sin(elapsed * 3) * 0.3, 0.8).applyQuaternion(this.ship.group.quaternion)
        this.spray.emit({ position: bow, velocity: out.multiplyScalar(u), spread: 0.6, color: 0xf2f8ff, size: 0.12, life: 0.9, count: 3 })
      }
    }
  }
}

/** White streaks of foam on transparent, tiling top to bottom. */
function makeFoamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 128, 256)
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 160; i++) {
    const x = rand() * 128
    const y = rand() * 256
    const w = 2 + rand() * 7
    const h = 8 + rand() * 30
    ctx.fillStyle = `rgba(255,255,255,${0.25 + rand() * 0.6})`
    ctx.beginPath()
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2)
    ctx.fill()
    // Wrap vertically so the texture tiles.
    ctx.beginPath()
    ctx.ellipse(x, y + (y > 128 ? -256 : 256), w, h, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Opaque near the stern, fading out astern and toward the edges (alpha map: uses green). */
function makeFadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      // (Canvas top is the far end: textures are flipped, so v = 1 is the top row.)
      const along = y / 127
      const across = 1 - Math.pow(Math.abs(x / 63 - 0.5) * 2, 3)
      const v = Math.round(255 * along * across)
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return new THREE.CanvasTexture(canvas)
}
