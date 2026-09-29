import * as THREE from 'three'
import type { GameContext } from '../core/Stage'
import type { Hand } from '../input/Hand'
import type { BotCrew } from './BotCrew'
import type { Command } from './brain'

const POINT_RANGE = 15
const HIT_RADIUS = 0.55
const MENU_TIMEOUT = 8
const OPTIONS = ['Come here', 'Go there', 'Use skill'] as const
type Option = (typeof OPTIONS)[number]

// Point at a bot and pull the trigger: three cards appear by it (Come here / Go there / Use skill).
// Point at a card and pull the trigger to choose; for "Go there", then point at the spot.
export class BotCommands {
  private readonly cards: THREE.Mesh[] = []
  private readonly group = new THREE.Group()
  private botId: string | null = null
  private hand: Hand | null = null
  private placing = false
  private timer = 0
  private readonly origin = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private readonly v = new THREE.Vector3()

  constructor(
    private readonly game: GameContext,
    private readonly crew: BotCrew,
  ) {
    for (const label of OPTIONS) {
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 80
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = 'rgba(8, 30, 46, 0.9)'
      ctx.beginPath()
      ctx.roundRect(2, 2, 252, 76, 18)
      ctx.fill()
      ctx.strokeStyle = '#5fe0ff'
      ctx.lineWidth = 4
      ctx.stroke()
      ctx.fillStyle = '#e8f7ff'
      ctx.font = 'bold 34px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(label, 128, 52)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.125), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, fog: false }))
      card.renderOrder = 850
      card.userData.label = label
      this.cards.push(card)
      this.group.add(card)
    }
    this.group.visible = false
    game.scene.add(this.group)
  }

  update(dt: number): void {
    if (this.botId) {
      this.timer -= dt
      if (this.timer <= 0) this.close()
    }
    for (const hand of this.game.hands) {
      if (!hand.connected || hand.held) continue
      hand.busy = this.hand === hand
      if (!hand.triggerPressed) continue
      this.ray(hand)
      if (this.placing && this.hand === hand) {
        this.issue({ kind: 'goTo', until: this.now() + 30 }, this.pointOnFloor())
        this.game.hud.now('On my way.', 2)
        this.close()
        continue
      }
      if (this.botId && this.hand === hand) {
        const card = this.cards.find((c) => this.hits(c.getWorldPosition(this.v), 0.2))
        if (card) this.choose(card.userData.label as Option)
        else this.close()
        continue
      }
      const bot = this.crew.members().filter((m) => m.bot).find((m) => {
        const head = this.crew.botHead(m.id)
        return head && this.hits(head, HIT_RADIUS)
      })
      if (bot) this.open(bot.id, hand)
    }
  }

  private open(botId: string, hand: Hand): void {
    this.botId = botId
    this.hand = hand
    this.placing = false
    this.timer = MENU_TIMEOUT
    const head = this.crew.botHead(botId)!
    const eye = this.game.camera.getWorldPosition(new THREE.Vector3())
    // Cards stacked beside the bot, turned to face you.
    this.group.position.copy(head).lerp(eye, 0.35)
    this.group.lookAt(eye)
    this.cards.forEach((c, i) => c.position.set(0, 0.16 - i * 0.16, 0))
    this.group.visible = true
    hand.pulse(0.3, 30)
  }

  private choose(option: Option): void {
    const now = this.now()
    if (option === 'Come here') {
      this.issue({ kind: 'follow', until: now + 30 }, null)
      this.game.hud.now('Right behind you.', 2)
      this.close()
    } else if (option === 'Use skill') {
      this.issue({ kind: 'useSkill' }, null)
      this.close()
    } else {
      this.placing = true
      this.group.visible = false
      this.timer = MENU_TIMEOUT
      this.game.hud.now('Point where the bot should go and pull the trigger.', 3)
    }
  }

  private issue(command: Command, target: THREE.Vector3 | null): void {
    if (!this.botId) return
    const from = this.game.net?.sessionId ?? 'me'
    this.crew.command(this.botId, command, target, from)
    this.hand?.pulse(0.3, 40)
  }

  private close(): void {
    this.group.visible = false
    this.botId = null
    if (this.hand) this.hand.busy = false
    this.hand = null
    this.placing = false
  }

  private ray(hand: Hand): void {
    // Desktop points from the eyes (the stand-in hand sits off to one side).
    if (hand.virtual) this.game.camera.getWorldPosition(this.origin)
    else hand.ray.getWorldPosition(this.origin)
    hand.pointDir(this.dir)
  }

  private hits(point: THREE.Vector3, radius: number): boolean {
    const to = this.v.copy(point).sub(this.origin)
    const along = to.dot(this.dir)
    if (along < 0 || along > POINT_RANGE) return false
    return to.addScaledVector(this.dir, -along).length() < radius
  }

  /** Where the pointer meets the seabed or deck (or 8 m out if it hits nothing). */
  private pointOnFloor(): THREE.Vector3 {
    const env = this.game.player.env
    const p = this.origin.clone()
    for (let d = 0; d < 20; d += 0.25) {
      p.copy(this.origin).addScaledVector(this.dir, d)
      const floor = env?.kind === 'swim' ? env.floorHeight(p.x, p.z) : env?.kind === 'walk' ? env.groundHeight(p.x, p.z) : null
      if (floor !== null && floor !== undefined && p.y < floor + 0.8) return p.setY(floor + 1)
      if (d > 8 && env?.kind !== 'walk') break
    }
    return this.origin.clone().addScaledVector(this.dir, 8)
  }

  private now(): number {
    return this.crew.now
  }
}
