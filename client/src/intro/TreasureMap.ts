import * as THREE from 'three'

export interface MapState {
  /** Pieces the crew holds: 1 is the part you start with, 2–5 fill the torn holes. */
  pieces: number[]
  /** Riddle for the current level, inked across the sea. */
  riddle?: string
}

const W = 1024
const H = 720
/** Dive sites I–V and the X, in map pixels. Site n+1's piece is piece n+1. */
export const SITES: [number, number, string][] = [
  [170, 330, 'I'],
  [330, 420, 'II'],
  [520, 330, 'III'],
  [690, 460, 'IV'],
  [840, 320, 'V'],
  [930, 520, 'X'],
]

// The torn treasure map: parchment drawn in code, with the Sicilian coast, a dotted route through
// five dive sites, and four missing pieces (one per level from Level 1 on). Redraw it as pieces
// are found and new riddles appear.
export function makeMapTexture(state: MapState = { pieces: [1] }): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  drawMap(canvas, state)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

export function drawMap(canvas: HTMLCanvasElement, state: MapState): void {
  const ctx = canvas.getContext('2d')!
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, W, H)

  // Parchment with burnt edges.
  const g = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.62)
  g.addColorStop(0, '#efe0b9')
  g.addColorStop(0.75, '#dcc48f')
  g.addColorStop(1, '#7a5528')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  let seed = 7
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(110, 75, 30, ${rand() * 0.06})`
    ctx.fillRect(rand() * W, rand() * H, 2 + rand() * 6, 2 + rand() * 6)
  }

  const ink = '#3b2413'
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineWidth = 4
  ctx.lineJoin = 'round'

  // Coastline of Sicily across the top-left.
  ctx.beginPath()
  ctx.moveTo(40, 250)
  const coast = [
    [120, 215], [210, 232], [300, 190], [380, 205], [470, 160], [560, 150], [650, 120], [720, 70], [760, 30],
  ]
  for (const [x, y] of coast) ctx.lineTo(x, y)
  ctx.stroke()
  ctx.font = 'italic bold 54px Georgia, serif'
  ctx.fillText('Sicilia', 250, 130)
  // Etna.
  ctx.beginPath()
  ctx.moveTo(560, 110)
  ctx.lineTo(600, 45)
  ctx.lineTo(640, 110)
  ctx.stroke()
  ctx.font = '22px Georgia, serif'
  ctx.fillText('Etna', 580, 135)

  ctx.font = 'bold 44px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText('Mappa del Tesoro', W / 2 + 120, H - 40)

  // Route through the dive sites to the treasure.
  const sites = SITES
  ctx.setLineDash([10, 14])
  ctx.lineWidth = 5
  ctx.beginPath()
  sites.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.stroke()
  ctx.setLineDash([])
  for (const [x, y, label] of sites) {
    if (label === 'X') {
      ctx.strokeStyle = '#8c1c13'
      ctx.lineWidth = 9
      ctx.beginPath()
      ctx.moveTo(x - 24, y - 24)
      ctx.lineTo(x + 24, y + 24)
      ctx.moveTo(x + 24, y - 24)
      ctx.lineTo(x - 24, y + 24)
      ctx.stroke()
      ctx.strokeStyle = ink
      continue
    }
    ctx.beginPath()
    ctx.arc(x, y, 20, 0, Math.PI * 2)
    ctx.stroke()
    ctx.font = 'bold 26px Georgia, serif'
    ctx.fillText(label, x, y + 9)
  }
  ctx.font = 'italic 24px Georgia, serif'
  ctx.textAlign = 'left'
  ctx.fillText('The galleon', 110, 380)

  // Compass rose.
  ctx.save()
  ctx.translate(120, 590)
  ctx.lineWidth = 3
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(12, -12)
    ctx.lineTo(0, -70)
    ctx.lineTo(-12, -12)
    ctx.closePath()
    i % 2 ? ctx.stroke() : ctx.fill()
  }
  ctx.font = 'bold 26px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText('N', 0, -80)
  ctx.restore()

  // The current riddle, inked across the open sea.
  if (state.riddle) {
    ctx.font = 'italic 27px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#4a2a12'
    wrapText(ctx, `"${state.riddle}"`, 600, 585, 700, 32)
  }

  // Torn-out pieces over sites II–V; found pieces are back in place, with a seam of tape.
  for (let piece = 2; piece <= 5; piece++) {
    const [x, y] = sites[piece - 1]
    if (state.pieces.includes(piece)) {
      ctx.strokeStyle = 'rgba(120, 90, 40, 0.5)'
      ctx.lineWidth = 3
      ctx.setLineDash([6, 6])
      ctx.beginPath()
      ctx.ellipse(x, y + 10, 88, 78, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      continue
    }
    ctx.globalCompositeOperation = 'destination-out'
    tearHole(ctx, x, y + 10, 95, 85, piece)
    ctx.globalCompositeOperation = 'source-over'
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, width: number, lineHeight: number): void {
  let line = ''
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > width && line) {
      ctx.fillText(line, cx, y)
      line = word
      y += lineHeight
    } else line = test
  }
  if (line) ctx.fillText(line, cx, y)
}

function tearHole(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, seed: number): void {
  ctx.beginPath()
  const points = 18
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2
    // Same jagged edge every redraw (seeded by the piece number).
    const jag = 0.75 + (Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453 % 1 + 1) % 1 * 0.35
    const x = cx + Math.cos(a) * rx * jag
    const y = cy + Math.sin(a) * ry * jag
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
  }
  ctx.fill()
}

export function makeMapMesh(): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({ map: makeMapTexture(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 })
  return new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.4), material)
}
