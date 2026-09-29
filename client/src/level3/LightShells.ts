import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'

/** How far off (degrees, seen from above) a bounce may be and still land on the next shell. */
const AIM_TOLERANCE = 8
/** Let go of a shell this close (degrees) to the right angle and it settles exactly into place. */
const SNAP = 10
const MISS_LENGTH = 14
const SHELL_RADIUS = 0.36

export interface BeamLayout {
  /** Where the light rises from the glowing water. */
  source: THREE.Vector3
  /** Shell centres, in the order the light should visit them. */
  shells: THREE.Vector3[]
  /** The middle of the carving the last shell must light. */
  target: THREE.Vector3
}

// Noon's light: a shaft of blue light rising out of the glowing water, three polished shells (big
// mother-of-pearl mirrors on stone stands) that can be turned by their rims, and the carved wall at the
// end. The beam bounces off each shell it reaches; when it lands on the carving, `onLit` fires.
export class LightShells {
  readonly shells: Shell[]
  lit = false
  /** How many shells the beam reaches right now. */
  reached = 0
  onLit: () => void = () => {}
  private readonly beams: THREE.Mesh[] = []
  private readonly glow: THREE.Mesh
  private readonly points: THREE.Vector3[] = []
  private readonly v = new THREE.Vector3()

  constructor(
    root: THREE.Object3D,
    private readonly layout: BeamLayout,
    audio: AudioSystem,
  ) {
    // Each shell starts turned well away from where it needs to point.
    const solution = this.solutionYaws()
    const offsets = [0.9, -1.1, 0.8]
    this.shells = layout.shells.map((at, i) => new Shell(root, at, solution[i] + offsets[i], audio, solution[i]))

    const core = new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    const haze = new THREE.MeshBasicMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })
    for (let i = 0; i < 4; i++) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), core)
      beam.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 10, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), haze))
      beam.visible = false
      root.add(beam)
      this.beams.push(beam)
    }
    // Where the light comes up: a bright patch on the water.
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 24), new THREE.MeshBasicMaterial({ color: 0xcff4ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.glow.rotation.x = -Math.PI / 2
    this.glow.position.copy(layout.source).setY(layout.source.y + 0.03)
    root.add(this.glow)
  }

  /** The yaw each shell needs to pass the light on (the mirror bisects in and out). */
  solutionYaws(): number[] {
    const { source, shells, target } = this.layout
    return shells.map((at, i) => {
      const from = i === 0 ? source : shells[i - 1]
      const to = i === shells.length - 1 ? target : shells[i + 1]
      const back = from.clone().sub(at).setY(0).normalize()
      const out = to.clone().sub(at).setY(0).normalize()
      const n = back.add(out).normalize()
      return Math.atan2(n.x, n.z)
    })
  }

  /** Everyone's solved it (or we're catching up): point the shells right. */
  solveNow(): void {
    this.solutionYaws().forEach((yaw, i) => this.shells[i].setYaw(yaw))
    this.lit = true
  }

  update(elapsed: number): void {
    const { source, shells, target } = this.layout
    const pts = this.points
    pts.length = 0
    pts.push(source)
    // The source aims itself at the first shell.
    let dir = shells[0].clone().sub(source).normalize()
    let at = source
    let reached = 0
    let hitTarget = false
    let end: THREE.Vector3 | null = null
    for (let i = 0; i < shells.length; i++) {
      pts.push(shells[i])
      reached = i + 1
      const n = this.shells[i].normal(this.v)
      // Light arriving on the back of the shell stops there.
      if (dir.dot(n) >= 0) break
      const out = dir.clone().addScaledVector(n, -2 * dir.dot(n))
      at = shells[i]
      const next = i === shells.length - 1 ? target : shells[i + 1]
      const want = next.clone().sub(at)
      const angle = Math.abs(Math.atan2(out.x, out.z) - Math.atan2(want.x, want.z))
      const off = THREE.MathUtils.radToDeg(Math.min(angle, Math.PI * 2 - angle))
      if (off > AIM_TOLERANCE) {
        end = at.clone().addScaledVector(out.setY(0).normalize(), MISS_LENGTH)
        break
      }
      dir = want.normalize()
      if (i === shells.length - 1) {
        hitTarget = true
        end = target
      }
    }
    if (end) pts.push(end)
    for (const [i, beam] of this.beams.entries()) {
      const a = pts[i]
      const b = pts[i + 1]
      beam.visible = !!(a && b)
      if (!a || !b) continue
      beam.position.copy(a)
      beam.lookAt(b)
      beam.scale.set(1, 1, a.distanceTo(b))
    }
    this.reached = reached
    for (const [i, s] of this.shells.entries()) s.setLit(i < reached, elapsed)
    ;(this.glow.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.2 * Math.sin(elapsed * 2.3)
    if (hitTarget && !this.lit) {
      this.lit = true
      this.onLit()
    }
  }
}

// A giant polished shell on a stone stand. Grip its rim and swing your hand round to turn it.
export class Shell implements Interactable {
  readonly group = new THREE.Group()
  private readonly mirror = new THREE.Group()
  private yaw: number
  private readonly holds = new Map<Hand, { handAngle: number; yaw: number }>()
  private readonly nacre: THREE.MeshStandardMaterial
  private readonly v = new THREE.Vector3()
  private tick = 0

  constructor(
    root: THREE.Object3D,
    private readonly at: THREE.Vector3,
    yaw: number,
    private readonly audio: AudioSystem,
    /** The angle that passes the light on (a turn ending close to it settles onto it). */
    private readonly solution: number,
  ) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x6d665b, roughness: 1, flatShading: true })
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 0.9, 8), stone)
    stand.position.y = -0.55
    this.group.add(stand)
    // The shell: a fan of ribs on a disc, its polished face on local +z.
    this.nacre = new THREE.MeshStandardMaterial({ color: 0xe8f2ff, roughness: 0.12, metalness: 0.85, emissive: 0x0b2a4a, side: THREE.DoubleSide })
    const disc = new THREE.Mesh(new THREE.CircleGeometry(SHELL_RADIUS, 32), this.nacre)
    const back = new THREE.Mesh(new THREE.SphereGeometry(SHELL_RADIUS, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9a98a, roughness: 0.8 }))
    back.rotation.x = -Math.PI / 2
    back.scale.set(1, 1, 0.35)
    this.mirror.add(disc, back)
    for (let i = -3; i <= 3; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.015, SHELL_RADIUS * 1.7, 0.02), new THREE.MeshStandardMaterial({ color: 0xd8c4ae, roughness: 0.7 }))
      rib.position.z = -0.03
      rib.rotation.z = i * 0.22
      this.mirror.add(rib)
    }
    this.group.add(this.mirror)
    this.group.position.copy(at)
    root.add(this.group)
    this.yaw = yaw
    this.setYaw(yaw)
  }

  /** The polished face's direction (horizontal, world). */
  normal(target: THREE.Vector3): THREE.Vector3 {
    return target.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
  }

  setYaw(yaw: number): void {
    this.yaw = yaw
    this.mirror.rotation.y = yaw
  }

  setLit(lit: boolean, elapsed: number): void {
    this.nacre.emissive.setHex(lit ? 0x2f8fd8 : 0x0b2a4a)
    this.nacre.emissiveIntensity = lit ? 0.8 + 0.2 * Math.sin(elapsed * 3) : 1
  }

  get center(): THREE.Vector3 {
    return this.at.clone()
  }

  grabGap(point: THREE.Vector3): number {
    return point.distanceTo(this.at) - SHELL_RADIUS - 0.08
  }

  grab(hand: Hand): void {
    this.holds.set(hand, { handAngle: this.handAngle(hand), yaw: this.yaw })
    hand.pulse(0.3, 30)
  }

  release(hand: Hand): void {
    this.holds.delete(hand)
    // Close enough: it settles into its groove with a satisfying clunk.
    let off = this.yaw - this.solution
    off = Math.atan2(Math.sin(off), Math.cos(off))
    if (Math.abs(off) < THREE.MathUtils.degToRad(SNAP) && Math.abs(off) > 1e-4) {
      this.setYaw(this.solution)
      hand.pulse(0.5, 60)
      this.audio.play('thud', this.at, 0.5)
    }
  }

  setHighlight(on: boolean): void {
    this.nacre.color.setHex(on ? 0xbfe6ff : 0xe8f2ff)
  }

  update(): void {
    const first = this.holds.entries().next().value
    if (!first) return
    const [hand, start] = first
    let d = this.handAngle(hand) - start.handAngle
    d = Math.atan2(Math.sin(d), Math.cos(d))
    const before = this.yaw
    this.setYaw(start.yaw + d)
    // A stony grind every few degrees.
    this.tick += Math.abs(this.yaw - before)
    if (this.tick > 0.12) {
      this.tick = 0
      hand.pulse(0.12, 15)
      this.audio.play('click', this.at, 0.25)
    }
  }

  /** Hand's angle round the stand (seen from above), in the fixed world frame. */
  private handAngle(hand: Hand): number {
    const p = hand.worldPos(this.v).sub(this.at)
    return Math.atan2(p.x, p.z)
  }
}
