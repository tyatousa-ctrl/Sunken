import { readFileSync } from 'node:fs'
import { Room, type Client } from '@colyseus/core'
import { LevelProgress, type LevelData } from '../client/src/systems/LevelProgress.ts'
import { MAX_PLAYERS, POSE_RATE, RECONNECT_SECONDS, SLOT_COLORS, SLOT_NAMES, type PoseMessage } from '../client/src/net/protocol.ts'
import { ClaimTable, FirstWins, cleanName, generateCode, lowestFreeSlot } from './logic.ts'
import { CrewPlayer, CrewState } from './schema.ts'

const LEVEL1 = JSON.parse(readFileSync(new URL('../client/src/data/levels/level1.json', import.meta.url), 'utf8')) as LevelData
const POSE_LENGTH = 21
const PULL_COOLDOWN_MS = 1500
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
  private readonly level1 = new LevelProgress(LEVEL1)
  private clayId = 0
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
      player.name = cleanName(msg?.name, player.name)
      if (typeof msg?.character === 'string') player.character = msg.character.slice(0, 16)
    })

    // Intro: the first pellet to hit the "merchant" starts the attack, for everyone at once.
    this.onMessage('hitShip', (client) => {
      if (this.state.attackAt) return
      this.state.attackAt = Date.now()
      this.state.shooter = this.player(client)?.name ?? ''
      this.broadcast('attack', { at: this.state.attackAt, shooter: this.state.shooter })
    })

    // One thrower for the whole crew: the server launches every clay.
    this.onMessage('pull', () => {
      const now = Date.now()
      if (this.state.attackAt || now - this.lastPull < PULL_COOLDOWN_MS) return
      this.lastPull = now
      const count = Math.random() < 0.3 ? 2 : 1
      for (let i = 0; i < count; i++) this.broadcast('clay', { id: ++this.clayId, seed: Math.floor(Math.random() * 2 ** 31), delay: i * 0.3 })
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
    this.onMessage('collect', (client, msg: { id?: string; points?: number }) => {
      const id = typeof msg?.id === 'string' ? msg.id.slice(0, 32) : ''
      if (!id || !this.collected.tryTake(id)) return
      this.state.collected.push(id)
      this.state.teamScore += Math.max(0, Math.min(MAX_POINTS, Number(msg.points) || 0))
      this.broadcast('collected', { id, by: client.sessionId })
    })

    // Riddle steps: validated in order on the server, then applied by everyone.
    this.onMessage('act', (client, msg: { level?: string; step?: string }) => {
      if (msg?.level !== LEVEL1.id || typeof msg.step !== 'string') return
      const events = this.level1.complete(msg.step)
      if (events.length === 0) return
      this.state.steps.push(msg.step)
      this.broadcast('step', { level: LEVEL1.id, step: msg.step, by: client.sessionId })
      if (this.level1.solved) this.state.mapPieces.push(LEVEL1.reward.mapPiece)
    })

    // WebRTC voice signalling, relayed to one player.
    this.onMessage('rtc', (client, msg: { to?: string; data?: unknown }) => {
      const target = this.clients.find((c) => c.sessionId === msg?.to)
      target?.send('rtc', { from: client.sessionId, data: msg.data })
    })

    this.setSimulationInterval(() => this.broadcastPoses(), 1000 / POSE_RATE)
  }

  onJoin(client: Client, options?: { name?: string; character?: string }): void {
    const taken = [...this.state.players.values()].map((p) => p.slot)
    const slot = lowestFreeSlot(taken, MAX_PLAYERS)
    const player = new CrewPlayer()
    player.slot = slot
    player.name = cleanName(options?.name, SLOT_NAMES[slot])
    player.color = SLOT_COLORS[slot]
    player.character = typeof options?.character === 'string' ? options.character.slice(0, 16) : 'strongman'
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

  private broadcastPoses(): void {
    if (this.poses.size === 0) return
    this.broadcast('poses', { t: Date.now(), players: Object.fromEntries(this.poses) })
  }
}
