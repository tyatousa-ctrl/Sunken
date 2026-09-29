import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { SwimPhysics, type HandSample } from './SwimPhysics'
import { AirTank } from './AirTank'
import { TUNING } from './tuning'

const DT = 1 / 72

function assertClose(actual: number, expected: number, digits: number) {
  assert.ok(Math.abs(actual - expected) < 10 ** -digits / 2, `${actual} is not close to ${expected}`)
}

function hand(overrides: Partial<HandSample> = {}): HandSample {
  return {
    gripHeld: false,
    trigger: 0,
    velocity: new Vector3(),
    pointDir: new Vector3(0, 0, -1),
    offset: new Vector3(0.3, -0.3, -0.2),
    ...overrides,
  }
}

function run(physics: SwimPhysics, hands: HandSample[], seconds: number, drift = new Vector3()) {
  let result = physics.step({ hands, drift, dt: DT })
  for (let t = DT; t < seconds; t += DT) result = physics.step({ hands, drift, dt: DT })
  return result
}

describe('bubble jets', () => {
  it('push the diver opposite to where the hand points', () => {
    const physics = new SwimPhysics()
    run(physics, [hand({ trigger: 1, pointDir: new Vector3(0, 0, 1) })], 0.5)
    assert.ok(physics.velocity.z < -0.5)
    assert.ok(Math.abs(physics.velocity.x) < 1e-6)
  })

  it('scale thrust with trigger pressure', () => {
    const half = new SwimPhysics()
    const full = new SwimPhysics()
    run(half, [hand({ trigger: 0.5 })], 0.3)
    run(full, [hand({ trigger: 1 })], 0.3)
    assert.ok(full.velocity.length() > half.velocity.length() * 1.8)
  })

  it('give a 1.5× boost when both hands fire together', () => {
    const one = new SwimPhysics()
    const two = new SwimPhysics()
    one.step({ hands: [hand({ trigger: 1 }), hand()], drift: new Vector3(), dt: DT })
    two.step({ hands: [hand({ trigger: 1 }), hand({ trigger: 1 })], drift: new Vector3(), dt: DT })
    assertClose(two.velocity.length() / one.velocity.length(), 1.5, 5)
  })

  it('top out at about 4 m/s', () => {
    const physics = new SwimPhysics()
    run(physics, [hand({ trigger: 1 }), hand({ trigger: 1 })], 10)
    assert.ok(physics.velocity.length() > 3.8)
    assert.ok(physics.velocity.length() <= TUNING.jetMaxSpeed + 1e-9)
  })

  it('use air faster than calm swimming', () => {
    const calm = new AirTank()
    const jetting = new AirTank()
    calm.drain(10, [0, 0])
    jetting.drain(10, [1, 1])
    assert.ok(jetting.air < calm.air)
    assertClose(calm.capacity - calm.air, 10 * TUNING.airBaseDrain, 2)
  })

  it('spin the diver when the hands point in opposite directions', () => {
    const physics = new SwimPhysics()
    const right = hand({ trigger: 1, pointDir: new Vector3(0, 0, -1), offset: new Vector3(0.5, 0, 0) })
    const left = hand({ trigger: 1, pointDir: new Vector3(0, 0, 1), offset: new Vector3(-0.5, 0, 0) })
    run(physics, [right, left], 0.5)
    assert.ok(physics.yawRate < -0.1)
    assert.ok(physics.velocity.length() < 0.01)
  })

  it('do not spin when both hands point the same way', () => {
    const physics = new SwimPhysics()
    run(physics, [hand({ trigger: 1 }), hand({ trigger: 1, offset: new Vector3(-0.3, -0.3, -0.2) })], 1)
    assert.equal(physics.yawRate, 0)
  })
})

describe('arm strokes', () => {
  it('pull the diver opposite to the hand motion', () => {
    const physics = new SwimPhysics()
    run(physics, [hand({ gripHeld: true, velocity: new Vector3(0, 0, 1.5) })], 0.3)
    assert.ok(physics.velocity.z < -0.3)
  })

  it('ignore slow hand movement', () => {
    const physics = new SwimPhysics()
    run(physics, [hand({ gripHeld: true, velocity: new Vector3(0, 0, 0.2) })], 1)
    assert.equal(physics.velocity.length(), 0)
  })

  it('ignore hand movement without grip', () => {
    const physics = new SwimPhysics()
    run(physics, [hand({ velocity: new Vector3(0, 0, 2) })], 1)
    assert.equal(physics.velocity.length(), 0)
  })

  it('cap swimming speed at about 1.5 m/s', () => {
    const physics = new SwimPhysics()
    run(physics, [hand({ gripHeld: true, velocity: new Vector3(0, 0, 3) })], 10)
    assert.ok(physics.velocity.length() < TUNING.swimMaxSpeed + 0.05)
  })
})

describe('thumbstick drift and drag', () => {
  it('drifts at about 0.8 m/s', () => {
    const physics = new SwimPhysics()
    run(physics, [], 10, new Vector3(0, 0, -1))
    assertClose(physics.velocity.length(), TUNING.driftSpeed, 1)
  })

  it('slows to a stop when input ends', () => {
    const physics = new SwimPhysics()
    physics.velocity.set(0, 0, -2)
    run(physics, [], 5)
    assert.ok(physics.velocity.length() < 0.01)
  })
})

describe('air tank', () => {
  it('refills without overflowing and reports empty', () => {
    const tank = new AirTank(10)
    tank.drain(20, [])
    assert.equal(tank.empty, true)
    tank.refill(100)
    assert.equal(tank.air, 10)
    assert.equal(tank.fraction, 1)
  })
})
