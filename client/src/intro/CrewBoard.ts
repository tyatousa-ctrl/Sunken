import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Hand } from '../input/Hand'
import { CLASSES, CLASS_NAMES, type CharacterClass, type CrewMember } from '../systems/crew'
import { SKILLS } from '../systems/skills'
import { DECK_Y, type Galleon } from '../world/ship/Galleon'
import { deckHalfWidth } from './deck'

const BOARD_Z = -4
export const CREW_BOARD_SPOT = { x: deckHalfWidth(BOARD_Z) - 0.35, z: BOARD_Z }

const BLURB: Record<CharacterClass, string> = {
  navigator: 'Reads hidden ink: a hint on the map when stuck',
  strongman: 'Lifts, pushes and breaks heavy things alone',
  deepDiver: 'Double air; shares air with the crew',
  fishWhisperer: 'Calls sea creatures to help',
}

// The crew board by the main mast: four class plaques. Touch one to take that class (one each;
// bots take the rest). Each plaque shows who has it.
export class CrewBoard {
  private readonly plaques: { mesh: THREE.Mesh; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; cls: CharacterClass; drawn: string }[] = []
  private cooldown = 0
  /** A sign under the plaques with the crew's room code, for reading out to friends joining. */
  private readonly codeCanvas = document.createElement('canvas')
  private readonly codeTexture: THREE.CanvasTexture
  private codeDrawn: string | null = null
  private readonly v = new THREE.Vector3()

  constructor(
    ship: Galleon,
    private readonly audio: AudioSystem,
    private readonly choose: (cls: CharacterClass) => void,
  ) {
    const board = new THREE.Group()
    board.position.set(CREW_BOARD_SPOT.x, DECK_Y, CREW_BOARD_SPOT.z)
    board.rotation.y = -Math.PI / 2
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.85 })
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 0.05), wood)
    back.position.y = 1.45
    board.add(back)
    for (const x of [-0.85, 0.85]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.9, 0.07), wood)
      post.position.set(x, 0.95, -0.04)
      board.add(post)
    }
    const title = makeLabel('CREW: touch a plaque to pick your class', 1.8, 0.1)
    title.position.set(0, 1.95, 0.03)
    board.add(title)
    CLASSES.forEach((cls, i) => {
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }))
      mesh.position.set(-0.69 + i * 0.46, 1.45, 0.03)
      board.add(mesh)
      this.plaques.push({ mesh, canvas, texture, cls, drawn: '' })
    })
    this.codeCanvas.width = 512
    this.codeCanvas.height = 128
    this.codeTexture = new THREE.CanvasTexture(this.codeCanvas)
    this.codeTexture.colorSpace = THREE.SRGBColorSpace
    const codeSign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.225), new THREE.MeshStandardMaterial({ map: this.codeTexture, roughness: 0.9 }))
    codeSign.position.set(0, 0.86, 0.03)
    const codeBack = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.27, 0.04), wood)
    codeBack.position.set(0, 0.86, 0)
    board.add(codeBack, codeSign)
    this.drawCode('')
    ship.shake.add(board)
  }

  /** Show the crew's room code ('' when playing solo). */
  setCode(code: string): void {
    if (code !== this.codeDrawn) this.drawCode(code)
  }

  private drawCode(code: string): void {
    this.codeDrawn = code
    const ctx = this.codeCanvas.getContext('2d')!
    ctx.fillStyle = '#e8dcc0'
    ctx.fillRect(0, 0, 512, 128)
    ctx.strokeStyle = '#6b4527'
    ctx.lineWidth = 8
    ctx.strokeRect(4, 4, 504, 120)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#3b2413'
    if (code) {
      ctx.font = 'bold 26px Georgia, serif'
      ctx.fillText('CREW CODE (friends join with it)', 256, 40)
      ctx.font = 'bold 64px monospace'
      ctx.fillStyle = '#8a1c12'
      ctx.fillText(code.toUpperCase().split('').join(' '), 256, 106)
    } else {
      ctx.font = 'bold 30px Georgia, serif'
      ctx.fillText('Playing solo', 256, 56)
      ctx.font = '22px Georgia, serif'
      ctx.fillText('Create a crew on the start screen to get a code', 256, 94)
    }
    this.codeTexture.needsUpdate = true
  }

  update(dt: number, hands: Hand[], members: CrewMember[], meId: string): void {
    this.cooldown = Math.max(0, this.cooldown - dt)
    for (const p of this.plaques) {
      const holder = members.find((m) => m.character === p.cls)
      const label = holder ? (holder.id === meId ? 'You' : holder.bot ? `${holder.name}` : holder.name) : 'free'
      const key = `${label}|${holder?.color}|${holder?.id === meId}`
      if (key !== p.drawn) {
        p.drawn = key
        drawPlaque(p.canvas, p.cls, label, holder?.color ?? '#999', holder?.id === meId)
        p.texture.needsUpdate = true
      }
      if (this.cooldown > 0) continue
      p.mesh.getWorldPosition(this.v)
      const hand = hands.find((h) => h.connected && !h.held && h.worldPos(new THREE.Vector3()).distanceTo(this.v) < (h.virtual ? 0.5 : 0.18))
      if (hand && holder?.id !== meId) {
        this.cooldown = 1
        hand.pulse(0.4, 40)
        this.audio.play('click', this.v)
        this.choose(p.cls)
      }
    }
  }
}

function drawPlaque(canvas: HTMLCanvasElement, cls: CharacterClass, holder: string, color: string, mine: boolean): void {
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = mine ? '#f2e3b8' : '#e3d4ae'
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = mine ? '#c59a3c' : '#6b4527'
  ctx.lineWidth = mine ? 14 : 8
  ctx.strokeRect(6, 6, 244, 244)
  ctx.fillStyle = '#3b2413'
  ctx.textAlign = 'center'
  ctx.font = 'bold 30px Georgia, serif'
  ctx.fillText(CLASS_NAMES[cls], 128, 52)
  ctx.font = '19px Georgia, serif'
  const words = BLURB[cls].split(' ')
  let line = ''
  let y = 92
  for (const w of words) {
    if (ctx.measureText(line + w).width > 220) {
      ctx.fillText(line.trim(), 128, y)
      y += 24
      line = ''
    }
    line += w + ' '
  }
  ctx.fillText(line.trim(), 128, y)
  ctx.font = '17px Georgia, serif'
  ctx.fillText(`B skill · ${SKILLS[cls].cooldown} s`, 128, 180)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(40, 222, 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#3b2413'
  ctx.font = 'bold 22px system-ui, sans-serif'
  ctx.fillText(holder, 136, 230)
}

function makeLabel(text: string, width: number, height: number): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#e8dcc0'
  ctx.fillRect(0, 0, 1024, 64)
  ctx.fillStyle = '#3b2413'
  ctx.font = 'bold 36px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText(text, 512, 45)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: texture }))
}
