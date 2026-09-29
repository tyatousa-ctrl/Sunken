import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { BoxCollider } from '../movement/environment'
import { applyCaustics } from '../world/caustics'
import { sandHeight } from '../world/SeabedScene'

const OPEN_SECONDS = 3

// A stone arch in the reef with an iron grille: the way on to Level 2. The grille sinks into the
// sand when the level's riddle is solved.
export class ExitGate {
  readonly group = new THREE.Group()
  readonly collider: BoxCollider
  opened = false
  private readonly grille = new THREE.Group()
  private openT = -1

  constructor(
    position: THREE.Vector3,
    /** Yaw so the arch's opening faces the level. */
    yaw: number,
    private readonly audio: AudioSystem,
    /** Sand height (the level's seabed). */
    floor: (x: number, z: number) => number = sandHeight,
  ) {
    const rock = new THREE.MeshStandardMaterial({ color: 0x3b3534, roughness: 1, flatShading: true })
    applyCaustics(rock, 0.6)
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.6, metalness: 0.6 })
    for (const x of [-2.1, 2.1]) {
      const pillar = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), rock)
      pillar.scale.set(1.0, 2.6, 1.1)
      pillar.position.set(x, 1.8, 0)
      this.group.add(pillar)
    }
    const lintel = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), rock)
    lintel.scale.set(3.3, 0.9, 1.2)
    lintel.position.y = 4.3
    this.group.add(lintel)
    for (let i = -4; i <= 4; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.8, 6), iron)
      bar.position.set(i * 0.33, 1.9, 0)
      this.grille.add(bar)
    }
    for (const y of [0.8, 2.2, 3.4]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.08, 0.08), iron)
      rail.position.y = y
      this.grille.add(rail)
    }
    this.group.add(this.grille)
    this.group.position.set(position.x, floor(position.x, position.z) - 0.2, position.z)
    this.group.rotation.y = yaw
    this.group.updateMatrixWorld(true)

    // The closed grille blocks the opening.
    const matrix = new THREE.Matrix4().makeTranslation(0, 2, 0).premultiply(this.group.matrixWorld)
    this.collider = { matrix, inverse: matrix.clone().invert(), half: new THREE.Vector3(1.5, 2, 0.15) }
  }

  /** Centre of the opening (world), for "swam through" checks and the compass. */
  get center(): THREE.Vector3 {
    return this.group.localToWorld(new THREE.Vector3(0, 2, 0))
  }

  open(): void {
    if (this.opened) return
    this.opened = true
    this.openT = 0
    this.audio.play('impact', this.center, 0.7)
  }

  /** True once the head has passed through the opening to the far side. */
  passedThrough(head: THREE.Vector3): boolean {
    if (!this.opened) return false
    const local = this.group.worldToLocal(head.clone())
    return local.z < -0.8 && Math.abs(local.x) < 2 && local.y < 4.5
  }

  update(dt: number): void {
    if (this.openT < 0 || this.openT >= 1) return
    this.openT = Math.min(1, this.openT + dt / OPEN_SECONDS)
    this.grille.position.y = -4 * this.openT * this.openT
  }
}
