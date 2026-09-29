import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'

// An oyster on the lagoon floor, under the waterfall. Grip it and it opens (and closes again when you
// grip it once more); one of them holds a pearl.
export class Oyster implements Interactable {
  readonly group = new THREE.Group()
  readonly pullable = false
  open = false
  private readonly lid = new THREE.Group()
  private angle = 0
  private readonly material: THREE.MeshStandardMaterial
  private readonly v = new THREE.Vector3()

  constructor(
    parent: THREE.Object3D,
    at: THREE.Vector3,
    yaw: number,
    private readonly audio: AudioSystem,
  ) {
    this.material = new THREE.MeshStandardMaterial({ color: 0x7a7266, roughness: 0.9, flatShading: true })
    const nacre = new THREE.MeshStandardMaterial({ color: 0xe8e0f0, roughness: 0.2, metalness: 0.3 })
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.material)
    bottom.scale.set(1, 0.4, 1.3)
    const inside = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), nacre)
    inside.rotation.x = -Math.PI / 2
    inside.scale.set(1, 1.28, 1)
    inside.position.y = 0.002
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.material)
    top.scale.set(1, 0.35, 1.3)
    // The lid hinges at the back edge.
    top.position.z = 0.2
    this.lid.position.z = -0.2
    this.lid.add(top)
    this.group.add(bottom, inside, this.lid)
    this.group.position.copy(at)
    this.group.rotation.y = yaw
    parent.add(this.group)
  }

  /** Where a pearl sits inside it (world). */
  get pearlSpot(): THREE.Vector3 {
    return this.group.localToWorld(new THREE.Vector3(0, 0.05, 0.02))
  }

  grabGap(point: THREE.Vector3): number {
    return point.distanceTo(this.group.getWorldPosition(this.v)) - 0.22
  }

  grab(hand: Hand): void {
    this.open = !this.open
    hand.pulse(0.4, 40)
    this.audio.play('click', this.group.getWorldPosition(this.v), 0.6)
    hand.held = null
  }

  release(): void {}

  setHighlight(on: boolean): void {
    this.material.emissive.setHex(on ? 0x2e7896 : 0x000000)
  }

  update(dt: number): void {
    const target = this.open ? -1.1 : 0
    this.angle += (target - this.angle) * Math.min(1, dt * 6)
    this.lid.rotation.x = this.angle
  }
}
