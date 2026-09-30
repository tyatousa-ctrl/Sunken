import { readFileSync } from 'node:fs'
import { Room, type Client } from '@colyseus/core'
import { LevelProgress, type LevelData } from '../client/src/systems/LevelProgress.ts'
import { MAX_PLAYERS, POSE_RATE, RECONNECT_SECONDS, SLOT_COLORS, SLOT_NAMES, type PoseMessage } from '../client/src/net/protocol.ts'
import { ClaimTable, FirstWins, cleanName, generateCode, lowestFreeSlot } from './logic.ts'
import { CLASSES, freeClass, hostOf, type CharacterClass, type HumanSeat } from '../client/src/systems/crew.ts'
import { CrewPlayer, CrewState } from './schema.ts'

/** Every level's riddle, from the same data files the game uses. */
const LEVELS = new Map<string, LevelData>(
  ['level1', 'level2', 'level3', 'level4', 'vault'].map((id) => [id, JSON.parse(readFileSync(new URL(`../client/src/data/levels/${id}.json`, import.meta.url), 'utf8')) as LevelData]),
)
const POSE_LENGTH = 21
const PULL_COOLDOWN_MS = 1000
const MAX_PROPS = 200
const MAX_POINTS = 50

// One crew of up to four. The server decides everything shared: who shot the ship first, clay
// launches and hits, who holds which shared object, coins taken, and riddle progress. It relays
// poses (20 Hz) and voice-chat signalling between players.
export class CrewRoom extends Room<{ state: CrewState }> {
  maxClients = MAX_PLAYERS
  state = new CrewState()
  private readonly claims = new ClaimTable()
  private readonly collected = new FirstWins()
  private readonly clays = new FirstWins()
  private readonly poses = new Map<string, PoseMessage>()
  private readonly botPoses = new Map<string, PoseMessage>()
  /** Riddle progress per level, created when a level's first step is taken. */
  private readonly progress = new Map<string, LevelProgress>()
  /** Shared puzzle props (e.g. "level3/shell0" → its angle): latest value, for everyone and late joiners. */
  private readonly props = new Map<string, number[]>()
  /** The level the crew is on (set by whoever last moved on). */
  private crewStage = ''
  private clayId = 0
  private crackerId = 0
  private lastPull = 0

