import { schema, t, type SchemaType } from '@colyseus/schema'

// Synchronised crew state: the roster and the facts every player (and any late joiner) must agree
// on. Moment-to-moment events (shots, clay launches, poses) travel as messages instead.

export const CrewPlayer = schema(
  {
    name: t.string(),
    slot: t.number(),
    color: t.string(),
    character: t.string(),
    connected: t.boolean(),
    stage: t.string(),
    /** Clay shooting scoreboard. */
    hits: t.number(),
    shots: t.number(),
  },
  'CrewPlayer',
)
export type CrewPlayer = SchemaType<typeof CrewPlayer>

export const CrewState = schema(
  {
    code: t.string(),
    players: t.map(CrewPlayer),
    teamScore: t.number(),
    /** Server time (ms) the attack started; 0 until someone shoots the ship in the bay. */
    attackAt: t.number(),
    shooter: t.string(),
    /** Level 1 riddle steps done, in order. */
    steps: t.array('string'),
    /** Collectibles taken (by id), so nobody sees a coin someone else already picked up. */
    collected: t.array('string'),
    /** Shared objects currently held: object id → holder's session id. */
    claims: t.map('string'),
    mapPieces: t.array('number'),
  },
  'CrewState',
)
export type CrewState = SchemaType<typeof CrewState>
