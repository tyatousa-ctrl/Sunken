import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import { drawMap, type MapState } from '../intro/TreasureMap'

const MAP_W = 0.56
const MAP_H = 0.4
const MIN_ZOOM = 0.7
const MAX_ZOOM = 2.2
/** The other hand must grip within this distance of the map to stretch it. */
const STRETCH_REACH = 0.12

// The treasure map in your hand. Left thumbstick click (M on desktop) holds it up in the left hand;
// grip it with the other hand and pull apart to zoom. The current riddle is inked on the front;
// hints you've unlocked are written on the back. After two minutes stuck, a compass needle in the
// corner points at the objective.
export class MapView {
  readonly group = new THREE.Group()
  private readonly frontCanvas = document.createElement('canvas')
  private readonly backCanvas = document.createElement('canvas')
  private readonly frontTexture: THREE.CanvasTexture
  private readonly backTexture: THREE.CanvasTexture
  private readonly compass = new THREE.Group()
  private readonly needle: THREE.Mesh
  private holder: Hand | null = null
  private stretcher: Hand | null = null
  private stretchStart = 0
  private zoomStart = 1
  private zoom = 1
  private readonly objective = new THREE.Vector3()
  private compassOn = false
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()

  constructor(
    scene: THREE.Object3D,
    private readonly audio: AudioSystem,
  ) {
    this.frontCanvas.width = 1024
    this.frontCanvas.height = 720
    this.backCanvas.width = 1024
    this.backCanvas.height = 720
    this.frontTexture = texture(this.frontCanvas)
    this.backTexture = texture(this.backCanvas)
    const paper = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.5, fog: false })
    const front = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), paper(this.frontTexture))
    const back = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), paper(this.backTexture))
    back.rotation.y = Math.PI
    this.group.add(front, back)

    // Brass compass in the bottom-left corner of the front.
    const brass = new THREE.MeshBasicMaterial({ color: 0xc59a3c, fog: false })
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.036, 24), brass)
    this.needle = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.05, 4), new THREE.MeshBasicMaterial({ color: 0xb3261e, fog: false }))
    this.compass.add(rim, this.needle)
    this.compass.position.set(-MAP_W / 2 + 0.05, -MAP_H / 2 + 0.05, 0.004)
    this.compass.visible = false
    this.group.add(this.compass)

    this.group.visible = false
    scene.add(this.group)
  }

  get isOpen(): boolean {
    return this.group.visible
  }

  /** Redraw both sides: pieces and riddle on the front, hints on the back. */
  setState(state: MapState, hints: string[]): void {
    drawMap(this.frontCanvas, state)
    this.frontTexture.needsUpdate = true
    drawBack(this.backCanvas, hints)
    this.backTexture.needsUpdate = true
  }

  /** Point the compass at a world position (shown only when `visible`). */
  setCompass(visible: boolean, target?: THREE.Vector3): void {
    this.compassOn = visible
    if (target) this.objective.copy(target)
  }

  toggle(hand: Hand): void {
    if (this.isOpen) this.close()
    else this.open(hand)
  }

  open(hand: Hand): void {
    this.holder = hand
    this.zoom = 1
    this.group.scale.setScalar(1)
    // Held up like a page in front of the hand, tilted toward the eyes.
    hand.grip.add(this.group)
    const side = hand.handedness === 'left' ? 1 : -1
    this.group.position.set(side * 0.16, 0.1, -0.12)
    this.group.rotation.set(-0.5, 0, 0)
    this.group.visible = true
    this.audio.play('pop', undefined, 0.5)
    hand.pulse(0.2, 25)
  }

  close(): void {
    this.group.visible = false
    this.holder = null
    this.stretcher = null
  }

  update(hands: Hand[]): void {
    if (!this.isOpen || !this.holder) return
    // Stretch-to-zoom with the other hand.
    const other = hands.find((h) => h !== this.holder && h.connected)
    if (other && !this.stretcher && other.squeezePressed && !other.held) {
      const onMap = this.group.worldToLocal(other.worldPos(this.a.clone()))
      if (Math.abs(onMap.z) < STRETCH_REACH && Math.abs(onMap.x) < (MAP_W / 2) * 1.3 && Math.abs(onMap.y) < (MAP_H / 2) * 1.3) {
        this.stretcher = other
        this.stretchStart = this.holder.worldPos(this.a).distanceTo(other.worldPos(this.b))
        this.zoomStart = this.zoom
      }
    }
    if (this.stretcher) {
      if (!this.stretcher.squeeze) this.stretcher = null
      else {
        const d = this.holder.worldPos(this.a).distanceTo(this.stretcher.worldPos(this.b))
        this.zoom = THREE.MathUtils.clamp((this.zoomStart * d) / Math.max(this.stretchStart, 0.05), MIN_ZOOM, MAX_ZOOM)
        this.group.scale.setScalar(this.zoom)
      }
    }

    this.compass.visible = this.compassOn
    if (this.compassOn) {
      // Needle points (in the map's plane) toward the objective's horizontal direction.
      this.group.getWorldPosition(this.a)
      const toGoal = this.b.subVectors(this.objective, this.a).setY(0)
      const local = toGoal.applyQuaternion(this.group.getWorldQuaternion(this.q).invert())
      // "Up" on the map means away from you, whether it's held upright (-z) or tilted back (+y).
      this.needle.rotation.z = Math.atan2(-local.x, local.y - local.z)
    }
  }
}

function texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function drawBack(canvas: HTMLCanvasElement, hints: string[]): void {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)
  const g = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.62)
  g.addColorStop(0, '#e6d4a8')
  g.addColorStop(0.8, '#cdb47c')
  g.addColorStop(1, '#6e4a22')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#4a2a12'
  ctx.textAlign = 'center'
  ctx.font = 'bold 40px Georgia, serif'
  ctx.fillText('Notes in faded ink', W / 2, 90)
  ctx.font = 'italic 30px Georgia, serif'
  if (hints.length === 0) {
    ctx.fillStyle = 'rgba(74, 42, 18, 0.45)'
    ctx.fillText('(Nothing yet. The ink appears when you need it.)', W / 2, 200)
    return
  }
  let y = 180
  hints.forEach((hint, i) => {
    let line = `${i + 1}. `
    for (const word of hint.split(' ')) {
      const test = line + word + ' '
      if (ctx.measureText(test).width > W - 160) {
        ctx.fillText(line.trim(), W / 2, y)
        y += 40
        line = word + ' '
      } else line = test
    }
    ctx.fillText(line.trim(), W / 2, y)
    y += 70
  })
}
