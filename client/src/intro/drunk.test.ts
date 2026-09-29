import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BLACKOUT_SECONDS, DrunkState, SOBER_SECONDS_PER_DRINK } from './drunk'

describe('drunk state', () => {
  it('is clear-headed when sober', () => {
    const fx = new DrunkState().effects()
    assert.equal(fx.fogScale, 1)
    assert.equal(fx.tint, 0)
    assert.equal(fx.walkDrift, 0)
    assert.equal(fx.walkSpeed, 1)
    assert.equal(fx.aimSway, 0)
  })

  it('moves through the tiers: fog first, then drift, then slow walking and aim sway', () => {
    const s = new DrunkState()
    s.drink(2)
    assert.equal(s.tier, 1)
    assert.ok(s.effects().fogScale < 1)
    assert.equal(s.effects().walkDrift, 0)
    s.drink(3)
    assert.equal(s.tier, 2)
    assert.ok(s.effects().walkDrift > 0)
    assert.equal(s.effects().walkSpeed, 1)
    s.drink(3)
    assert.equal(s.tier, 3)
    assert.ok(s.effects().walkSpeed < 1)
    assert.ok(s.effects().aimSway > 0)
  })

  it('blacks out at 10 drinks, then wakes up sober', () => {
    const s = new DrunkState()
    assert.equal(s.drink(9.5), null)
    assert.equal(s.drink(0.5), 'blackout')
    assert.equal(s.passedOut, true)
    // No drinking while passed out.
    assert.equal(s.drink(1), null)
    let event = null
    for (let t = 0; t <= BLACKOUT_SECONDS + 0.1; t += 0.1) event = s.update(0.1) ?? event
    assert.equal(event, 'wake')
    assert.equal(s.drinks, 0)
    assert.equal(s.passedOut, false)
  })

  it('wears off by about one drink every 45 s', () => {
    const s = new DrunkState()
    s.drink(3)
    s.update(SOBER_SECONDS_PER_DRINK)
    assert.ok(Math.abs(s.drinks - 2) < 1e-9)
  })

  it('sobers up instantly in the sea', () => {
    const s = new DrunkState()
    s.drink(6)
    s.sober()
    assert.equal(s.drinks, 0)
  })
})
