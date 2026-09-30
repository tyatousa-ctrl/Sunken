import * as THREE from 'three'
import type { Galleon } from '../world/ship/Galleon'

// A rope slung between the two crow's nests, high over the deck. Grip it and pull yourself along hand
// over hand, dangling over nothing; at either end, climb into the nest (A/X).
export class NestRope {
  private readonly line = new THREE.Line3()
  private readonly a: THREE.Vector3
  private readonly b: THREE.Vector3
  private readonly p = new THREE.Vector3()
  private readonly q = new THREE.Vector3()

  /** `a`, `b`: its ends (ship-local), just outside each nest's rim. */
  constructor(
    private readonly ship: Galleon,
    a: THREE.Vector3,
    b: THREE.Vector3,
  ) {
    this.a = a.clone()
    this.b = b.clone()
    const tar = new THREE.MeshStandardMaterial({ color: 0x7a5c38, roughness: 0.95 })
    const length = a.distanceTo(b)
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, length, 6, 1).rotateX(Math.PI / 2), tar)
    rope.position.lerpVectors(a, b, 0.5)
    rope.lookAt(b)
    ship.shake.add(rope)
    // Lashed to each nest's rim.
    for (const end of [a, b]) {
      const lashing = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.02, 6, 10), tar)
      lashing.position.copy(end)
      ship.shake.add(lashing)
    }
  }

  /** Is a world point within `reach` of the rope? */
  near(point: THREE.Vector3, reach: number): boolean {
    this.ship.shake.updateWorldMatrix(true, false)
    this.line.set(this.ship.shake.localToWorld(this.p.copy(this.a)), this.ship.shake.localToWorld(this.q.copy(this.b)))
    return this.line.closestPointToPoint(point, true, this.p).distanceTo(point) < reach
  }
}
