import * as THREE from 'three'
import { drawEmblem, type Emblem } from './StoneDoor'

const COLORS = [0xe0662c, 0xc8322b, 0x8e4fb0, 0xe8a23a]
/** A hand this close (or your head) touches a starfish. */
const TOUCH_REACH = 0.22
const HEAD_REACH = 0.6

// A five-armed starfish lying on sand or rock. Touch it and it curls its arms and glows softly from
// then on. Three big ones carry a mark of the door's code on their undersides (pick them up and turn them over), framed in a dial's shape.
export class Starfish {
  readonly group = new THREE.Group()
  counted = false
  private readonly material: THREE.MeshStandardMaterial
  private wiggle = 0

  private readonly star: THREE.Mesh

  constructor(parent: THREE.Object3D, position: THREE.Vector3, index: number, tilt = new THREE.Euler(), size = 1) {
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
    const star = (this.star = new THREE.Mesh(geometry, this.material))
    star.scale.setScalar(size)
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

  /** How big it is (1: an ordinary starfish). */
  get size(): number {
    return this.star.scale.x
  }

  /** Carve a mark of the code on its underside, framed in its dial's shape: pick it up and turn it over. */
  setMark(symbol: string, emblem: Emblem, yaw: number): void {
    const size = this.star.scale.x
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12 * size, 0.12 * size).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: makeMark(symbol, emblem), transparent: true, depthWrite: false, roughness: 0.8, emissive: 0x6fd3f0, emissiveIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -2 }),
    )
    decal.position.y = -0.014 * size
    this.group.add(decal)
    this.group.rotation.y = yaw
  }

  /** Is a hand or head touching it? */
  touchedBy(point: THREE.Vector3, isHead: boolean): boolean {
    const reach = (isHead ? HEAD_REACH : TOUCH_REACH) * Math.max(1, this.star.scale.x * 0.6)
    return point.distanceTo(this.group.getWorldPosition(new THREE.Vector3())) < reach
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

/** A mark painted pale on the starfish's back: the dial's shape with the symbol inside. */
function makeMark(symbol: string, emblem: Emblem): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 256, 256)
  ctx.strokeStyle = ctx.fillStyle = '#fff4d6'
  ctx.lineWidth = 14
  drawEmblem(ctx, emblem, 128, 128, 96)
  ctx.font = 'bold 104px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 8
  ctx.strokeStyle = '#3b1a0a'
  const y = emblem === 'triangle' ? 150 : 132
  ctx.strokeText(symbol, 128, y)
  ctx.fillText(symbol, 128, y)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
