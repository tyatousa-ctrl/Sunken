import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'

const FLY_SPEED = 8
/** A hand this close to Polly (m) is petting her. */
const PET_REACH = 0.15
const EAT_SECONDS = 2.4
const GRAVITY = 9.8
const MAX_CRACKERS = 5

type Mode = 'perched' | 'chasing' | 'fetching' | 'returning' | 'eating' | 'outbound' | 'circling'

interface Cracker {
  /** Crew-wide id (negative until the server numbers a cracker we threw). */
  id: number
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  state: 'flying' | 'resting' | 'sinking' | 'caught'
  age: number
}

export interface ParrotContext {
  audio: AudioSystem
  crumbs: Particles
  /** Walkable surface under a world point for something at height `below`, or null over the sea. */
  ground: (x: number, z: number, below: number) => number | null
  /** The heads of the people on deck (Polly watches the nearest). */
  heads: () => THREE.Vector3[]
  /** Other players' hands (world), so she can be petted by anyone in the crew. */
  otherHands?: () => THREE.Vector3[]
  /** In a crew: this player threw a cracker (already flying here); tell the others. */
  onThrow?: (at: THREE.Vector3, velocity: THREE.Vector3, localId: number) => void
  /** In a crew, on the device that runs Polly: she caught cracker `id`. */
  onCatch?: (id: number) => void
}

/** What everyone else needs to draw Polly as the device running her sees her. */
export interface PollyState {
  /** World position and orientation. */
  p: number[]
  q: number[]
  /** Head rotation (x, y, z). */
  h: number[]
  /** How petted she is right now (0–1). */
  pet: number
  mode: string
  /** A cracker in her beak. */
  carried: boolean
  /** Counts her coos, so everyone hears each one once. */
  coo: number
}

// Polly, the ship's parrot, on her perch on the quarterdeck. Throw a cracker and she flies up,
// catches it (or fetches it from the deck), and eats it back on her perch. Pet her and she nuzzles
// into your hand and coos. She can also be sent to circle something far off (the ship in the bay).
export class Parrot {
  readonly group = new THREE.Group()
  private readonly body = new THREE.Group()
  private readonly head = new THREE.Group()
  private readonly wings: THREE.Group[] = []
  private readonly eyes: THREE.Mesh[] = []
  private mode: Mode = 'perched'
  private readonly crackers: Cracker[] = []
  private chase: Cracker | null = null
  private carried: THREE.Mesh | null = null
  private eatTimer = 0
  private crunchTimer = 0
  private cooTimer = 0
  private petPulse = 0
  private petting = 0
  private readonly target = new THREE.Vector3()
  private circle = 0
  private landing = 0
  private readonly v = new THREE.Vector3()
  private readonly w = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  private readonly beakTip: THREE.Object3D = new THREE.Object3D()
  /**
   * This device decides what Polly does (solo, or the crew's host). Everyone else follows the
   * state it shares; see `snapshot` and `applyState`.
   */
  private authority = true
  private coos = 0
  private lastCoo = -1
  private followed: PollyState | null = null
  private localId = 0
  /** Crackers we threw and she caught before the server numbered them. */
  private readonly pendingCatches = new Set<number>()
  private readonly q2 = new THREE.Quaternion()

