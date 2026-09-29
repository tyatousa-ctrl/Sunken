import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chooseGoal, type BrainInput } from './brain'

const base: BrainInput = {
  now: 0,
  character: 'strongman',
  air: 1,
  canRefill: true,
  command: null,
  task: null,
  skillReady: true,
  nearestCollectible: Infinity,
  nearestHuman: 5,
  teammateLowOnAir: false,
}

describe('bot brain', () => {
  it('follows a human by default', () => {
    assert.equal(chooseGoal(base), 'follow')
    assert.equal(chooseGoal({ ...base, nearestHuman: Infinity }), 'idle')
  })

  it('refills air first when low', () => {
    assert.equal(chooseGoal({ ...base, air: 0.2, command: { kind: 'follow', until: 10 } }), 'refill')
  })

  it('obeys a human command until it runs out', () => {
    assert.equal(chooseGoal({ ...base, command: { kind: 'goTo', until: 10 } }), 'command')
    assert.equal(chooseGoal({ ...base, now: 11, command: { kind: 'goTo', until: 10 } }), 'follow')
  })

  it('does its puzzle job only with a human there, and only with its own class', () => {
    assert.equal(chooseGoal({ ...base, task: { skill: 'strongman', ready: true } }), 'task')
    assert.equal(chooseGoal({ ...base, task: { skill: 'strongman', ready: false } }), 'follow')
    assert.equal(chooseGoal({ ...base, character: 'navigator', task: { skill: 'strongman', ready: true } }), 'follow')
    assert.equal(chooseGoal({ ...base, task: { skill: 'strongman', ready: true }, skillReady: false }), 'follow')
  })

  it('picks up nearby treasure only while humans are around', () => {
    assert.equal(chooseGoal({ ...base, nearestCollectible: 3 }), 'collect')
    assert.equal(chooseGoal({ ...base, nearestCollectible: 3, nearestHuman: 30 }), 'follow')
  })

  it('the Deep Diver shares air with a teammate running low', () => {
    assert.equal(chooseGoal({ ...base, character: 'deepDiver', teammateLowOnAir: true }), 'shareAir')
    assert.equal(chooseGoal({ ...base, teammateLowOnAir: true }), 'follow')
  })
})
