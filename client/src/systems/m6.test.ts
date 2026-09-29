import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CLASSES, crewMembers, freeClass, hostOf, type HumanSeat } from './crew'
import { recognize, type Point } from './gesture'

const seat = (id: string, slot: number, character: HumanSeat['character'], connected = true): HumanSeat => ({ id, slot, name: id, character, connected })

describe('crew members', () => {
  it('solo: one human and three bots with the other three classes', () => {
    const crew = crewMembers([seat('me', 0, 'navigator')])
    assert.equal(crew.length, 4)
    assert.deepEqual(crew.map((m) => m.bot), [false, true, true, true])
    assert.deepEqual(new Set(crew.map((m) => m.character)), new Set(CLASSES))
  })

  it('a dropped player is covered by a bot with their class', () => {
    const crew = crewMembers([seat('a', 0, 'navigator'), seat('b', 1, 'strongman', false)])
    const stand = crew[1]
    assert.equal(stand.bot, true)
    assert.equal(stand.character, 'strongman')
    assert.equal(stand.standingInFor, 'b')
    assert.equal(stand.name, "b's bot")
  })

  it('four humans: no bots', () => {
    const crew = crewMembers([seat('a', 0, 'navigator'), seat('b', 1, 'strongman'), seat('c', 2, 'deepDiver'), seat('d', 3, 'fishWhisperer')])
    assert.equal(crew.filter((m) => m.bot).length, 0)
  })

  it('the lowest connected human hosts the bots', () => {
    assert.equal(hostOf([seat('a', 0, 'navigator', false), seat('b', 2, 'strongman')]), 'b')
    assert.equal(hostOf([]), null)
  })

  it('new arrivals get a class nobody has', () => {
    assert.equal(freeClass([seat('a', 0, 'strongman')], 'strongman'), 'navigator')
    assert.equal(freeClass([seat('a', 0, 'strongman')], 'deepDiver'), 'deepDiver')
  })
})

describe('spell gestures', () => {
  const jitter = (points: Point[], amount: number, seed = 3) => {
    let s = seed
    const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * amount
    return points.map((p) => ({ x: p.x + r(), y: p.y + r() }))
  }
  const circle = (n = 50, r = 0.2) => Array.from({ length: n }, (_, i) => ({ x: Math.cos((i / (n - 1)) * Math.PI * 2) * r, y: Math.sin((i / (n - 1)) * Math.PI * 2) * r }))
  const lines = (vs: Point[], per = 12) => vs.slice(0, -1).flatMap((v, i) => Array.from({ length: per }, (_, k) => ({ x: v.x + ((vs[i + 1].x - v.x) * k) / per, y: v.y + ((vs[i + 1].y - v.y) * k) / per })))

  it('recognises a wobbly hand-drawn circle', () => {
    assert.equal(recognize(jitter(circle(), 0.03)).shape, 'circle')
  })

  it('recognises a triangle, either way round, a bit tilted', () => {
    const tri = lines([{ x: 0, y: 0.25 }, { x: 0.22, y: -0.15 }, { x: -0.2, y: -0.12 }, { x: 0, y: 0.25 }])
    assert.equal(recognize(jitter(tri, 0.02)).shape, 'triangle')
    assert.equal(recognize(jitter([...tri].reverse(), 0.02)).shape, 'triangle')
  })

  it('recognises a zigzag', () => {
    const zig = lines([{ x: -0.3, y: 0.1 }, { x: -0.15, y: -0.1 }, { x: 0, y: 0.1 }, { x: 0.15, y: -0.1 }, { x: 0.3, y: 0.1 }])
    assert.equal(recognize(jitter(zig, 0.015)).shape, 'zigzag')
  })

  it('rejects scribbles and tiny twitches', () => {
    assert.equal(recognize([{ x: 0, y: 0 }, { x: 0.001, y: 0 }]).shape, null)
    const line = lines([{ x: -0.3, y: 0 }, { x: 0.3, y: 0.01 }])
    assert.notEqual(recognize(line).shape, 'circle')
  })
})