  constructor(
    private readonly perch: THREE.Object3D,
    private readonly root: THREE.Object3D,
    private readonly ctx: ParrotContext,
  ) {
    const green = new THREE.MeshStandardMaterial({ color: 0x2c9a3f, roughness: 0.7 })
    const lime = new THREE.MeshStandardMaterial({ color: 0x7cc242, roughness: 0.7 })
    const red = new THREE.MeshStandardMaterial({ color: 0xd23a2a, roughness: 0.7 })
    const blue = new THREE.MeshStandardMaterial({ color: 0x2a6fd2, roughness: 0.6 })
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe8c33a, roughness: 0.5 })
    const beakMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.4 })
    const grey = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.8 })

    // Body sits upright on the perch, facing -z.
    this.body.position.y = 0.13
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), green)
    torso.scale.set(0.9, 1.35, 1)
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), lime)
    belly.scale.set(0.85, 1.2, 0.8)
    belly.position.set(0, -0.01, -0.03)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.012), red)
    tail.position.set(0, -0.15, 0.05)
    tail.rotation.x = 0.35
    const tailTip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.08, 0.01), blue)
    tailTip.position.set(0, -0.27, 0.09)
    tailTip.rotation.x = 0.35
    this.body.add(torso, belly, tail, tailTip)

    // Head on a neck pivot so it can look around, tilt and nuzzle.
    this.head.position.set(0, 0.1, -0.01)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 10), red)
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.9 }))
    face.position.set(0, 0, -0.03)
    face.scale.set(1.3, 1, 0.6)
    const upper = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.055, 8), yellow)
    upper.rotation.x = -Math.PI / 2 - 0.5
    upper.position.set(0, -0.005, -0.065)
    const lower = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.03, 8), beakMat)
    lower.rotation.x = -Math.PI / 2 + 0.3
    lower.position.set(0, -0.022, -0.055)
    this.head.add(skull, face, upper, lower)
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }))
      eye.position.set(side * 0.037, 0.012, -0.035)
      this.head.add(eye)
      this.eyes.push(eye)
    }
    this.beakTip.position.set(0, -0.02, -0.08)
    this.head.add(this.beakTip)
    this.body.add(this.head)

    // Wings hinge at the shoulders.
    for (const side of [-1, 1]) {
      const wing = new THREE.Group()
      wing.position.set(side * 0.06, 0.04, 0.01)
      const feathers = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.11), green)
      feathers.position.x = side * 0.1
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.01, 0.1), blue)
      tip.position.x = side * 0.22
      wing.add(feathers, tip)
      this.body.add(wing)
      this.wings.push(wing)
    }
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.04), grey)
      foot.position.set(side * 0.025, 0.015, 0)
      this.group.add(foot)
    }
    this.group.add(this.body)
    perch.add(this.group)
  }

  /** Busy (flying, eating): won't go for another cracker yet. */
  get busy(): boolean {
    return this.mode !== 'perched'
  }

  /** Fly out and circle something far away (the old story beat), then come home. */
  flyTo(target: THREE.Vector3): void {
    if (this.mode !== 'perched' || !this.authority) return
    this.target.copy(target)
    this.leavePerch()
    this.mode = 'outbound'
  }

  /** A cracker left a hand: into the air it goes (Polly will be after it). */
  throwCracker(mesh: THREE.Mesh, velocity: THREE.Vector3): void {
    this.root.attach(mesh)
    const id = -++this.localId
    this.addCracker(id, mesh, velocity)
    this.ctx.onThrow?.(mesh.position.clone(), velocity.clone(), id)
  }

  /** Another player threw a cracker. */
  addRemoteCracker(id: number, at: THREE.Vector3, velocity: THREE.Vector3): void {
    const mesh = makeCracker()
    mesh.position.copy(at)
    this.root.add(mesh)
    this.addCracker(id, mesh, velocity)
  }

  /** The server numbered a cracker we threw. */
  renameCracker(localId: number, id: number): void {
    const c = this.crackers.find((c) => c.id === localId)
    if (c) c.id = id
    if (this.pendingCatches.delete(localId)) this.ctx.onCatch?.(id)
  }

  /** Polly (run on another device) caught this cracker: it's gone from the air. */
  remoteCatch(id: number): void {
    const c = this.crackers.find((c) => c.id === id)
    if (c) this.removeCracker(c)
  }

  /** Run Polly here (solo, or as the crew's host) or follow the state someone else shares. */
  setAuthority(on: boolean): void {
    if (on === this.authority) return
    this.authority = on
    if (!on) return
    // Taking over: carry on from where she was last seen.
    this.chase = null
    if (this.group.parent !== this.perch) this.mode = 'returning'
    else if (this.mode !== 'eating') this.mode = 'perched'
    if (this.mode === 'eating') this.eatTimer = EAT_SECONDS / 2
  }

  /** Polly as this device runs her, for everyone else. */
  snapshot(): PollyState {
    const p = this.group.getWorldPosition(this.v)
    const q = this.group.getWorldQuaternion(this.q2)
    const r = (n: number) => Math.round(n * 1000) / 1000
    return {
      p: [r(p.x), r(p.y), r(p.z)],
      q: [r(q.x), r(q.y), r(q.z), r(q.w)],
      h: [r(this.head.rotation.x), r(this.head.rotation.y), r(this.head.rotation.z)],
      pet: r(this.petting),
      mode: this.mode,
      carried: this.carried !== null,
      coo: this.coos,
    }
  }

  /** The device running Polly says this is how she is. */
  applyState(state: PollyState): void {
    if (this.authority) return
    // The first state only syncs the coo count (no coo for coos we never heard).
    if (!this.followed) this.lastCoo = state.coo
    this.followed = state
  }

  update(dt: number, elapsed: number, hands: Hand[]): void {
    this.updateCrackers(dt)
    if (!this.authority) {
      this.follow(dt, elapsed, hands)
      this.animateWings(elapsed)
      return
    }
    this.animateWings(elapsed)

    switch (this.mode) {
      case 'perched':
        this.idle(dt, elapsed, hands)
        this.lookForCracker()
        break
      case 'eating':
        this.eat(dt, elapsed)
        break
      case 'chasing':
        this.updateChase(dt)
        break
      case 'fetching':
        this.updateFetch(dt)
        break
      case 'returning':
        this.updateReturn(dt)
        break
      case 'outbound': {
        const goal = this.v.copy(this.target).add(new THREE.Vector3(0, 12, 0))
        if (this.moveToward(goal, 11 * dt)) {
          this.mode = 'circling'
          this.circle = 0
        }
        break
      }
      case 'circling': {
        this.circle += dt * 0.7
        const goal = this.v.set(Math.cos(this.circle) * 9, 12, Math.sin(this.circle) * 9).add(this.target)
        this.moveToward(goal, 11 * dt)
        if (this.circle > Math.PI * 4) this.mode = 'returning'
        break
      }
    }
  }

  /** Wings: folded and breathing on the perch, beating in flight. */
  private animateWings(elapsed: number): void {
    const flying = this.mode !== 'perched' && this.mode !== 'eating'
    // Folded wings are tucked in (shorter); spread for flight.
    for (const wing of this.wings) wing.scale.setScalar(flying ? 1 : 0.72)
    if (flying) {
      const flap = Math.sin(elapsed * 24)
      this.wings[0].rotation.set(0, 0, -flap)
      this.wings[1].rotation.set(0, 0, flap)
    } else {
      // Folded flat against her sides, hanging down and back, lifting a touch as she breathes.
      const breathe = Math.sin(elapsed * 2) * 0.04
      this.wings[0].rotation.set(0.3, 0.25, 1.62 - breathe)
      this.wings[1].rotation.set(0.3, -0.25, -1.62 + breathe)
    }
  }

  /** Someone else runs Polly: glide to where they say she is, and do what she's doing. */
  private follow(dt: number, elapsed: number, hands: Hand[]): void {
    const s = this.followed
    if (!s) return
    if (this.group.parent !== this.root) this.root.attach(this.group)
    const k = 1 - Math.exp(-12 * dt)
    this.group.position.lerp(this.v.fromArray(s.p), k)
    this.group.quaternion.slerp(this.q2.fromArray(s.q), k)
    this.head.rotation.x += (s.h[0] - this.head.rotation.x) * k
    this.head.rotation.y += (s.h[1] - this.head.rotation.y) * k
    this.head.rotation.z += (s.h[2] - this.head.rotation.z) * k
    this.petting = s.pet
    this.body.scale.setScalar(1 + 0.06 * this.petting)
    for (const eye of this.eyes) eye.scale.y = 1 - 0.7 * this.petting
    this.mode = s.mode as Mode
    // The cracker in her beak.
    if (s.carried && !this.carried) {
      this.carried = makeCracker()
      this.beakTip.add(this.carried)
      this.carried.position.set(0, 0, -0.02)
      this.carried.rotation.set(Math.PI / 2, 0, 0)
    } else if (!s.carried && this.carried) {
      this.carried.removeFromParent()
      this.carried = null
    }
    if (this.mode === 'eating') this.crunch(dt)
    if (s.coo !== this.lastCoo) {
      this.lastCoo = s.coo
      this.ctx.audio.play('coo', this.head.getWorldPosition(this.v), 0.8)
    }
    // Petting her yourself: the purr is in your hand, wherever Polly is run.
    const petter = this.pettingHand(hands)
    if (petter) this.purr(petter, dt)
  }

  private pettingHand(hands: Hand[]): Hand | undefined {
    this.body.getWorldPosition(this.w)
    return hands.find((h) => h.connected && !h.held && h.worldPos(this.v).distanceTo(this.w) < PET_REACH + 0.06)
  }

  private purr(hand: Hand, dt: number): void {
    this.petPulse -= dt
    if (this.petPulse <= 0) {
      this.petPulse = 0.09
      hand.pulse(0.14, 70)
    }
  }

  private crunch(dt: number): void {
    this.crunchTimer -= dt
    if (this.crunchTimer <= 0) {
      this.crunchTimer = 0.18 + Math.random() * 0.12
      const at = this.beakTip.getWorldPosition(this.v)
      this.ctx.audio.play('crunch', at, 0.7)
      this.ctx.crumbs.emit({ position: at, velocity: new THREE.Vector3(0, -0.3, 0), spread: 0.5, color: 0xd9b36b, size: 0.012, life: 0.7, count: 3 })
    }
  }

  // ---- On the perch ------------------------------------------------------------------------------

  private idle(dt: number, elapsed: number, hands: Hand[]): void {
    // Petting: a free hand on her head or back (yours, or a crewmate's).
    const petter = this.pettingHand(hands)
    this.body.getWorldPosition(this.w)
    const otherPetter = petter ? null : (this.ctx.otherHands?.().find((p) => p.distanceTo(this.w) < PET_REACH + 0.06) ?? null)
    const petPoint = petter ? petter.worldPos(this.v).clone() : otherPetter
    if (petPoint) {
      this.petting = Math.min(1, this.petting + dt * 4)
      // Nuzzle: head turns into the hand and rubs against it; eyes half close; feathers fluff.
      const local = this.body.worldToLocal(this.v.copy(petPoint))
      const yaw = Math.atan2(-local.x, -local.z)
      this.head.rotation.y += (THREE.MathUtils.clamp(yaw, -1.2, 1.2) - this.head.rotation.y) * Math.min(1, dt * 6)
      this.head.rotation.z = Math.sin(elapsed * 7) * 0.35
      this.head.rotation.x = 0.25 + Math.sin(elapsed * 3.5) * 0.1
      this.body.scale.setScalar(1 + 0.06 * this.petting)
      // A soft purr of vibration in the petting hand, and a coo now and then.
      if (petter) this.purr(petter, dt)
      this.cooTimer -= dt
      if (this.cooTimer <= 0) {
        this.cooTimer = 1.1 + Math.random() * 0.6
        this.coos++
        this.ctx.audio.play('coo', this.head.getWorldPosition(this.v), 0.8)
      }
    } else {
      this.petting = Math.max(0, this.petting - dt * 2)
      this.cooTimer = Math.min(this.cooTimer, 0.2)
      this.body.scale.setScalar(1 + 0.06 * this.petting)
      // Watch the nearest person, with the odd curious head tilt.
      const heads = this.ctx.heads()
      this.head.getWorldPosition(this.w)
      const nearest = heads.reduce<THREE.Vector3 | null>((best, h) => (!best || h.distanceTo(this.w) < best.distanceTo(this.w) ? h : best), null)
      let yaw = 0
      if (nearest && nearest.distanceTo(this.w) < 6) {
        const local = this.body.worldToLocal(this.v.copy(nearest))
        yaw = THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z), -1.3, 1.3)
      }
      this.head.rotation.y += (yaw - this.head.rotation.y) * Math.min(1, dt * 3)
      this.head.rotation.z = Math.sin(elapsed * 0.7) > 0.93 ? 0.4 : this.head.rotation.z * (1 - Math.min(1, dt * 4))
      this.head.rotation.x *= 1 - Math.min(1, dt * 4)
    }
    for (const eye of this.eyes) eye.scale.y = 1 - 0.7 * this.petting
  }

  private lookForCracker(): void {
    const next = this.crackers.find((c) => c.state === 'flying' || c.state === 'resting')
    if (!next) return
    this.chase = next
    this.leavePerch()
    this.mode = next.state === 'flying' ? 'chasing' : 'fetching'
    this.ctx.audio.play('squawk', this.group.getWorldPosition(this.v), 0.6)
  }

  private eat(dt: number, elapsed: number): void {
    this.eatTimer -= dt
    this.head.rotation.x = 0.4 + Math.sin(elapsed * 14) * 0.15
    this.head.rotation.y *= 0.9
    this.crunch(dt)
    if (this.carried) this.carried.scale.setScalar(Math.max(0.05, this.eatTimer / EAT_SECONDS))
    if (this.eatTimer <= 0) {
      if (this.carried) {
        this.carried.removeFromParent()
        this.carried = null
      }
      this.mode = 'perched'
    }
  }

  // ---- In the air --------------------------------------------------------------------------------

  private updateChase(dt: number): void {
    const c = this.chase
    if (!c || c.state === 'caught') return this.goHome()
    if (c.state === 'sinking') {
      // Too late: it's in the sea.
      this.ctx.audio.play('squawk', this.group.getWorldPosition(this.v), 0.8)
      return this.goHome()
    }
    if (c.state === 'resting') {
      this.mode = 'fetching'
      return
    }
    // Aim a little ahead of the cracker.
    const lead = this.v.copy(c.mesh.position).addScaledVector(c.velocity, 0.15)
    this.moveToward(lead, FLY_SPEED * dt)
    if (this.beakTip.getWorldPosition(this.w).distanceTo(c.mesh.position) < 0.3) this.catch(c)
  }

  private updateFetch(dt: number): void {
    const c = this.chase
    if (!c || c.state !== 'resting') {
      if (c?.state === 'flying') this.mode = 'chasing'
      else this.goHome()
      return
    }
    const above = this.v.copy(c.mesh.position).add(new THREE.Vector3(0, 0.12, 0))
    if (this.moveToward(above, FLY_SPEED * 0.7 * dt)) {
      this.landing += dt
      if (this.landing > 0.35) this.catch(c)
    }
  }

  private updateReturn(dt: number): void {
    const home = this.perch.getWorldPosition(this.v)
    if (this.moveToward(home, FLY_SPEED * dt)) {
      this.perch.attach(this.group)
      this.group.position.set(0, 0, 0)
      this.group.rotation.set(0, 0, 0)
      if (this.carried) {
        this.mode = 'eating'
        this.eatTimer = EAT_SECONDS
      } else this.mode = 'perched'
    }
  }

  private catch(c: Cracker): void {
    c.state = 'caught'
    // Tell the crew it's gone (once the server has numbered it, if we threw it ourselves).
    if (c.id < 0) this.pendingCatches.add(c.id)
    else this.ctx.onCatch?.(c.id)
    this.removeCracker(c, false)
    this.carried = c.mesh
    this.beakTip.add(c.mesh)
    c.mesh.position.set(0, 0, -0.02)
    c.mesh.rotation.set(Math.PI / 2, 0, 0)
    this.chase = null
    this.ctx.audio.play('squawk', this.group.getWorldPosition(this.v), 0.5)
    this.mode = 'returning'
  }

  private goHome(): void {
    this.chase = null
    this.mode = 'returning'
  }

  private leavePerch(): void {
    this.root.attach(this.group)
    this.landing = 0
    this.head.rotation.set(0, 0, 0)
    this.body.scale.setScalar(1)
    for (const eye of this.eyes) eye.scale.y = 1
  }

  private moveToward(goal: THREE.Vector3, step: number): boolean {
    const to = this.w.copy(goal).sub(this.group.position)
    const dist = to.length()
    if (dist <= step) {
      this.group.position.copy(goal)
      return true
    }
    this.group.position.addScaledVector(to, step / dist)
    // Face the way she's flying (her front is -z), level-ish.
    const yaw = Math.atan2(-to.x, -to.z)
    this.q.setFromEuler(new THREE.Euler(0, yaw, 0))
    this.group.quaternion.slerp(this.q, Math.min(1, step * 3))
    return false
  }

  // ---- Crackers ------------------------------------------------------------------------------------

  private updateCrackers(dt: number): void {
    for (const c of [...this.crackers]) {
      c.age += dt
      if (c.state === 'flying') {
        c.velocity.y -= GRAVITY * dt
        c.mesh.position.addScaledVector(c.velocity, dt)
        c.mesh.rotation.x += dt * 8
        const p = c.mesh.position
        const floor = this.ctx.ground(p.x, p.z, p.y + 0.05)
        if (floor !== null && p.y <= floor + 0.01) {
          p.y = floor + 0.01
          c.state = 'resting'
          c.mesh.rotation.set(Math.PI / 2, 0, Math.random() * 6)
        } else if (floor === null && p.y < 0.05) {
          c.state = 'sinking'
          c.age = 0
        }
      } else if (c.state === 'sinking') {
        c.mesh.position.y -= dt * 0.3
        if (c.age > 2) this.removeCracker(c)
      }
    }
  }

  private addCracker(id: number, mesh: THREE.Mesh, velocity: THREE.Vector3): void {
    this.crackers.push({ id, mesh, velocity: velocity.clone(), state: 'flying', age: 0 })
    while (this.crackers.length > MAX_CRACKERS) this.removeCracker(this.crackers[0])
  }

  private removeCracker(c: Cracker, dispose = true): void {
    const i = this.crackers.indexOf(c)
    if (i >= 0) this.crackers.splice(i, 1)
    if (dispose) c.mesh.removeFromParent()
    if (this.chase === c) this.chase = null
  }
}

