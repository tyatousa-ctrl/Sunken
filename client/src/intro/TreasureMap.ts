import * as THREE from 'three'

// The torn treasure map: parchment drawn in code, with the Sicilian coast, a dotted route through
// five dive sites, and four missing pieces (one found per level from Level 2 on).
export function makeMapTexture(): THREE.CanvasTexture {
  const W = 1024
  const H = 720
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // Parchment with burnt edges.
  const g = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.62)
  g.addColorStop(0, '#efe0b9')
  g.addColorStop(0.75, '#dcc48f')
  g.addColorStop(1, '#7a5528')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(110, 75, 30, ${Math.random() * 0.06})`
    ctx.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 2 + Math.random() * 6)
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
  const sites: [number, number, string][] = [
    [170, 330, 'I'],
    [330, 420, 'II'],
    [520, 330, 'III'],
    [690, 460, 'IV'],
    [840, 320, 'V'],
    [930, 520, 'X'],
  ]
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

  // Four torn-out pieces over sites II–V (the first level needs no piece).
  ctx.globalCompositeOperation = 'destination-out'
  for (const [x, y] of sites.slice(1, 5)) tearHole(ctx, x, y + 10, 95, 85)
  ctx.globalCompositeOperation = 'source-over'

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function tearHole(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath()
  const points = 18
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2
    const jag = 0.75 + Math.random() * 0.35
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