  onCreate(options: { private?: boolean }): void {
    // The room code is the room id, so "join by code" is a direct lookup.
    this.roomId = generateCode()
    this.state.code = this.roomId
    // Schema numbers start out undefined; give every counter a real zero.
    this.state.teamScore = 0
    this.state.attackAt = 0
    this.state.shooter = ''
    this.state.mapPieces.push(1)
    if (options?.private) void this.setPrivate(true)
    void this.setMetadata({ code: this.roomId })
    this.autoDispose = true

    this.onMessage('pose', (client, msg: PoseMessage) => {
      if (!msg || !Array.isArray(msg.pose) || msg.pose.length !== POSE_LENGTH || !msg.pose.every(Number.isFinite)) return
      const stage = typeof msg.stage === 'string' ? msg.stage.slice(0, 16) : ''
      this.poses.set(client.sessionId, { stage, pose: msg.pose, water: !!msg.water })
      const player = this.player(client)
      if (player && player.stage !== stage) player.stage = stage
    })

    this.onMessage('profile', (client, msg: { name?: string; character?: string }) => {
      const player = this.player(client)
      if (!player) return
      if (msg?.name !== undefined) player.name = cleanName(msg.name, player.name)
      // One of each class among the humans; bots take whatever's left.
      // Asking for a class another player has swaps it with them (switch any time, any crew size).
      const wanted = msg?.character as CharacterClass
      if (CLASSES.includes(wanted) && wanted !== player.character) {
        const others = this.seats().filter((h) => h.id !== client.sessionId)
        if (freeClass(others, wanted) === wanted) player.character = wanted
        else {
          const holderId = others.find((h) => h.connected && h.character === wanted)?.id
          const holder = holderId ? this.state.players.get(holderId) : undefined
          if (!holder || !holderId) return void client.send('characterDenied', { character: wanted })
          holder.character = player.character
          player.character = wanted
          this.clients.find((c) => c.sessionId === holderId)?.send('classSwapped', { character: holder.character, by: player.name })
          client.send('classChanged', { character: wanted, from: holder.name })
        }
      }
    })

    // One crew, one level: when anyone moves on, everyone goes with them.
    this.onMessage('goStage', (client, msg: { stage?: string }) => {
      const stage = String(msg?.stage ?? '').slice(0, 16)
      if (!stage || !this.player(client) || stage === this.crewStage) return
      this.crewStage = stage
      this.broadcast('crewStage', { stage, by: client.sessionId })
    })
    this.onMessage('whereIsCrew', (client) => {
      if (this.crewStage) client.send('crewStage', { stage: this.crewStage })
    })

    // Bots run on the host's device (the connected human in the lowest slot); the server relays
    // their poses and lets the host act for them.
    this.onMessage('botPoses', (client, msg: { stage?: string; poses?: Record<string, number[]>; water?: Record<string, boolean> }) => {
      if (client.sessionId !== hostOf(this.seats()) || !msg?.poses) return
      this.botPoses.clear()
      for (const [id, pose] of Object.entries(msg.poses)) {
        if (!/^bot-[0-3]$/.test(id) || !Array.isArray(pose) || pose.length !== POSE_LENGTH || !pose.every(Number.isFinite)) continue
        // In the water (dive gear) or on deck (pirate dress); older hosts don't say, so assume diving.
        this.botPoses.set(id, { stage: String(msg.stage ?? '').slice(0, 16), pose, water: msg.water?.[id] ?? true })
      }
    })
    this.onMessage('botCommand', (client, msg: unknown) => {
      const host = this.clients.find((c) => c.sessionId === hostOf(this.seats()))
      host?.send('botCommand', { from: client.sessionId, ...(msg as object) })
    })
    // Deep Diver sharing air, and spells: relayed so everyone sees and feels them.
    this.onMessage('shareAir', (client, msg: { to?: string }) => {
      this.clients.find((c) => c.sessionId === msg?.to)?.send('shareAir', { from: client.sessionId })
    })
    this.onMessage('spell', (client, msg: { kind?: string; at?: number[]; dir?: number[] }) => {
      if (!['circle', 'triangle', 'zigzag'].includes(String(msg?.kind))) return
      this.broadcast('spell', { kind: msg.kind, at: msg.at, dir: msg.dir, by: client.sessionId }, { except: client })
    })

    // Intro: the first pellet to hit the "merchant" starts the attack, for everyone at once.
    this.onMessage('hitShip', (client) => {
      if (this.state.attackAt) return
      this.state.attackAt = Date.now()
      this.state.shooter = this.player(client)?.name ?? ''
      this.broadcast('attack', { at: this.state.attackAt, shooter: this.state.shooter })
    })

    // One thrower for the whole crew: the server launches every clay.
    this.onMessage('pull', (_client, msg: { count?: number }) => {
      const now = Date.now()
      if (this.state.attackAt || now - this.lastPull < PULL_COOLDOWN_MS) return
      this.lastPull = now
      // The thrower's switch says one or two; without it (older clients), mostly singles.
      const count = msg?.count === 1 || msg?.count === 2 ? msg.count : Math.random() < 0.3 ? 2 : 1
      // A pair leaves almost together (matches the client's CLAY_PAIR_GAP).
      for (let i = 0; i < count; i++) this.broadcast('clay', { id: ++this.clayId, seed: Math.floor(Math.random() * 2 ** 31), delay: i * 0.12 })
    })
    // A player threw a clay by hand: give it a crew-wide id so hits count once, and show it to everyone.
    this.onMessage('throwClay', (client, msg: { at?: number[]; vel?: number[]; local?: number }) => {
      if (this.state.attackAt || !isVec3(msg?.at) || !isVec3(msg?.vel) || typeof msg.local !== 'number') return
      this.broadcast('clayThrown', { id: ++this.clayId, at: msg.at, vel: msg.vel, by: client.sessionId, local: msg.local })
    })
    // Whoever sails the ship (the helmsman, or the host) says where she is; everyone else follows.
    this.onMessage('sail', (client, msg: { x?: number; z?: number; heading?: number; speed?: number; wheel?: number }) => {
      const nums = [msg?.x, msg?.z, msg?.heading, msg?.speed, msg?.wheel]
      if (this.state.attackAt || !nums.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e5)) return
      this.broadcast('sail', { x: msg.x, z: msg.z, heading: msg.heading, speed: msg.speed, wheel: msg.wheel }, { except: client })
    })
    // Polly: a thrown cracker gets a crew-wide id and reaches everyone; the device running Polly (the
    // host) shares how she is and which cracker she caught.
    this.onMessage('cracker', (client, msg: { at?: number[]; vel?: number[]; local?: number }) => {
      if (!isVec3(msg?.at) || !isVec3(msg?.vel) || typeof msg.local !== 'number') return
      this.broadcast('cracker', { id: ++this.crackerId, at: msg.at, vel: msg.vel, by: client.sessionId, local: msg.local })
    })
    this.onMessage('polly', (client, msg: { p?: number[]; q?: number[]; h?: number[]; pet?: number; mode?: string; carried?: boolean; coo?: number }) => {
      if (!isVec3(msg?.p) || !Array.isArray(msg.q) || msg.q.length !== 4 || !isVec3(msg.h)) return
      if (typeof msg.pet !== 'number' || typeof msg.mode !== 'string' || msg.mode.length > 16 || typeof msg.coo !== 'number') return
      this.broadcast('polly', { p: msg.p, q: msg.q, h: msg.h, pet: msg.pet, mode: msg.mode, carried: !!msg.carried, coo: msg.coo }, { except: client })
    })
    this.onMessage('pollyCatch', (client, msg: { id?: number }) => {
      if (typeof msg?.id === 'number') this.broadcast('pollyCatch', { id: msg.id }, { except: client })
    })
    // Someone fired a deck cannon: everyone else sees and hears it.
    this.onMessage('cannon', (client, msg: { i?: number }) => {
      if (typeof msg?.i === 'number') this.broadcast('cannon', { i: msg.i, by: client.sessionId }, { except: client })
    })
    this.onMessage('shot', (client) => {
      const player = this.player(client)
      if (player) player.shots++
    })
    this.onMessage('clayHit', (client, msg: { id?: number }) => {
      if (typeof msg?.id !== 'number' || !this.clays.tryTake(String(msg.id))) return
      const player = this.player(client)
      if (player) player.hits++
      this.broadcast('clayBroken', { id: msg.id, by: client.sessionId })
    })
    this.onMessage('fired', (client, msg: { id?: string }) => {
      if (typeof msg?.id === 'string') this.broadcast('fired', { id: msg.id, by: client.sessionId }, { except: client })
    })
    // Which hand a sword was drawn with, so everyone shows it in the right one.
    this.onMessage('swordHand', (client, msg: { id?: string; hand?: number }) => {
      if (typeof msg?.id === 'string' && msg.id.startsWith('sword')) this.broadcast('swordHand', { id: msg.id.slice(0, 16), hand: msg.hand === 0 ? 0 : 1 }, { except: client })
    })

