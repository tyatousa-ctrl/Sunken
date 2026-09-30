import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bidStands, countFace, isRaise, minRaise, nextSeat, packDice, rollDice, sailorMove, unpackDice } from './diceRules'

const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}

describe("Liar's Dice", () => {
  it('only accepts a raise', () => {
    assert.equal(isRaise(null, { q: 1, f: 2 }), true)
    assert.equal(isRaise({ q: 3, f: 4 }, { q: 3, f: 5 }), true)
    assert.equal(isRaise({ q: 3, f: 4 }, { q: 4, f: 1 }), true)
    assert.equal(isRaise({ q: 3, f: 4 }, { q: 3, f: 4 }), false)
    assert.equal(isRaise({ q: 3, f: 4 }, { q: 3, f: 2 }), false)
    assert.equal(isRaise({ q: 3, f: 4 }, { q: 2, f: 6 }), false)
    assert.equal(isRaise(null, { q: 1, f: 7 }), false)
    assert.deepEqual(minRaise({ q: 3, f: 4 }, 5), { q: 3, f: 5 })
    assert.deepEqual(minRaise({ q: 3, f: 4 }, 4), { q: 4, f: 4 })
  })

  it('settles a call of "Liar!"', () => {
    const hands = [[2, 2, 5], [2, 6], [1, 2, 3, 4, 5]]
    assert.equal(countFace(hands, 2), 4)
    assert.equal(bidStands(hands, { q: 4, f: 2 }), true)
    assert.equal(bidStands(hands, { q: 5, f: 2 }), false)
  })

  it('goes round the table, skipping players who are out', () => {
    assert.equal(nextSeat([5, 0, 3, 2], 0), 2)
    assert.equal(nextSeat([5, 0, 3, 0], 2), 0)
  })

  it('packs a hand into one number', () => {
    for (const hand of [[], [6], [1, 2, 3, 4, 5], [6, 6, 6, 6, 6]]) assert.deepEqual(unpackDice(packDice(hand)), hand)
  })

  it('sailors bid sensibly and call obvious lies', () => {
    const random = seeded(7)
    for (let i = 0; i < 200; i++) {
      const mine = rollDice(5, random)
      const open = sailorMove(mine, 15, null, random)
      assert.ok(open)
      assert.equal(isRaise(null, open!), true)
      const prev = { q: 3, f: 4 }
      const move = sailorMove(mine, 15, prev, random)
      if (move) assert.equal(isRaise(prev, move), true)
      // Twelve 6s out of fifteen dice, holding none: always a lie.
      assert.equal(sailorMove([1, 1, 2, 2, 3], 15, { q: 12, f: 6 }, random), null)
    }
  })
})
