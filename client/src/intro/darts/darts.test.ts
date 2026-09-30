import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DartsGame } from './DartsGame'
import { MISS, RADII, scoreAt, type DartScore } from './scoring'

/** Point at the middle of a ring, `segment` degrees clockwise from the top. */
function at(degrees: number, r: number): [number, number] {
  const a = (degrees * Math.PI) / 180
  return [Math.sin(a) * r, Math.cos(a) * r]
}
const single = (n: number): DartScore => ({ points: n, multiplier: 1, segment: n, label: String(n) })
const double = (n: number): DartScore => ({ points: n * 2, multiplier: 2, segment: n, label: `D${n}` })
const treble = (n: number): DartScore => ({ points: n * 3, multiplier: 3, segment: n, label: `T${n}` })

describe('dart board scoring', () => {
  it('scores the bulls', () => {
    assert.equal(scoreAt(0, 0).points, 50)
    assert.equal(scoreAt(0.01, 0).points, 25)
  })

  it('puts 20 at the top and 6 on the right, 3 at the bottom, 11 on the left', () => {
    assert.equal(scoreAt(...at(0, 0.05)).segment, 20)
    assert.equal(scoreAt(...at(90, 0.05)).segment, 6)
    assert.equal(scoreAt(...at(180, 0.05)).segment, 3)
    assert.equal(scoreAt(...at(270, 0.05)).segment, 11)
  })

  it('handles segment edges (9° either side of centre)', () => {
    assert.equal(scoreAt(...at(8.9, 0.05)).segment, 20)
    assert.equal(scoreAt(...at(9.1, 0.05)).segment, 1)
    assert.equal(scoreAt(...at(351.1, 0.05)).segment, 20)
    assert.equal(scoreAt(...at(350.9, 0.05)).segment, 5)
  })

  it('scores trebles, doubles and misses', () => {
    assert.equal(scoreAt(...at(0, (RADII.trebleIn + RADII.trebleOut) / 2)).label, 'T20')
    assert.equal(scoreAt(...at(0, (RADII.doubleIn + RADII.doubleOut) / 2)).label, 'D20')
    assert.equal(scoreAt(...at(0, 0.2)).points, 0)
  })
})

describe('301 with double-out', () => {
  it('counts down and finishes on a double', () => {
    const g = new DartsGame([{ name: 'You', color: '#fff' }])
    g.throw(treble(20))
    g.throw(treble(20))
    g.throw(treble(20)) // 121 left
    g.throw(treble(20))
    g.throw(treble(19))
    const r = g.throw(double(2)) // 121 - 60 - 57 - 4 = 0
    assert.equal(r.won, true)
    assert.equal(g.winner?.name, 'You')
  })

  it('busts below zero, on 1, or finishing without a double', () => {
    const g = new DartsGame([{ name: 'You', color: '#fff' }])
    g.player.remaining = 40
    g.dartsThisTurn = 0
    ;(g as unknown as { turnStart: number }).turnStart = 40
    assert.equal(g.throw(single(20)).bust, false)
    assert.equal(g.throw(single(20)).bust, true) // 0 on a single
    assert.equal(g.player.remaining, 40)
    g.throw(single(19))
    assert.equal(g.throw(single(20)).bust, true) // leaves 1
    assert.equal(g.player.remaining, 40)
  })

  it('lets you finish on a single when double-out is off', () => {
    const g = new DartsGame([{ name: 'You', color: '#fff' }], '301', false)
    g.player.remaining = 20
    assert.equal(g.throw(single(20)).won, true)
  })

  it('rotates turns every three darts and keeps the last three', () => {
    const g = new DartsGame([
      { name: 'You', color: '#fff' },
      { name: 'Bot', color: '#000' },
    ])
    g.throw(single(1))
    g.throw(MISS)
    const r = g.throw(single(5))
    assert.equal(r.turnOver, true)
    assert.equal(g.player.name, 'Bot')
    assert.deepEqual(g.players[0].lastDarts, ['1', 'Miss', '5'])
    assert.equal(g.players[0].remaining, 295)
  })

  it('skips a blacked-out player', () => {
    const g = new DartsGame([
      { name: 'You', color: '#fff' },
      { name: 'Bot', color: '#000' },
    ])
    g.skipTurn()
    assert.equal(g.player.name, 'Bot')
  })

  it('501 starts at 501', () => {
    const g = new DartsGame([{ name: 'You', color: '#fff' }], '501')
    assert.equal(g.player.remaining, 501)
  })
})

describe('Around the Clock', () => {
  it('needs 1 to 20 in order, then the bull', () => {
    const g = new DartsGame([{ name: 'You', color: '#fff' }], 'clock')
    g.throw(single(2))
    assert.equal(g.player.target, 1)
    for (let n = 1; n <= 20; n++) {
      g.dartsThisTurn = 0
      g.throw(n % 2 ? double(n) : single(n))
    }
    assert.equal(g.player.target, 25)
    g.dartsThisTurn = 0
    assert.equal(g.throw({ points: 25, multiplier: 1, segment: 25, label: '25' }).won, true)
  })
})

describe('head to head (Red and Blue sets)', () => {
  it('lets the other side step in: their turn starts and the forfeit turn keeps its score', () => {
    const game = new DartsGame([{ name: 'Red', color: '#f00' }, { name: 'Blue', color: '#00f' }])
    game.throw(single(20))
    assert.equal(game.players[0].remaining, 281)
    game.startTurn(1)
    assert.equal(game.player.name, 'Blue')
    game.throw(treble(20))
    assert.equal(game.players[1].remaining, 241)
    assert.equal(game.players[0].remaining, 281)
    assert.equal(game.dartsThisTurn, 1)
  })

  it('a bust after stepping in goes back to that side\'s own start', () => {
    const game = new DartsGame([{ name: 'Red', color: '#f00' }, { name: 'Blue', color: '#00f' }], '301', false)
    game.startTurn(1)
    game.throw(treble(20))
    game.throw(treble(20))
    game.throw(treble(20))
    assert.equal(game.players[1].remaining, 121)
    assert.equal(game.player.name, 'Red')
    game.startTurn(1)
    game.throw(treble(20))
    game.throw(treble(20))
    game.throw(single(2))
    assert.equal(game.players[1].remaining, 121)
  })
})
