import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Inventory, SLOTS } from './Inventory'
import { LevelProgress, type LevelData } from './LevelProgress'
import level1 from '../data/levels/level1.json'

describe('backpack inventory', () => {
  it('stacks coins in one slot and gives keys their own', () => {
    const inv = new Inventory()
    for (let i = 0; i < 20; i++) inv.add('coin')
    inv.add('key')
    assert.equal(inv.count('coin'), 20)
    assert.equal(inv.slots.filter(Boolean).length, 2)
  })

  it('holds 12 slots and refuses more', () => {
    const inv = new Inventory()
    for (let i = 0; i < SLOTS; i++) assert.notEqual(inv.add('key'), -1)
    assert.equal(inv.full, true)
    assert.equal(inv.add('lantern'), -1)
    // A stackable kind still fits if there's a stack to join... but there isn't one here.
    assert.equal(inv.add('coin'), -1)
  })

  it('takes items out and uses a key on a lock', () => {
    const inv = new Inventory()
    inv.add('coin')
    inv.add('coin')
    const slot = inv.add('key')
    assert.equal(inv.take(0), 'coin')
    assert.equal(inv.count('coin'), 1)
    assert.equal(inv.use('key'), true)
    assert.equal(inv.slots[slot], null)
    assert.equal(inv.use('key'), false)
  })
})

describe('level progress', () => {
  const data = level1 as LevelData

  it('has a riddle, three hint tiers and a reward', () => {
    assert.ok(data.riddle.length > 10)
    assert.equal(data.hints.length, 3)
    assert.equal(data.reward.mapPiece, 2)
    assert.equal(data.collectibles.coins, 20)
    assert.equal(data.collectibles.gems, 3)
  })

  it('only accepts steps in order and is solved after the last', () => {
    const p = new LevelProgress(data)
    assert.deepEqual(p.complete('takeKey'), [])
    for (const step of data.steps.slice(0, -1)) assert.equal(p.complete(step.id)[0].type, 'step')
    assert.equal(p.solved, false)
    const events = p.complete(data.steps.at(-1)!.id)
    assert.deepEqual(events.map((e) => e.type), ['step', 'solved'])
    assert.equal(p.solved, true)
  })

  it('unlocks the three hints one minute apart while stuck, then stops', () => {
    const p = new LevelProgress(data)
    const hints: number[] = []
    for (let t = 0; t < 400; t += 1) {
      const e = p.update(1)
      if (e?.type === 'hint') hints.push(e.tier)
    }
    assert.deepEqual(hints, [1, 2, 3])
  })

  it('progress resets the hint clock', () => {
    const p = new LevelProgress(data)
    for (let t = 0; t < 50; t++) p.update(1)
    p.complete('enterCabin')
    for (let t = 0; t < 50; t++) assert.equal(p.update(1), null)
  })

  it('shows the compass after two minutes without progress', () => {
    const p = new LevelProgress(data)
    for (let t = 0; t < 119; t++) p.update(1)
    assert.equal(p.compassVisible, false)
    p.update(2)
    assert.equal(p.compassVisible, true)
    p.complete('enterCabin')
    assert.equal(p.compassVisible, false)
  })
})

import { SKILLS, SkillCooldown } from './skills'

describe('skill cooldown', () => {
  it('uses the brief cooldowns', () => {
    assert.equal(SKILLS.strongman.cooldown, 20)
    assert.equal(SKILLS.navigator.cooldown, 45)
    assert.equal(SKILLS.deepDiver.cooldown, 60)
    assert.equal(SKILLS.fishWhisperer.cooldown, 30)
  })

  it('fires once, then waits out the cooldown', () => {
    const skill = new SkillCooldown(20)
    assert.equal(skill.trigger(), true)
    assert.equal(skill.trigger(), false)
    skill.update(19.9)
    assert.equal(skill.ready, false)
    skill.update(0.2)
    assert.equal(skill.trigger(), true)
  })
})
