import * as THREE from 'three'
import type { ItemKind } from './Inventory'

// Small 3D models for backpack items, built from primitives. Used when an item is taken out of
// the backpack and for collectibles placed in levels.
export function makeItem(kind: ItemKind): THREE.Group {
  const group = new THREE.Group()
  const std = (color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, ...opts })
  switch (kind) {
    case 'coin': {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 18), std(0xf2c230, { metalness: 0.9, roughness: 0.25, emissive: 0x4a3200 }))
      coin.rotation.x = Math.PI / 2
      group.add(coin)
      break
    }
    case 'gem': {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), std(0x2ad1c9, { metalness: 0.2, roughness: 0.05, emissive: 0x0b4a48 }))
      gem.scale.y = 1.4
      group.add(gem)
      break
    }
    case 'key': {
      const brass = std(0xe0b040, { metalness: 0.85, roughness: 0.3, emissive: 0x3a2800 })
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 16), brass)
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8), brass)
      shaft.rotation.z = Math.PI / 2
      shaft.position.x = 0.085
      const bit = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.006), brass)
      bit.position.set(0.13, -0.015, 0)
      group.add(bow, shaft, bit)
      break
    }
    case 'mapPiece': {
      const piece = new THREE.Mesh(new THREE.CircleGeometry(0.09, 9), std(0xdcc48f, { side: THREE.DoubleSide, roughness: 1, emissive: 0x2a1e08 }))
      piece.scale.set(1.1, 0.9, 1)
      group.add(piece)
      break
    }
    case 'shell': {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(0xe9c3b0))
      shell.scale.set(1, 0.45, 0.8)
      group.add(shell)
      break
    }
    default: {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), std(0x999999)))
    }
  }
  return group
}

/** Drawn icon for a backpack cell (canvas 2D, centred at cx, cy). */
export function drawItemIcon(ctx: CanvasRenderingContext2D, kind: ItemKind, cx: number, cy: number, size: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  const s = size / 2
  switch (kind) {
    case 'coin':
      ctx.fillStyle = '#f2c230'
      ctx.beginPath()
      ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#b8860b'
      ctx.font = `bold ${s * 0.8}px Georgia, serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('$', 0, 2)
      break
    case 'gem':
      ctx.fillStyle = '#2ad1c9'
      ctx.beginPath()
      ctx.moveTo(0, -s * 0.8)
      ctx.lineTo(s * 0.6, 0)
      ctx.lineTo(0, s * 0.8)
      ctx.lineTo(-s * 0.6, 0)
      ctx.closePath()
      ctx.fill()
      break
    case 'key':
      ctx.strokeStyle = '#e0b040'
      ctx.lineWidth = s * 0.16
      ctx.beginPath()
      ctx.arc(-s * 0.45, 0, s * 0.25, 0, Math.PI * 2)
      ctx.moveTo(-s * 0.2, 0)
      ctx.lineTo(s * 0.7, 0)
      ctx.moveTo(s * 0.55, 0)
      ctx.lineTo(s * 0.55, s * 0.3)
      ctx.stroke()
      break
    case 'mapPiece':
      ctx.fillStyle = '#dcc48f'
      ctx.beginPath()
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2
        const r = s * (0.55 + (i % 2) * 0.15)
        i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
      }
      ctx.fill()
      break
    case 'shell':
      ctx.fillStyle = '#e9c3b0'
      ctx.beginPath()
      ctx.arc(0, s * 0.2, s * 0.6, Math.PI, 0)
      ctx.fill()
      break
    default:
      ctx.fillStyle = '#999'
      ctx.fillRect(-s * 0.5, -s * 0.5, s, s)
  }
  ctx.restore()
}

export const ITEM_NAMES: Record<ItemKind, string> = {
  coin: 'Coins',
  gem: 'Gems',
  key: 'Key',
  mapPiece: 'Map piece',
  rune: 'Runes',
  lantern: 'Lantern',
  airCanister: 'Air',
  shell: 'Shells',
  pearl: 'Pearl',
}
