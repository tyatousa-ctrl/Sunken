import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { Player } from '../movement/Player'
import { Label } from '../ui/Label'
import { DECK_Y, RAIL_HEIGHT, type Galleon } from '../world/ship/Galleon'
import { deckHalfWidth } from './deck'

/** The plank juts out to starboard here, between the cannons (ship-local z)... */
export const PLANK_Z = -7.6
/** ...and the rope ladder back up hangs over the side here. */
export const LADDER_Z = -5.9
const HALF = deckHalfWidth(PLANK_Z)
/** Up the steps (a ramp underfoot) from the deck to the rail, then out along the plank. */
const RAMP_X0 = HALF - 1.9
const RAIL_X = HALF - 0.25
const TOP = DECK_Y + RAIL_HEIGHT + 0.05
const PLANK_END = HALF + 2.4
const PLANK_HALF_W = 0.2
const LADDER_HALF = deckHalfWidth(LADDER_Z)
const LADDER_X = LADDER_HALF + 0.1
const LADDER_HALF_W = 0.22
/** The ladder's lowest rung (world y: just above the sea) and its top (the rail). */
const LADDER_BOTTOM = 0.25
const LADDER_TOP = DECK_Y + RAIL_HEIGHT
/** Seconds in the deep before you're back at the ladder. */
export const DEEP_SECONDS = 2
/** Climbers' heads stay this far out from the ladder. */
const HOLD = 0.32

export interface PlankContext {
  audio: AudioSystem
  splash: Particles
  player: Player
  camera: THREE.Camera
  hands: () => Hand[]
  say: (text: string, seconds: number) => void
}

// Walk the plank: steps up to the starboard rail and a plank out over the sea. Walk off the end and
// you drop in: a splash, then two seconds in the deep blue (light from above, bubbles rising), and
// you're hanging at the bottom of a rope ladder on the hull. Grip the rungs and pull yourself up;
// at the top you're helped back over the rail onto the deck.
export class Plank {
  private readonly dome: THREE.Mesh
  private readonly bubbles: THREE.Mesh[] = []
  private readonly domeTime = { value: 0 }
  private readonly sign = new Label({ width: 0.55, canvasWidth: 560, canvasHeight: 200, billboard: true })
  /** Seconds into the dunk (-1: not dunking). */
  private deep = -1
  /** On the ladder since the dunk (helps you over the rail at the top). */
  private climbing = false
  private readonly v = new THREE.Vector3()
  private readonly w = new THREE.Vector3()