    // Shared objects: first grab wins.
    this.onMessage('claim', (client, msg: { id?: string }) => {
      const id = typeof msg?.id === 'string' ? msg.id.slice(0, 32) : ''
      if (!id) return
      if (this.claims.claim(id, client.sessionId)) {
        this.state.claims.set(id, client.sessionId)
      } else {
        client.send('claimDenied', { id })
      }
    })
    this.onMessage('release', (client, msg: { id?: string; stored?: boolean }) => {
      const id = typeof msg?.id === 'string' ? msg.id : ''
      if (!this.claims.release(id, client.sessionId)) return
      this.state.claims.delete(id)
      this.broadcast('released', { id, by: client.sessionId, stored: !!msg.stored })
    })

    // Collectibles: the first to touch one gets it; the team score goes up once.
    this.onMessage('collect', (client, msg: { id?: string; points?: number; as?: string }) => {
      const id = typeof msg?.id === 'string' ? msg.id.slice(0, 32) : ''
      if (!id || !this.collected.tryTake(id)) return
      this.state.collected.push(id)
      this.state.teamScore += Math.max(0, Math.min(MAX_POINTS, Number(msg.points) || 0))
      // The host may collect on behalf of a bot.
      const by = typeof msg.as === 'string' && /^bot-[0-3]$/.test(msg.as) && client.sessionId === hostOf(this.seats()) ? msg.as : client.sessionId
      this.broadcast('collected', { id, by })
    })

