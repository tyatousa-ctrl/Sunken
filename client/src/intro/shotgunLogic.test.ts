import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FlickDetector, ShotgunAction } from './shotgunLogic'

describe('shotgun action', () => {
  it('fires two shots, then is empty', () => {
    const gun = new ShotgunAction()
    assert.equal(gun.pull(), 'fired')
    assert.equal(gun.pull(), 'fired')
    assert.equal(gun.pull(), 'empty')
  })

  it('reloads with a flick down then up', () => {
    const gun = new ShotgunAction()
    gun.pull()
    gun.pull()
    assert.equal(gun.flickDown(), true)
    assert.equal(gun.pull(), 'open')
    assert.equal(gun.flickUp(), true)
    assert.equal(gun.shells, 2)
    assert.equal(gun.pull(), 'fired')
  })

  it('does not break open while still fully loaded', () => {
    const gun = new ShotgunAction()
    assert.equal(gun.flickDown(), false)
    assert.equal(gun.open, false)
  })

  it('can be topped up after one shot', () => {
    const gun = new ShotgunAction()
    gun.pull()
    assert.equal(gun.flickDown(), true)
    assert.equal(gun.flickUp(), true)
    assert.equal(gun.shells, 2)
  })

  it('reloads with the A/X fallback', () => {
    const gun = new ShotgunAction()
    gun.pull()
    gun.pull()
    assert.equal(gun.quickReload(), true)
    assert.equal(gun.shells, 2)
    assert.equal(gun.quickReload(), false)
  })
})

describe('flick detector', () => {
  it('ignores normal aiming speeds', () => {
    const flick = new FlickDetector()
    for (let i = 0; i < 100; i++) assert.equal(flick.feed(Math.sin(i) * 3, 1 / 72), null)
  })

  it('spots a fast flick down and a fast flick up', () => {
    const flick = new FlickDetector()
    assert.equal(flick.feed(-9, 1 / 72), 'down')
    // The bounce-back straight after doesn't count.
    assert.equal(flick.feed(9, 1 / 72), null)
    for (let i = 0; i < 20; i++) flick.feed(0, 1 / 72)
    assert.equal(flick.feed(9, 1 / 72), 'up')
  })
})
