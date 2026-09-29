import { Client, type Room } from '@colyseus/sdk'
import { MAX_PLAYERS, POSE_RATE, ROOM_NAME, type PoseArray, type PoseMessage } from './protocol'

export type JoinMode = { kind: 'create' } | { kind: 'join'; code: string } | { kind: 'quick' } | { kind: 'rejoin'; token: string }

export interface RosterEntry {
  sessionId: string
  name: string
  slot: number
  color: string
  character: string
  connected: boolean
  stage: string
  hits: number
  shots: number
}

const REJOIN_KEY = 'sunken-sicily.rejoin'

/** Where the crew server lives: same origin in production, overridable for local dev. */
function serverUrl(): string {
  return (import.meta.env.VITE_SERVER_URL as string | undefined) ?? location.origin
}

// The game's connection to its crew room: joining, the synced crew state, a server clock,
// pose sending at 20 Hz, and a remembered token so a dropped or reloaded player can rejoin.
export class NetClient {
  readonly sessionId: string
  /** serverTime - localTime (ms), from the smallest observed lag. */
  private offset = 0
  private bestLag = Infinity
  private poseTimer = 0
  private readonly listeners: (() => void)[] = []

  private constructor(readonly room: Room) {
    this.sessionId = room.sessionId
    room.onMessage('welcome', (msg: { serverTime: number }) => this.observeClock(msg.serverTime))
    room.onMessage('poses', (msg: { t: number }) => this.observeClock(msg.t))
    room.onReconnect(() => this.remember())
    this.remember()
  }

  static async connect(mode: JoinMode, name: string): Promise<NetClient> {
    const client = new Client(serverUrl())
    const options = { name }
    let room: Room
    switch (mode.kind) {
      case 'create':
        room = await client.create(ROOM_NAME, { ...options, private: true })
        break
      case 'join':
        room = await client.joinById(mode.code, options)
        break
      case 'quick':
        room = await client.joinOrCreate(ROOM_NAME, options)
        break
      case 'rejoin':
        room = await client.reconnect(mode.token)
        break
    }
    return new NetClient(room)
  }

  /** A saved token from this browser tab, if the player was in a crew (e.g. before a reload). */
  static savedRejoin(): { token: string; code: string } | null {
    try {
      const raw = sessionStorage.getItem(REJOIN_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  get code(): string {
    return this.room.roomId
  }

  get state(): any {
    return this.room.state
  }

  /** Server clock now (ms). */
  serverNow(): number {
    return Date.now() + this.offset
  }

  roster(): RosterEntry[] {
    const players = this.state?.players
    if (!players) return []
    const list: RosterEntry[] = []
    players.forEach((p: any, sessionId: string) =>
      list.push({ sessionId, name: p.name, slot: p.slot, color: p.color, character: p.character, connected: p.connected, stage: p.stage, hits: p.hits ?? 0, shots: p.shots ?? 0 }),
    )
    return list.sort((a, b) => a.slot - b.slot)
  }

  me(): RosterEntry | undefined {
    return this.roster().find((p) => p.sessionId === this.sessionId)
  }

  get full(): boolean {
    return this.roster().length >= MAX_PLAYERS
  }

  send(type: string, payload: unknown = {}): void {
    this.room.send(type, payload)
  }

  /** Subscribe to a server message; call the returned function to unsubscribe. */
  on<T = any>(type: string, callback: (payload: T) => void): () => void {
    const off = this.room.onMessage(type, callback)
    this.listeners.push(off)
    return off
  }

  /** Send our pose at the pose rate. */
  update(dt: number, stage: string, pose: PoseArray, water: boolean): void {
    this.poseTimer -= dt
    if (this.poseTimer > 0) return
    this.poseTimer = 1 / POSE_RATE
    const msg: PoseMessage = { stage, pose: pose.map((v) => Math.round(v * 1000) / 1000), water }
    this.room.send('pose', msg)
  }

  async leave(): Promise<void> {
    try {
      sessionStorage.removeItem(REJOIN_KEY)
    } catch {
      // ignore
    }
    for (const off of this.listeners) off()
    await this.room.leave()
  }

  private observeClock(serverTime: number): void {
    // Take the lowest apparent lag as the best estimate of the clock offset.
    const lag = Date.now() - serverTime
    if (lag < this.bestLag) {
      this.bestLag = lag
      this.offset = -lag
    }
  }

  private remember(): void {
    try {
      sessionStorage.setItem(REJOIN_KEY, JSON.stringify({ token: this.room.reconnectionToken, code: this.room.roomId }))
    } catch {
      // ignore: rejoin after reload just won't be offered
    }
  }
}
