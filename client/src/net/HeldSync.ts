import * as THREE from 'three'
import type { GameContext } from '../core/Stage'
import type { Hand } from '../input/Hand'
import type { Interactable } from '../interaction/GrabSystem'
import { LooseItem } from '../interaction/LooseItem'

/** How one kind of thing is shown in someone else's hand. */
export interface HeldAdapter {
  /** Which of your hands holds it now (null: nobody here). */
  heldBy(): Hand | null
  /** The object as it's held (what hangs off the hand). */
  shown(): THREE.Object3D
  /** Anything about it that changes while held (lit, how full), sent with it. */
  state?(): number[]
  /** A copy to put in a crewmate's hand. */
  proxy?(): THREE.Object3D
  /** Show a state on the copy. */
  apply?(proxy: THREE.Object3D, state: number[]): void
  /** A crewmate has it: hide it here and don't let anyone here grab it (false: it's back). */
  taken?(on: boolean): void
}

interface HeldEntry {
  id: string
  /** 0 left, 1 right. */
  h: number
  /** Position and rotation relative to the holding hand. */
  p: number[]
  q: number[]
  s: number[]
}

interface RemoteHeld {
  proxy: THREE.Object3D
  h: number
  state: string
}

/** Send what we hold this often while holding anything (the pose in the hand moves). */
const SEND_SECONDS = 0.15

// Whatever you hold, the crew sees in your hand: a mug of beer (and how full it is), a match (lit or
// not), a dart, a key, a bottle. Each device sends what its hands hold; everyone else hangs a copy on
// that player's avatar hand and hides the original where it was (and won't let it be grabbed there)
// until it's put down.
export class HeldSync {
  private readonly items = new Map<string, HeldAdapter>()
  private readonly remote = new Map<string, Map<string, RemoteHeld>>()
  private readonly takenBy = new Map<string, string>()
  private readonly off: (() => void) | null
  private sendTimer = 0
  private lastSent = ''
  private readonly m = new THREE.Matrix4()
  private readonly p = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  private readonly s = new THREE.Vector3()

  constructor(
    private readonly game: GameContext,
    private readonly stageId: string,
  ) {
    this.off = game.net?.on<{ by: string; stage: string; items: HeldEntry[] }>('held', (msg) => this.onRemote(msg)) ?? null
  }

  /** `id` must be the same on every device (register things in the order they're built). */
  add(id: string, adapter: HeldAdapter): void {
    this.items.set(id, adapter)
  }

  update(dt: number): void {
    const net = this.game.net
    if (!net) return
    // Ours.
    const entries: HeldEntry[] = []
    for (const [id, item] of this.items) {
      const hand = item.heldBy()
      if (!hand) continue
      const shown = item.shown()
      hand.grip.updateWorldMatrix(true, false)
      shown.updateWorldMatrix(true, false)
      this.m.copy(hand.grip.matrixWorld).invert().multiply(shown.matrixWorld).decompose(this.p, this.q, this.s)
      entries.push({
        id,
        h: hand.virtual ? 1 : hand.handedness === 'left' ? 0 : 1,
        p: this.p.toArray().map(round),
        q: this.q.toArray().map(round),
        s: (item.state?.() ?? []).map(round),
      })
    }
    const key = entries.map((e) => `${e.id}:${e.h}:${e.s.join(',')}`).join('|')
    this.sendTimer -= dt
    if (key !== this.lastSent || (entries.length > 0 && this.sendTimer <= 0)) {
      this.lastSent = key
      this.sendTimer = SEND_SECONDS
      net.send('held', { stage: this.stageId, items: entries })
    }

    // Theirs: follow their hands; drop anyone who's left this stage or the crew.
    for (const [by, held] of this.remote) {
      const present = net.roster().some((p) => p.sessionId === by && p.connected && p.stage === this.stageId)
      if (!present) {
        this.clear(by)
        continue
      }
      for (const [, r] of held) {
        const hand = this.game.remote?.hand(by, r.h as 0 | 1)
        r.proxy.visible = !!hand
        if (hand && r.proxy.parent !== hand) hand.add(r.proxy)
      }
    }
  }

  /** Leaving the stage: let go of everything as far as the crew is concerned, and tidy up. */
  dispose(): void {
    this.game.net?.send('held', { stage: this.stageId, items: [] })
    for (const by of [...this.remote.keys()]) this.clear(by)
    this.off?.()
  }

  private onRemote(msg: { by: string; stage: string; items: HeldEntry[] }): void {
    if (!msg?.by) return
    const items = msg.stage === this.stageId && Array.isArray(msg.items) ? msg.items : []
    let held = this.remote.get(msg.by)
    if (!held) this.remote.set(msg.by, (held = new Map()))
    const now = new Set(items.map((e) => e.id))
    for (const [id, r] of held) {
      if (now.has(id)) continue
      r.proxy.removeFromParent()
      held.delete(id)
      this.untake(id, msg.by)
    }
    for (const e of items) {
      const item = this.items.get(e.id)
      if (!item) continue
      let r = held.get(e.id)
      if (!r) {
        const proxy = item.proxy?.() ?? item.shown().clone(true)
        proxy.visible = true
        r = { proxy, h: e.h, state: '' }
        held.set(e.id, r)
        this.takenBy.set(e.id, msg.by)
        item.taken?.(true)
      }
      r.h = e.h
      if (e.p?.length === 3) r.proxy.position.fromArray(e.p)
      if (e.q?.length === 4) r.proxy.quaternion.fromArray(e.q)
      const state = (e.s ?? []).join(',')
      if (state !== r.state) {
        r.state = state
        item.apply?.(r.proxy, e.s ?? [])
      }
      const hand = this.game.remote?.hand(msg.by, e.h === 0 ? 0 : 1)
      if (hand && r.proxy.parent !== hand) hand.add(r.proxy)
    }
  }

  private clear(by: string): void {
    const held = this.remote.get(by)
    if (!held) return
    for (const [id, r] of held) {
      r.proxy.removeFromParent()
      this.untake(id, by)
    }
    this.remote.delete(by)
  }

  private untake(id: string, by: string): void {
    if (this.takenBy.get(id) !== by) return
    this.takenBy.delete(id)
    this.items.get(id)?.taken?.(false)
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Things that know how to be shown in a crewmate's hand. */
export interface HeldSyncable {
  heldAdapter(): HeldAdapter
}

/** How to sync an interactable: its own adapter, the loose-prop default, or nothing (fixed things). */
export function heldAdapterFor(item: Interactable): HeldAdapter | null {
  const own = item as Partial<HeldSyncable>
  if (typeof own.heldAdapter === 'function') return own.heldAdapter()
  if (!(item instanceof LooseItem)) return null
  let before: { visible: boolean; enabled: boolean } | null = null
  return {
    heldBy: () => item.heldBy,
    shown: () => item.object,
    taken: (on) => {
      if (on) {
        before ??= { visible: item.object.visible, enabled: item.enabled }
        item.object.visible = false
        item.enabled = false
      } else if (before) {
        item.object.visible = before.visible
        item.enabled = before.enabled
        before = null
      }
    },
  }
}

/** Register every holdable thing in a grab system, by its place in the list (the same everywhere). */
export function syncAll(sync: HeldSync, prefix: string, items: Interactable[]): void {
  items.forEach((item, i) => {
    const adapter = heldAdapterFor(item)
    if (adapter) sync.add(`${prefix}/${i}`, adapter)
  })
}
