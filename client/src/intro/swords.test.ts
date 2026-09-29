import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { closestBetweenSegments } from './Swords'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

describe('blade contact (closest points between segments)', () => {
  it('finds crossing blades', () => {
    const a = v(0, 0, 0)
    const b = v(0, 0, 0)
    const d = closestBetweenSegments(v(-1, 0, 0), v(1, 0, 0), v(0, -1, 0.02), v(0, 1, 0.02), a, b)
    assert.ok(Math.abs(d - 0.02) < 1e-9)
    assert.ok(a.distanceTo(v(0, 0, 0)) < 1e-9)
    assert.ok(b.distanceTo(v(0, 0, 0.02)) < 1e-9)
  })

  it('measures from the ends when blades miss', () => {
    const d = closestBetweenSegments(v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(3, 0, 0), v(0, 0, 0), v(0, 0, 0))
    assert.ok(Math.abs(d - 1) < 1e-9)
  })

  it('handles parallel blades', () => {
    const d = closestBetweenSegments(v(0, 0, 0), v(1, 0, 0), v(0.5, 0.03, 0), v(1.5, 0.03, 0), v(0, 0, 0), v(0, 0, 0))
    assert.ok(Math.abs(d - 0.03) < 1e-9)
  })
})
