// End-to-end check of the crew server with real SDK clients: run against a live server
// (`PORT=4321 npm start`, then `SERVER=http://localhost:4321 tsx server/tests/crew.integration.ts`).
import assert from 'node:assert/strict'
import { Client } from '@colyseus/sdk'

const URL_ = process.env.SERVER ?? 'http://localhost:4321'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const pose = (x: number) => [x, 1.6, 0, 0, 0, 0, 1, x - 0.2, 1.2, -0.3, 0, 0, 0, 1, x + 0.2, 1.2, -0.3, 0, 0, 0, 1]

function inbox(room: { onMessage: (type: string, cb: (p: any) => void) => void }, types: string[]) {
  const got: Record<string, any[]> = {}
  for (const t of types) {
    got[t] = []
    room.onMessage(t, (p) => got[t].push(p))
  }
  return got
}

const TYPES = ['welcome', 'poses', 'attack', 'clay', 'clayBroken', 'claimDenied', 'released', 'collected', 'step', 'rtc', 'fired']

const alice = await new Client(URL_).create('crew', { private: true, name: 'Alice' })
const a = inbox(alice, TYPES)
await wait(300)
const code = alice.roomId
assert.match(code, /^[A-HJ-NP-Z]{4}$/, 'room code is 4 letters')
console.log('room code:', code)

// Private rooms are not matched by Quick Play.
const quick = await new Client(URL_).joinOrCreate('crew', { name: 'Stranger' })
assert.notEqual(quick.roomId, code, 'quick play did not land in the private room')
await quick.leave()

const bob = await new Client(URL_).joinById(code, { name: 'Bob' })
const b = inbox(bob, TYPES)
await wait(400)
const players = () => [...(alice.state as any).players.values()].map((p: any) => `${p.slot}:${p.name}:${p.connected}`).sort()
assert.deepEqual(players(), ['0:Alice:true', '1:Bob:true'])
console.log('roster:', players())

// Poses relay at 20 Hz.
bob.send('pose', { stage: 'intro', pose: pose(2), water: false })
await wait(300)
const last = a.poses.at(-1)
assert.ok(last?.players[bob.sessionId], 'alice receives bob pose')
assert.equal(last.players[bob.sessionId].pose[0], 2)
console.log('poses relayed:', a.poses.length, 'snapshots in ~0.3 s')

// First grab wins.
alice.send('claim', { id: 'gun0' })
await wait(100)
bob.send('claim', { id: 'gun0' })
await wait(300)
assert.equal((bob.state as any).claims.get('gun0'), alice.sessionId)
assert.equal(b.claimDenied.length, 1, 'bob was denied')
alice.send('release', { id: 'gun0' })
await wait(300)
assert.equal((alice.state as any).claims.get('gun0'), undefined)
assert.equal(b.released.length, 1)
console.log('claims: first grab wins, release broadcast')

// Hand-thrown clays get a crew-wide id and reach everyone; cannon shots reach everyone else.
const thrown: { a: any[]; b: any[] } = { a: [], b: [] }
const cannons: { a: any[]; b: any[] } = { a: [], b: [] }
alice.onMessage('clayThrown', (m) => thrown.a.push(m))
bob.onMessage('clayThrown', (m) => thrown.b.push(m))
alice.onMessage('cannon', (m) => cannons.a.push(m))
bob.onMessage('cannon', (m) => cannons.b.push(m))
alice.send('throwClay', { at: [1, 3, 6], vel: [8, 6, 0], local: -1 })
alice.send('throwClay', { at: [1, 3], vel: [8, 6, 0], local: -2 })
alice.send('cannon', { i: 2 })
await wait(300)
assert.equal(thrown.a.length, 1, 'bad throw ignored')
assert.equal(thrown.b[0].id, thrown.a[0].id)
assert.equal(thrown.a[0].local, -1)
assert.deepEqual(thrown.b[0].vel, [8, 6, 0])
assert.equal(cannons.a.length, 0, 'the firer does not get their own shot back')
assert.equal(cannons.b[0].i, 2)
console.log('hand-thrown clay and cannon fire relayed')

// The one sailing the ship shares her position; bad numbers are ignored.
const sails: any[] = []
bob.onMessage('sail', (m) => sails.push(m))
alice.onMessage('sail', () => assert.fail('the sender does not get its own sail state'))
alice.send('sail', { x: 1, z: -20, heading: -0.1, speed: 2.2, wheel: 1.5 })
alice.send('sail', { x: 'far', z: 0, heading: 0, speed: 0, wheel: 0 })
await wait(300)
assert.equal(sails.length, 1)
assert.deepEqual(sails[0], { x: 1, z: -20, heading: -0.1, speed: 2.2, wheel: 1.5 })
console.log('sail state relayed')

// Collectibles count once.
alice.send('collect', { id: 'coin3', points: 10 })
bob.send('collect', { id: 'coin3', points: 10 })
await wait(300)
assert.equal((alice.state as any).teamScore, 10)
assert.equal(a.collected.length, 1)
assert.equal(a.collected[0].by, alice.sessionId)
console.log('collect: counted once, team score', (alice.state as any).teamScore)

// Clays: server launches; first hit report wins.
bob.send('pull', {})
await wait(300)
assert.ok(a.clay.length >= 1 && b.clay.length >= 1, 'both see the launch')
const clayId = a.clay[0].id
bob.send('clayHit', { id: clayId })
alice.send('clayHit', { id: clayId })
await wait(300)
assert.equal(a.clayBroken.length, 1)
assert.equal(a.clayBroken[0].by, bob.sessionId)
console.log('clays: launch broadcast, first hit wins')

// The attack starts once, for everyone.
bob.send('hitShip', {})
alice.send('hitShip', {})
await wait(300)
assert.equal(a.attack.length, 1)
assert.equal((alice.state as any).shooter, 'Bob')
console.log('attack: started by', (alice.state as any).shooter)

// Riddle steps only in order.
alice.send('act', { level: 'level1', step: 'takeKey' })
alice.send('act', { level: 'level1', step: 'enterCabin' })
await wait(300)
assert.deepEqual([...(bob.state as any).steps], ['enterCabin'])
console.log('steps: out-of-order rejected, in-order accepted')

// Voice signalling reaches exactly the addressed player.
alice.send('rtc', { to: bob.sessionId, data: { hello: 1 } })
await wait(300)
assert.equal(b.rtc.length, 1)
assert.equal(b.rtc[0].from, alice.sessionId)
console.log('rtc: relayed')

// Drop and reconnect: slot kept.
const token = bob.reconnectionToken
;(bob.connection as any).transport?.ws?.close?.() ?? (bob.connection as any).close?.()
await wait(600)
const midDrop = [...(alice.state as any).players.values()].find((p: any) => p.name === 'Bob')
console.log('after drop, Bob connected =', midDrop?.connected)
assert.equal(midDrop?.connected, false)
const bob2 = await new Client(URL_).reconnect(token)
await wait(400)
assert.equal(bob2.sessionId, bob.sessionId)
assert.deepEqual(players(), ['0:Alice:true', '1:Bob:true'])
console.log('reconnect: same session, slot kept')

await bob2.leave()
await wait(300)
assert.deepEqual(players(), ['0:Alice:true'])
await alice.leave()
console.log('ALL CREW SERVER CHECKS PASSED')
process.exit(0)
