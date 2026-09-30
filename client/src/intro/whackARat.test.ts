import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ROUND_SECONDS, makeSchedule } from './WhackARat'

describe('Whack-a-Rat schedule', () => {
  it('is the same on every device for the same seed', () => {
    assert.deepEqual(makeSchedule(1234), makeSchedule(1234))
    assert.notDeepEqual(makeSchedule(1234), makeSchedule(99))
  })

  it('fits in the round, never pops a rat in a hole that is still busy, and speeds up', () => {
    for (const seed of [1, 42, 777, 123456]) {
      const pops = makeSchedule(seed)
      assert.ok(pops.length > 25, `enough rats (${pops.length})`)
      for (const p of pops) assert.ok(p.t >= 0 && p.t < ROUND_SECONDS)
      for (let i = 0; i < pops.length; i++) {
        for (let j = i + 1; j < pops.length; j++) {
          if (pops[i].hole !== pops[j].hole) continue
          assert.ok(pops[j].t >= pops[i].t + pops[i].duration, `hole ${pops[i].hole} reused while busy`)
        }
      }
      const first = pops.filter((p) => p.t < 10).length
      const last = pops.filter((p) => p.t > ROUND_SECONDS - 10).length
      assert.ok(last > first, `faster at the end (${first} → ${last})`)
    }
  })
})