/** A cracker: a small square biscuit with docking holes. */
export function makeCracker(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.008), crackerMaterial())
  return mesh
}

let sharedCrackerMaterial: THREE.MeshStandardMaterial | null = null
function crackerMaterial(): THREE.MeshStandardMaterial {
  if (sharedCrackerMaterial) return sharedCrackerMaterial
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#d9b36b'
  ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = '#9a7436'
  for (let x = 12; x < 64; x += 20) for (let y = 12; y < 64; y += 20) {
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  sharedCrackerMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 })
  return sharedCrackerMaterial
}

// The pack of crackers on the table: grip it to take one, then throw it up for Polly (or just
// let go and she'll fetch it).
export class CrackerPack implements Interactable {
  readonly object: THREE.Group
  holder: Hand | null = null
  private held: THREE.Mesh | null = null
  private readonly home: THREE.Vector3
  private readonly materials: THREE.MeshStandardMaterial[] = []
  private readonly v = new THREE.Vector3()

  constructor(
    table: THREE.Object3D,
    private readonly polly: Parrot,
    private readonly audio: AudioSystem,
  ) {
    this.object = new THREE.Group()
    const paper = new THREE.MeshStandardMaterial({ color: 0xc7a46a, roughness: 0.9 })
    this.materials.push(paper)
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.07), paper)
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.162, 0.03, 0.072), new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.7 }))
    this.object.add(pack, band)
    // A few loose crackers spilling out of the open end.
    for (let i = 0; i < 3; i++) {
      const c = makeCracker()
      c.position.set(0.1 + i * 0.03, -0.025, (i - 1) * 0.025)
      c.rotation.set(Math.PI / 2, 0, i * 0.7)
      this.object.add(c)
    }
    this.object.position.set(0, 0.83, 0)
    table.add(this.object)
    this.home = this.object.position.clone()
  }

  grabGap(point: THREE.Vector3, hand: Hand): number {
    if (this.holder === hand) return Infinity
    return point.distanceTo(this.object.getWorldPosition(this.v)) - 0.1
  }

  grab(hand: Hand): void {
    // Pulled from a distance: the pack goes back on the table; you keep a cracker.
    this.object.position.copy(this.home)
    if (this.holder && this.holder !== hand) this.dropHeld()
    this.holder = hand
    this.held = makeCracker()
    hand.grip.add(this.held)
    this.held.position.set(0, 0.0, -0.06)
    hand.pulse(0.15, 15)
    this.audio.play('crunch', this.object.getWorldPosition(this.v), 0.3)
  }

  release(hand: Hand, throwVelocity: THREE.Vector3): void {
    if (hand !== this.holder) return
    this.holder = null
    const cracker = this.held
    this.held = null
    if (cracker) this.polly.throwCracker(cracker, throwVelocity.clone().multiplyScalar(1.1))
  }

  setHighlight(on: boolean): void {
    for (const m of this.materials) m.emissive.setHex(on ? 0x2e7896 : 0x000000)
  }

  private dropHeld(): void {
    if (this.holder) this.holder.held = null
    this.held?.removeFromParent()
    this.held = null
  }
}
