import * as THREE from 'three'
import type { GameContext, Stage } from '../core/Stage'
import type { AvatarInfo } from '../net/RemotePlayers'
import { POSE_RATE } from '../net/protocol'
import { crewMembers, hostOf, type CrewMember, type HumanSeat } from '../systems/crew'
import { Bot, type Teammate } from './Bot'
import type { Command } from './brain'
import type { BotWorld } from './world'

/** A stage that has bots in it. */
export interface BotStage extends Stage {
  bots(): BotWorld | null
}

const hasBots = (stage: Stage | null): stage is BotStage => !!stage && typeof (stage as BotStage).bots === 'function'

// Fills empty crew slots with bot divers. Solo, all three bots run here. In a crew, the host (the
// connected human in the lowest slot) runs them and sends their poses through the server; everyone
// else sees them as avatars. A dropped player's slot is covered by a bot until they're back.
export class BotCrew {
  readonly bots = new Map<string, Bot>()
  private stageId = ''
  private world: BotWorld | null = null
  private poseTimer = 0
  private clock = 0

  constructor(private readonly game: GameContext) {}

  /** Everyone in the crew right now, humans and bots. */
  members(): CrewMember[] {
    const { net, party, settings } = this.game
    if (!net) return crewMembers([{ id: 'me', slot: 0, name: settings.name || 'You', character: party.character, connected: true }])
    return crewMembers(this.seats())
  }

  /** Are the bots simulated on this device? */
  get simulating(): boolean {
    const net = this.game.net
    return !net || hostOf(this.seats()) === net.sessionId
  }

  /** Bots drawn from someone else's simulation, for RemotePlayers. */
  remoteBotInfo(): AvatarInfo[] {
    if (this.simulating) return []
    return this.members()
      .filter((m) => m.bot)
      .map((m) => ({ sessionId: m.id, name: m.name, color: m.color, connected: true, bot: true }))
  }

  /** Seconds since the crew started (the clock bot commands run on). */
  get now(): number {
    return this.clock
  }

  /** Give an order to a bot (here, or via the host). Timed orders last 30 s on the bot's clock. */
  command(botId: string, command: Command, target: THREE.Vector3 | null, from: string): void {
    const bot = this.bots.get(botId)
    if (bot) {
      bot.command = command.kind === 'useSkill' ? command : { kind: command.kind, until: this.clock + 30 }
      bot.commander = from
      if (target) bot.commandTarget.copy(target)
      return
    }
    this.game.net?.send('botCommand', { botId, command, target: target?.toArray() })
  }

  /** Head position of a bot (local or remote) for pointing at it. */
  botHead(id: string): THREE.Vector3 | null {
    const local = this.bots.get(id)
    if (local) return local.avatar.group.visible ? local.head : null
    const remote = this.game.remote?.head(id)
    return remote && remote.parent?.visible !== false ? remote.getWorldPosition(new THREE.Vector3()) : null
  }

  update(dt: number, stage: Stage | null): void {
    this.clock += dt
    const world = hasBots(stage) ? stage.bots() : null
    const wanted = this.simulating && world ? this.members().filter((m) => m.bot) : []

    // Create, keep or remove bots to match the crew.
    for (const [id, bot] of this.bots) {
      const m = wanted.find((w) => w.id === id)
      if (!m || m.character !== bot.member.character) {
        bot.dispose()
        this.bots.delete(id)
      }
    }
    const stageChanged = stage?.id !== this.stageId || world !== this.world
    for (const m of wanted) {
      let bot = this.bots.get(m.id)
      if (!bot) {
        bot = new Bot(m, this.game.scene)
        this.bots.set(m.id, bot)
        // Taking over bots from another host: start where they were last seen.
        const seen = this.game.remote?.head(m.id)
        bot.placeAt(seen && !stageChanged ? seen.getWorldPosition(new THREE.Vector3()) : world!.spawn(m.slot))
      } else if (stageChanged) {
        bot.placeAt(world!.spawn(m.slot))
      }
    }
    this.stageId = stage?.id ?? ''
    this.world = world
    if (!world) return

    const humans = this.humans()
    for (const bot of this.bots.values()) {
      // Dressed for where they are (pirate on deck, diver in the water).
      bot.avatar.stage = this.stageId
      bot.update(dt, world, {
        now: this.clock,
        humans,
        say: (text) => this.game.hud.now(text, 3),
        shareAir: (id) => this.game.net?.send('shareAir', { to: id }),
      })
    }
    this.sendPoses(dt)
  }

  private sendPoses(dt: number): void {
    const net = this.game.net
    if (!net || this.bots.size === 0) return
    this.poseTimer -= dt
    if (this.poseTimer > 0) return
    this.poseTimer = 1 / POSE_RATE
    const poses: Record<string, number[]> = {}
    for (const [id, bot] of this.bots) if (!bot.overboard) poses[id] = bot.buildPose().map((v) => Math.round(v * 1000) / 1000)
    net.send('botPoses', { stage: this.stageId, poses })
  }

  /** Humans in this stage: the local player and remote players' heads. */
  private humans(): Teammate[] {
    const { camera, player, net, remote } = this.game
    const me: Teammate = {
      id: net?.sessionId ?? 'me',
      head: camera.getWorldPosition(new THREE.Vector3()),
      air: player.env?.kind === 'swim' ? player.air.fraction : undefined,
      refill: () => player.refillFull(),
    }
    const list = [me]
    if (net && remote) {
      for (const p of net.roster()) {
        if (p.sessionId === net.sessionId || !p.connected || p.stage !== this.stageId) continue
        const head = remote.head(p.sessionId)
        if (head) list.push({ id: p.sessionId, head: head.getWorldPosition(new THREE.Vector3()) })
      }
    }
    return list
  }

  private seats(): HumanSeat[] {
    const net = this.game.net
    if (!net) return []
    return net.roster().map((p) => ({ id: p.sessionId, slot: p.slot, name: p.name, character: p.character as HumanSeat['character'], connected: p.connected }))
  }
}
