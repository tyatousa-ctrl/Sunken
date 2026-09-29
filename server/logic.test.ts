import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ClaimTable, FirstWins, cleanName, generateCode, lowestFreeSlot, normalizeCode } from './logic.ts'

describe('room codes', () => {
  it('are four readable capital letters', () => {
    for (let i = 0; i < 200; i++) assert.match(generateCode(), /^[A-HJ-NP-Z]{4}$/)
  })

  it('normalise what people type', () => {
    assert.equal(normalizeCode(' abcd '), 'ABCD')
    assert.equal(normalizeCode('a-b c d9e'), 'ABCD')
  })
})

describe('slots', () => {
  it('fill from the lowest free slot and cap at four', () => {
    assert.equal(lowestFreeSlot([]), 0)
    assert.equal(lowestFreeSlot([0, 2]), 1)
    assert.equal(lowestFreeSlot([0, 1, 2, 3]), -1)
  })
})

describe('claims', () => {
  it('first grab wins until released', () => {
    const t = new ClaimTable()
    assert.equal(t.claim('gun0', 'a'), true)
    assert.equal(t.claim('gun0', 'b'), false)
    assert.equal(t.claim('gun0', 'a'), true)
    assert.equal(t.release('gun0', 'b'), false)
    assert.equal(t.release('gun0', 'a'), true)
    assert.equal(t.claim('gun0', 'b'), true)
  })

  it('releases everything a leaving player held', () => {
    const t = new ClaimTable()
    t.claim('gun0', 'a')
    t.claim('key', 'a')
    t.claim('gun1', 'b')
    assert.deepEqual(t.releaseAll('a').sort(), ['gun0', 'key'])
    assert.equal(t.owner('gun1'), 'b')
  })
})

describe('first wins', () => {
  it('lets only the first report count', () => {
    const f = new FirstWins()
    assert.equal(f.tryTake('coin3'), true)
    assert.equal(f.tryTake('coin3'), false)
    assert.deepEqual(f.all, ['coin3'])
  })
})

describe('names', () => {
  it('trims, strips and falls back', () => {
    assert.equal(cleanName('  Ty <script> ', 'Gold'), 'Ty script')
    assert.equal(cleanName('', 'Gold'), 'Gold')
    assert.equal(cleanName(42, 'Blue'), 'Blue')
    assert.equal(cleanName('a'.repeat(40), 'X').length, 16)
  })
})