    // Riddle steps: validated in order on the server, then applied by everyone.
    this.onMessage('act', (client, msg: { level?: string; step?: string }) => {
      const data = typeof msg?.level === 'string' ? LEVELS.get(msg.level) : undefined
      if (!data || typeof msg.step !== 'string') return
      let progress = this.progress.get(data.id)
      if (!progress) this.progress.set(data.id, (progress = new LevelProgress(data)))
      const events = progress.complete(msg.step)
      if (events.length === 0) return
      // Stored as "level:step" so late joiners can catch up on every level.
      this.state.steps.push(`${data.id}:${msg.step}`)
      this.broadcast('step', { level: data.id, step: msg.step, by: client.sessionId })
      if (progress.solved) this.state.mapPieces.push(data.reward.mapPiece)
    })

    // Puzzle pieces someone moved (a shell turned): pass it on, and remember it for anyone arriving later.
    this.onMessage('prop', (client, msg: { key?: string; v?: number[] }) => {
      const key = typeof msg?.key === 'string' ? msg.key.slice(0, 48) : ''
      const v = Array.isArray(msg?.v) ? msg.v.slice(0, 8).map(Number) : []
      if (!key || v.length === 0 || v.some((n) => !Number.isFinite(n))) return
      if (!this.props.has(key) && this.props.size >= MAX_PROPS) return
      this.props.set(key, v)
      this.broadcast('prop', { key, v, by: client.sessionId }, { except: client })
    })
    // A level starting on someone's device asks where its pieces are.
    this.onMessage('props', (client, msg: { prefix?: string }) => {
      const prefix = typeof msg?.prefix === 'string' ? msg.prefix : ''
      for (const [key, v] of this.props) if (key.startsWith(prefix)) client.send('prop', { key, v, by: '' })
    })

    // WebRTC voice signalling, relayed to one player.
    this.onMessage('rtc', (client, msg: { to?: string; data?: unknown }) => {
      const target = this.clients.find((c) => c.sessionId === msg?.to)
      target?.send('rtc', { from: client.sessionId, data: msg.data })
    })

    this.setSimulationInterval(() => this.broadcastPoses(), 1000 / POSE_RATE)
  }

  onJoin(client: Client, options?: { name?: string; character?: string }): void {
    const seats = this.seats()
    const taken = [...this.state.players.values()].map((p) => p.slot)
    const slot = lowestFreeSlot(taken, MAX_PLAYERS)
    const player = new CrewPlayer()
    player.slot = slot
    player.name = cleanName(options?.name, SLOT_NAMES[slot])
    player.color = SLOT_COLORS[slot]
    player.character = freeClass(seats, options?.character as CharacterClass)
    player.connected = true
    player.stage = ''
    player.hits = 0
    player.shots = 0
    this.state.players.set(client.sessionId, player)
    client.send('welcome', { sessionId: client.sessionId, serverTime: Date.now(), code: this.roomId })
  }

  onDrop(client: Client): void {
    const player = this.player(client)
    if (player) player.connected = false
    this.poses.delete(client.sessionId)
    // Keep their slot for two minutes (a bot stands in once bots exist).
    this.allowReconnection(client, RECONNECT_SECONDS)
  }

  onReconnect(client: Client): void {
    const player = this.player(client)
    if (player) player.connected = true
    client.send('welcome', { sessionId: client.sessionId, serverTime: Date.now(), code: this.roomId })
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId)
    this.poses.delete(client.sessionId)
    for (const id of this.claims.releaseAll(client.sessionId)) {
      this.state.claims.delete(id)
      this.broadcast('released', { id, by: client.sessionId, stored: false })
    }
  }

  private player(client: Client): CrewPlayer | undefined {
    return this.state.players.get(client.sessionId)
  }

  private seats(): HumanSeat[] {
    const seats: HumanSeat[] = []
    this.state.players.forEach((p, id) => seats.push({ id, slot: p.slot, name: p.name, character: p.character as CharacterClass, connected: p.connected }))
    return seats
  }

  private broadcastPoses(): void {
    if (this.poses.size === 0 && this.botPoses.size === 0) return
    // Bots in slots a human now occupies are dropped.
    const humanSlots = new Set(this.seats().filter((h) => h.connected).map((h) => `bot-${h.slot}`))
    const players: Record<string, PoseMessage> = Object.fromEntries(this.poses)
    for (const [id, pose] of this.botPoses) if (!humanSlots.has(id)) players[id] = pose
    this.broadcast('poses', { t: Date.now(), players })
  }
}

function isVec3(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e4)
}
