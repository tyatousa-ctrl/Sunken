import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ATTACK_SECONDS, TURN_SECONDS, TURN_START, formatClock, planVolleys, railsOpen, secondsLeft, sinkProgress, turnProgress, MAX_TILT_DEG } from './attackTimeline'

describe('attack timeline', () => {
  it('opens with a shot at the scoreboard, then brings down the foremast', () => {
    const shots = planVolleys()
    assert.equal(shots[0].target, 'scoreboard')
    assert.ok(shots.some((s) => s.target === 'foremast'))
  })

  it('holds fire until she has turned to face us', () => {
    assert.ok(planVolleys()[0].fireAt >= TURN_START + TURN_SECONDS)
  })

  it('is the same on every client', () => {
    assert.deepEqual(planVolleys(), planVolleys())
  })

  it('keeps all shots inside the attack, in order, with gaps', () => {
    const shots = planVolleys()
    for (let i = 1; i < shots.length; i++) assert.ok(shots[i].fireAt - shots[i - 1].fireAt >= 2.5)
    assert.ok(shots.at(-1)!.fireAt < ATTACK_SECONDS)
  })

  it('sinks monotonically from 0 to 1', () => {
    let prev = -1
    for (let t = 0; t <= ATTACK_SECONDS + 5; t += 0.5) {
      const p = sinkProgress(t)
      assert.ok(p >= prev)
      prev = p
    }
    assert.equal(sinkProgress(0), 0)
    assert.equal(sinkProgress(ATTACK_SECONDS), 1)
  })

  it('keeps the tilt under 10 degrees for comfort', () => {
    assert.ok(MAX_TILT_DEG < 10)
  })

  it('turns the enemy broadside within a few seconds', () => {
    assert.equal(turnProgress(0), 0)
    assert.equal(turnProgress(10), 1)
  })

  it('opens the rails when gear is done, or near the end regardless', () => {
    assert.equal(railsOpen(10, false), false)
    assert.equal(railsOpen(10, true), true)
    assert.equal(railsOpen(80, false), true)
  })

  it('counts down the clock', () => {
    assert.equal(formatClock(secondsLeft(0)), '1:30')
    assert.equal(formatClock(secondsLeft(85.2)), '0:05')
    assert.equal(secondsLeft(200), 0)
  })
})