  constructor(
    private readonly ship: Galleon,
    root: THREE.Object3D,
    private readonly ctx: PlankContext,
  ) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.85 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a2f1b, roughness: 0.9 })
    const group = new THREE.Group()
    ship.shake.add(group)
    // Three steps up to the rail (you walk up them like a ramp).
    for (let i = 0; i < 3; i++) {
      const h = ((i + 1) / 3) * (TOP - DECK_Y)
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.55, h, 0.7), dark)
      step.position.set(RAMP_X0 + 0.35 + i * 0.55, DECK_Y + h / 2, PLANK_Z)
      group.add(step)
    }
    // The plank itself, from the top step out over the rail and the sea, with a little droop at the end.
    const plank = new THREE.Mesh(new THREE.BoxGeometry(PLANK_END - RAIL_X + 0.3, 0.06, PLANK_HALF_W * 2), wood)
    plank.position.set((RAIL_X - 0.3 + PLANK_END) / 2, TOP - 0.03, PLANK_Z)
    plank.rotation.z = -0.015
    group.add(plank)
    // Lashed down with rope at the rail.
    const lash = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 6, 12), new THREE.MeshStandardMaterial({ color: 0x9c7a4a, roughness: 1 }))
    lash.rotation.y = Math.PI / 2
    lash.position.set(HALF - 0.05, TOP - 0.05, PLANK_Z)
    group.add(lash)
    this.sign.mesh.position.set(RAMP_X0 + 0.4, DECK_Y + 2.1, PLANK_Z)
    group.add(this.sign.mesh)
    this.sign.set([
      { text: 'Walk the Plank', size: 44, bold: true, color: '#f2b64a' },
      { text: 'Up the steps, out along the plank... and off the end!', size: 24 },
    ])

    // The rope ladder down the hull: two ropes and wooden rungs.
    const top = LADDER_TOP
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x9c7a4a, roughness: 1 })
    const bottomLocal = this.localY(LADDER_BOTTOM)
    for (const dz of [-LADDER_HALF_W, LADDER_HALF_W]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, top - bottomLocal + 0.1, 6), ropeMat)
      rope.position.set(LADDER_X, (top + bottomLocal) / 2, LADDER_Z + dz)
      group.add(rope)
    }
    for (let y = bottomLocal; y < top - 0.05; y += 0.3) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, LADDER_HALF_W * 2 + 0.04, 8).rotateX(Math.PI / 2), wood)
      rung.position.set(LADDER_X, y, LADDER_Z)
      group.add(rung)
    }

    // The deep: a small sky of sea round your head, dark below, bright where the light comes down.
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: this.domeTime },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float up = d.y * 0.5 + 0.5;
          vec3 c = mix(vec3(0.0, 0.02, 0.07), vec3(0.02, 0.16, 0.34), smoothstep(0.0, 0.7, up));
          c = mix(c, vec3(0.3, 0.62, 0.8), smoothstep(0.82, 1.0, up));
          float rays = pow(max(0.0, sin(d.x * 17.0 + uTime * 0.8) * sin(d.z * 13.0 - uTime * 0.6)), 4.0);
          c += rays * smoothstep(0.55, 1.0, up) * vec3(0.12, 0.2, 0.25);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      fog: false,
    })
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), material)
    this.dome.visible = false
    const bubble = new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.55, fog: false })
    for (let i = 0; i < 30; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.008 + Math.random() * 0.016, 6, 4), bubble)
      b.position.set((Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.8)
      this.dome.add(b)
      this.bubbles.push(b)
    }
    root.add(this.dome)
  }

  /** In the deep right now (the stage mustn't send you on to the dive). */
  get dunking(): boolean {
    return this.deep >= 0
  }

  // ---- Walking: the steps and the plank -------------------------------------------------------------

  /** Walking surface (ship-local y) of the steps or plank at a ship-local point, if on them. */
  groundAt(x: number, z: number, below?: number): number | null {
    if (Math.abs(z - PLANK_Z) > (x > RAIL_X ? PLANK_HALF_W : 0.35) || x < RAMP_X0 || x > PLANK_END) return null
    const y = x >= RAIL_X ? TOP : DECK_Y + ((x - RAMP_X0) / (RAIL_X - RAMP_X0)) * (TOP - DECK_Y)
    // Only counts from above (walking under the plank's end, you're on the deck).
    return below === undefined || y <= below ? y : null
  }

  /** Keep a walker on the plank once they're past the rail. True if handled (ship-local, moved in place). */
  constrain(p: THREE.Vector3, feetY: number): boolean {
    // (Or off the end of it and falling: over the side, not snapped back aboard.)
    const onSteps = Math.abs(p.z - PLANK_Z) < 0.35 && ((p.x > RAMP_X0 + 0.5 && feetY > DECK_Y + 0.5) || p.x > RAIL_X)
    if (!onSteps) return false
    // Out past the end is fine: that's the point.
    p.x = Math.min(p.x, PLANK_END + 1.5)
    if (p.x > RAIL_X - 0.1) p.z = THREE.MathUtils.clamp(p.z, PLANK_Z - PLANK_HALF_W, PLANK_Z + PLANK_HALF_W)
    return true
  }

  // ---- Climbing: the ladder -------------------------------------------------------------------------

  /** Is this world point on the ladder (within `reach`)? */
  onLadder(point: THREE.Vector3, reach: number): boolean {
    const p = this.ship.group.worldToLocal(this.v.copy(point))
    return Math.abs(p.x - LADDER_X) < reach + 0.05 && Math.abs(p.z - LADDER_Z) < LADDER_HALF_W + reach && p.y > this.localY(LADDER_BOTTOM) - 0.2 && p.y < LADDER_TOP + 1.2
  }

  /** How far (world) to move a climber's head to stay just outside the ladder. */
  ladderHold(head: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const p = this.ship.group.worldToLocal(this.v.copy(head))
    target.set(LADDER_X + HOLD - p.x, 0, THREE.MathUtils.clamp(p.z, LADDER_Z - 0.1, LADDER_Z + 0.1) - p.z)
    return target.applyQuaternion(this.ship.group.getWorldQuaternion(new THREE.Quaternion()))
  }

  /** Straight up (for keyboard climbing). */
  ladderUp(target: THREE.Vector3): THREE.Vector3 {
    return target.set(0, 1, 0)
  }

  /** Near the ladder (for choosing it over the rigging when climbing). */
  nearLadder(head: THREE.Vector3): boolean {
    return this.onLadder(head, 1.2)
  }

  // ---- Into the deep, and back -----------------------------------------------------------------------

  /** You hit the water: splash, then the deep. */
  dunk(): void {
    if (this.deep >= 0) return
    const { player, camera, audio } = this.ctx
    const head = camera.getWorldPosition(this.v)
    audio.play('bigSplash', head, 1)
    this.ctx.splash.emit({ position: head.clone().setY(0.1), velocity: new THREE.Vector3(0, 3.5, 0), spread: 2, color: 0xe6f4fa, size: 0.08, life: 1.1, count: 60 })
    for (const h of this.ctx.hands()) h.pulse(0.9, 250)
    this.deep = 0
    player.inWater = false
    player.riding = true
    player.climbing = false
    // Under: your head a couple of metres down, the deep all round.
    player.placeHead(this.w.copy(head).setY(-2.2))
    audio.setEnvironment('water')
    this.dome.visible = true
  }

  update(dt: number): void {
    this.sign.face(this.ctx.camera)
    const { player, camera } = this.ctx
    if (this.deep >= 0) {
      this.deep += dt
      this.domeTime.value += dt
      const head = camera.getWorldPosition(this.v)
      this.dome.position.copy(this.dome.parent ? this.dome.parent.worldToLocal(head) : head)
      for (const b of this.bubbles) {
        b.position.y += dt * (0.5 + (b.id % 5) * 0.12)
        if (b.position.y > 1.1) b.position.y = -1.1
      }
      if (this.deep >= DEEP_SECONDS) this.surface()
      return
    }
    if (!this.climbing) return
    // Up the ladder: once your head's well over the rail, you're helped aboard.
    const head = camera.getWorldPosition(this.v)
    const p = this.ship.group.worldToLocal(this.w.copy(head))
    if (!this.onLadder(head, 1.5)) {
      this.climbing = false
      return
    }
    if (p.y > LADDER_TOP + 0.45) {
      this.climbing = false
      player.placeFeet(this.ship.group.localToWorld(this.w.set(LADDER_HALF - 0.75, DECK_Y, LADDER_Z)))
      player.climbing = false
      this.ctx.audio.play('thud', head, 0.6)
      for (const h of this.ctx.hands()) h.pulse(0.4, 80)
      this.ctx.say('Back aboard, dripping wet. Again?', 3)
    }
  }

  /** Out of the deep: hanging at the foot of the ladder, facing the hull. */
  private surface(): void {
    const { player, audio } = this.ctx
    this.deep = -1
    this.dome.visible = false
    audio.setEnvironment('air')
    player.riding = false
    // Facing the ship (along her -x, from the starboard side).
    const inward = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.ship.group.getWorldQuaternion(new THREE.Quaternion()))
    player.faceYaw(Math.atan2(-inward.x, -inward.z))
    const at = this.ship.group.localToWorld(new THREE.Vector3(LADDER_X + HOLD, 0, LADDER_Z))
    at.y = LADDER_BOTTOM + 1.95
    player.placeHead(at)
    player.climbing = true
    player.inWater = false
    this.climbing = true
    audio.play('splash', at, 0.6)
    this.ctx.say('Grab the rungs and climb back up the ladder!', 4)
  }

  /** Ship-local y of a world height at the ladder (the ship sits steady at anchor, but just in case). */
  private localY(worldY: number): number {
    const at = this.ship.group.localToWorld(new THREE.Vector3(LADDER_X, 0, LADDER_Z))
    at.y = worldY
    return this.ship.group.worldToLocal(at).y
  }
}
