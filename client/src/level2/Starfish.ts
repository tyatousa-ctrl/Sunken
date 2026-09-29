import * as THREE from 'three'

const COLORS = [0xe0662c, 0xc8322b, 0x8e4fb0, 0xe8a23a]
/** A hand this close (or your head) touches a starfish. */
const TOUCH_REACH = 0.22
const HEAD_REACH = 0.6

// One of the "stars that live below": a five-armed starfish lying on sand or rock. Touch it and it
// curls its arms and glows softly from then on, so you know you've counted it. (The count itself
// stays in your head: that's the riddle.)
export class Starfish {
  readonly group = new THREE.Group()
  counted = false
  private readonly material: THREE.MeshStandardMaterial
  private wiggle = 0

  constructor(parent: THREE.Object3D, position: THREE.Vector3, index: number, tilt = new THREE.Euler()) {
    const shape = new THREE.Shape()
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.13 : 0.045
      const a = (i / 10) * Math.PI * 2
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r)
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    shape.closePath()
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2 })
    geometry.rotateX(-Math.PI / 2)
    this.material = new THREE.MeshStandardMaterial({ color: COLORS[index % COLORS.length], roughness: 0.8 })
    const star = new THREE.Mesh(geometry, this.material)
    // Knobbly dots down the arms.
    const dotMat = new THREE.MeshStandardMaterial({ color: 0xf6e3b8, roughness: 0.9 })
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      for (const r of [0.05, 0.09]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 5, 4), dotMat)
        dot.position.set(Math.cos(a) * r, 0.045, -Math.sin(a) * r)
        star.add(dot)
      }
    }
    this.group.add(star)
    this.group.position.copy(position)
    this.group.rotation.copy(tilt)
    this.group.rotation.y += index * 1.3
    parent.add(this.group)
  }

  /** Is a hand or head touching it? */
  touchedBy(point: THREE.Vector3, isHead: boolean): boolean {
    return point.distanceTo(this.group.getWorldPosition(new THREE.Vector3())) < (isHead ? HEAD_REACH : TOUCH_REACH)
  }

  /** Touched: glow from now on, and curl up for a moment. */
  count(): void {
    this.wiggle = 1
    if (this.counted) return
    this.counted = true
    this.material.emissive.setHex(0x5a2a10)
  }

  update(dt: number, elapsed: number): void {
    if (this.wiggle > 0) this.wiggle = Math.max(0, this.wiggle - dt)
    const curl = 1 - this.wiggle * 0.25 * Math.abs(Math.sin(this.wiggle * 12))
    this.group.scale.set(curl, 1, curl)
    if (this.counted) this.material.emissiveIntensity = 0.8 + 0.4 * Math.sin(elapsed * 2)
  }
}
