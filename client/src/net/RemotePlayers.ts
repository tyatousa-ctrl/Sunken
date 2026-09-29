import * as THREE from 'three'
import type { NetClient } from './NetClient'
import type { PoseArray, PosesBroadcast } from './protocol'

/** Others are drawn this far in the past, so there are always two poses to blend between. */
const INTERPOLATION_DELAY_MS = 100
const BUFFER_MS = 1000

interface Snapshot {
  t: number
  pose: PoseArray
  water: boolean
}

export interface AvatarInfo {
  sessionId: string
  name: string
  color: string
  connected: boolean
  bot?: boolean
}

// A diver: a masked head, a body hanging below it, two gloved hands, and a name tag.
// Used for other players and for bots.
/** Eye to the soles of the feet, for the avatar model at scale 1. */
const BODY_LENGTH = 1.55
/** Swimmers always lean forward a little. */
const SWIM_LEAN = 0.35
const MAX_COS_LEAN = Math.cos(SWIM_LEAN)

/**
 * Ground under a point in the current stage (deck, beach or seabed), or null over open water.
 * Set by the player when a stage starts, and used to keep every avatar's body out of the floor.
 */
export const avatarGround: { at: ((x: number, z: number, below?: number) => number | null) | null } = { at: null }

export class Avatar {
  readonly group = new THREE.Group()
  readonly head = new THREE.Group()
  readonly hands: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()]
  readonly body = new THREE.Group()
  readonly snapshots: Snapshot[] = []
  stage = ''
  water = false
  private readonly tag: THREE.Sprite
  private readonly tagCanvas = document.createElement('canvas')
  private tagText = ''
  private readonly color: THREE.MeshStandardMaterial

  constructor(color: string) {
    this.color = new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    const skin = new THREE.MeshStandardMaterial({ color: 0xc58c64, roughness: 0.8 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.6 })
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd8ee, roughness: 0.05, transparent: true, opacity: 0.5 })

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), skin)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.color)
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.04), dark)
    mask.position.set(0, 0.01, -0.1)
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.055), glass)
    lens.position.set(0, 0.01, -0.121)
    lens.rotation.y = Math.PI
    this.head.add(skull, cap, mask, lens)

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.45, 4, 10), this.color)
    torso.position.y = -0.52
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0xe8c547, roughness: 0.4 }))
    tank.position.set(0, -0.45, 0.2)
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.6, 4, 8), dark)
    legs.position.y = -1.05
    this.body.add(torso, tank, legs)

    for (const hand of this.hands) {
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.12), this.color)
      hand.add(glove)
    }

    this.tagCanvas.width = 384
    this.tagCanvas.height = 64
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(this.tagCanvas), depthTest: false, fog: false }))
    this.tag.scale.set(0.6, 0.1, 1)
    this.tag.renderOrder = 700
    this.group.add(this.head, this.body, ...this.hands, this.tag)
  }

  setColor(color: string): void {
    this.color.color.set(color)
  }

  /** Your own body: no head (the camera is there), hands (the controllers are) or name tag. */
  makeSelf(): void {
    this.head.visible = false
    this.tag.visible = false
    for (const hand of this.hands) hand.visible = false
    // Nudge the torso back a touch so looking down shows your chest, not the inside of it.
    this.body.children.forEach((c) => (c.position.z += 0.06))
  }

  setInfo(entry: AvatarInfo): void {
    this.color.color.set(entry.color)
    const text = entry.connected ? entry.name : `${entry.name} (reconnecting)`
    if (text + entry.bot === this.tagText) return
    this.tagText = text + entry.bot
    const ctx = this.tagCanvas.getContext('2d')!
    ctx.clearRect(0, 0, 384, 64)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.beginPath()
    ctx.roundRect(4, 8, 376, 48, 16)
    ctx.fill()
    let x = 192
    if (entry.bot) {
      // Small robot-head icon: bots are marked as bots.
      ctx.fillStyle = '#cfe8ff'
      ctx.fillRect(16, 22, 26, 22)
      ctx.fillRect(27, 14, 4, 8)
      ctx.fillStyle = '#1b2a33'
      ctx.fillRect(21, 28, 5, 5)
      ctx.fillRect(32, 28, 5, 5)
      x = 206
    }
    ctx.fillStyle = entry.color
    ctx.font = `bold ${text.length > 18 ? 24 : 30}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(text, x, 44)
    ;(this.tag.material.map as THREE.Texture).needsUpdate = true
  }

  apply(pose: PoseArray): void {
    this.head.position.set(pose[0], pose[1], pose[2])
    this.head.quaternion.set(pose[3], pose[4], pose[5], pose[6])
    this.hands[0].position.set(pose[7], pose[8], pose[9])
    this.hands[0].quaternion.set(pose[10], pose[11], pose[12], pose[13])
    this.hands[1].position.set(pose[14], pose[15], pose[16])
    this.hands[1].quaternion.set(pose[17], pose[18], pose[19], pose[20])
    this.poseBody()
    this.tag.position.set(pose[0], pose[1] + 0.32, pose[2])
  }

  /**
   * Hang the body under the head, turned with the head's yaw. Standing, it stretches or squashes to
   * reach the ground (so it matches your real height, and crouching bends it). Swimming, it leans
   * back toward horizontal, all the way flat near the seabed, so legs never sink into the ground.
   */
  poseBody(): void {
    const head = this.head.position
    this.body.position.copy(head)
    const e = new THREE.Euler().setFromQuaternion(this.head.quaternion, 'YXZ')
    const floor = avatarGround.at?.(head.x, head.z, head.y - 0.2) ?? null
    const drop = floor === null ? BODY_LENGTH : head.y - floor
    let lean = 0
    let stretch = 1
    if (this.water) {
      // Lowest point of the tilted body: head.y - BODY_LENGTH * cos(lean) must stay above the floor.
      const cos = THREE.MathUtils.clamp((drop - 0.12) / BODY_LENGTH, 0, MAX_COS_LEAN)
      lean = Math.acos(cos)
    } else {
      stretch = THREE.MathUtils.clamp(drop / BODY_LENGTH, 0.45, 1.25)
    }
    // Negative pitch swings the legs out behind (+z is the back).
    this.body.rotation.set(-lean, e.y, 0, 'YXZ')
    this.body.scale.set(1, stretch, 1)
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
    })
  }
}

const qa = new THREE.Quaternion()
const qb = new THREE.Quaternion()

/** Blend two poses (positions lerp, quaternions slerp). */
function blend(a: PoseArray, b: PoseArray, t: number, out: PoseArray): PoseArray {
  for (const base of [0, 7, 14]) {
    for (let i = 0; i < 3; i++) out[base + i] = a[base + i] + (b[base + i] - a[base + i]) * t
    qa.fromArray(a, base + 3)
    qb.fromArray(b, base + 3)
    qa.slerp(qb, t).toArray(out, base + 3)
  }
  return out
}

// Everyone else in the crew, drawn from their relayed poses about 100 ms in the past so the motion
// is smooth. Avatars only show when they're in the same stage as you.
export class RemotePlayers {
  private readonly avatars = new Map<string, Avatar>()
  private readonly scratch: PoseArray = new Array(21).fill(0)

  constructor(
    private readonly scene: THREE.Scene,
    private readonly net: NetClient,
  ) {
    net.on<PosesBroadcast>('poses', (msg) => {
      for (const [sessionId, p] of Object.entries(msg.players)) {
        if (sessionId === net.sessionId) continue
        const avatar = this.avatars.get(sessionId)
        if (!avatar) continue
        avatar.snapshots.push({ t: msg.t, pose: p.pose, water: p.water })
        avatar.stage = p.stage
        while (avatar.snapshots.length > 2 && msg.t - avatar.snapshots[0].t > BUFFER_MS) avatar.snapshots.shift()
      }
    })
  }

  /** A remote player's hand (0 left, 1 right), to hang a held object on. */
  hand(sessionId: string, index: 0 | 1): THREE.Object3D | null {
    return this.avatars.get(sessionId)?.hands[index] ?? null
  }

  head(sessionId: string): THREE.Object3D | null {
    return this.avatars.get(sessionId)?.head ?? null
  }

  isUnderwater(sessionId: string): boolean {
    return this.avatars.get(sessionId)?.water ?? false
  }

  /** Draw these players (and, if another device runs the bots, those bots) from relayed poses. */
  update(myStage: string, entries: AvatarInfo[]): void {
    const present = new Set<string>()
    for (const entry of entries) {
      if (entry.sessionId === this.net.sessionId) continue
      present.add(entry.sessionId)
      let avatar = this.avatars.get(entry.sessionId)
      if (!avatar) {
        avatar = new Avatar(entry.color)
        this.avatars.set(entry.sessionId, avatar)
        this.scene.add(avatar.group)
      }
      avatar.setInfo(entry)
    }
    for (const [id, avatar] of this.avatars) {
      if (present.has(id)) continue
      this.scene.remove(avatar.group)
      avatar.dispose()
      this.avatars.delete(id)
    }

    const renderAt = this.net.serverNow() - INTERPOLATION_DELAY_MS
    for (const avatar of this.avatars.values()) {
      const s = avatar.snapshots
      avatar.group.visible = s.length > 0 && avatar.stage === myStage
      if (!avatar.group.visible) continue
      let i = s.length - 1
      while (i > 0 && s[i - 1].t > renderAt) i--
      avatar.water = s[s.length - 1].water
      if (i === 0 || s[i].t <= renderAt) {
        avatar.apply(s[Math.min(i, s.length - 1)].pose)
      } else {
        const a = s[i - 1]
        const b = s[i]
        const t = THREE.MathUtils.clamp((renderAt - a.t) / Math.max(1, b.t - a.t), 0, 1)
        avatar.apply(blend(a.pose, b.pose, t, this.scratch))
      }
    }
  }
}
