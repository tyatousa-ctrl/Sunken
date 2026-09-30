import * as THREE from 'three'
import { CLASS_NAMES, type CharacterClass } from '../systems/crew'
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
  /** Their class, shown under the name. */
  character?: string
}

// A crew member: a head, a body hanging below it, two hands and a name tag, dressed as a pirate on
// deck and as a diver in the water.
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

export type Outfit = 'pirate' | 'scuba'

/** Pirate dress on the ship's deck; dive gear once in the water, and in every dive level. */
export function outfitFor(stage: string, water: boolean): Outfit {
  return stage === 'intro' && !water ? 'pirate' : 'scuba'
}

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
  private readonly scubaHead = new THREE.Group()
  private readonly scubaBody = new THREE.Group()
  private readonly pirateHead = new THREE.Group()
  private readonly pirateBody = new THREE.Group()
  private readonly gloves: THREE.Mesh[] = []
  private readonly bareHands: THREE.Mesh[] = []
  outfit: Outfit = 'scuba'

  constructor(color: string) {
    this.color = new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    const skin = new THREE.MeshStandardMaterial({ color: 0xc58c64, roughness: 0.8 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.6 })
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd8ee, roughness: 0.05, transparent: true, opacity: 0.5 })

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), skin)
    this.head.add(skull)
    // Diving: a cap in your crew colour, a mask, a tank on your back, gloves.
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.color)
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.04), dark)
    mask.position.set(0, 0.01, -0.1)
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.055), glass)
    lens.position.set(0, 0.01, -0.121)
    lens.rotation.y = Math.PI
    this.scubaHead.add(cap, mask, lens)

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.45, 4, 10), this.color)
    torso.position.y = -0.52
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0xe8c547, roughness: 0.4 }))
    tank.position.set(0, -0.45, 0.2)
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.6, 4, 8), dark)
    legs.position.y = -1.05
    this.scubaBody.add(torso, tank, legs)

    // On deck: a pirate. Tricorn hat, a bandana in your crew colour, an eye patch, a loose shirt
    // with a crew-colour waistcoat and sash, a belt with a brass buckle, breeches and boots.
    const black = new THREE.MeshStandardMaterial({ color: 0x17161a, roughness: 0.8 })
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a13e, roughness: 0.35, metalness: 0.8 })
    const shirt = new THREE.MeshStandardMaterial({ color: 0xe9e0c9, roughness: 0.9 })
    const breeches = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 })
    const bandana = new THREE.Mesh(new THREE.SphereGeometry(0.117, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), this.color)
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.1, 3), black)
    // One corner of the tricorn to the front.
    hat.rotation.y = Math.PI
    hat.position.y = 0.1
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 3), black)
    brim.rotation.y = Math.PI
    brim.position.y = 0.06
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.006, 4, 3), brass)
    trim.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    trim.position.y = 0.066
    const patch = new THREE.Mesh(new THREE.CircleGeometry(0.024, 12), black)
    patch.position.set(0.04, 0.02, -0.109)
    patch.rotation.y = Math.PI + 0.35
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.113, 0.004, 4, 24), black)
    strap.rotation.set(0.35, 0, 0.5)
    strap.position.y = 0.02
    this.pirateHead.add(bandana, hat, brim, trim, patch, strap)

    const blouse = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.45, 4, 10), shirt)
    blouse.position.y = -0.52
    // Waistcoat: a shell over the shirt, open down the front (the avatar faces -z).
    const vestBack = new THREE.Mesh(new THREE.CylinderGeometry(0.182, 0.182, 0.36, 12, 1, true, -Math.PI * 0.8, Math.PI * 1.6), this.color)
    vestBack.position.y = -0.5
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.03, 6, 16), this.color)
    sash.rotation.x = Math.PI / 2
    sash.position.y = -0.8
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.178, 0.018, 4, 16), black)
    belt.rotation.x = Math.PI / 2
    belt.position.y = -0.74
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.045, 0.012), brass)
    buckle.position.set(0, -0.74, -0.19)
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.02), this.color)
    knot.position.set(0.14, -0.88, -0.1)
    knot.rotation.set(0.2, 0.6, 0.25)
    const trousers = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.6, 4, 8), breeches)
    trousers.position.y = -1.05
    const boots = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.125, 0.24, 10), black)
    boots.position.y = -1.36
    this.pirateBody.add(blouse, vestBack, sash, belt, buckle, knot, trousers, boots)
    this.head.add(this.scubaHead, this.pirateHead)
    this.body.add(this.scubaBody, this.pirateBody)

    for (const hand of this.hands) {
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.12), this.color)
      const bare = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.032, 0.11), skin)
      hand.add(glove, bare)
      this.gloves.push(glove)
      this.bareHands.push(bare)
    }
    this.setOutfit('scuba')

    this.tagCanvas.width = 384
    this.tagCanvas.height = 104
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(this.tagCanvas), depthTest: false, fog: false }))
    this.tag.scale.set(0.6, 0.1625, 1)
    this.tag.renderOrder = 700
    this.group.add(this.head, this.body, ...this.hands, this.tag)
  }

  setOutfit(outfit: Outfit): void {
    this.outfit = outfit
    const pirate = outfit === 'pirate'
    this.pirateHead.visible = this.pirateBody.visible = pirate
    this.scubaHead.visible = this.scubaBody.visible = !pirate
    for (const g of this.gloves) g.visible = !pirate
    for (const b of this.bareHands) b.visible = pirate
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

  /** Rough body volume (world spheres: head, chest, hips) for things that strike it. */
  hitSpheres(): { center: THREE.Vector3; radius: number }[] {
    this.group.updateMatrixWorld(true)
    return [
      { center: this.head.getWorldPosition(new THREE.Vector3()), radius: 0.14 },
      { center: this.body.localToWorld(new THREE.Vector3(0, -0.45, 0)), radius: 0.22 },
      { center: this.body.localToWorld(new THREE.Vector3(0, -0.85, 0)), radius: 0.19 },
    ]
  }

  /** Their crew colour (for the mini map). */
  get tint(): THREE.Color {
    return this.color.color
  }

  setInfo(entry: AvatarInfo): void {
    this.color.color.set(entry.color)
    const text = entry.connected ? entry.name : `${entry.name} (reconnecting)`
    const cls = entry.character ? (CLASS_NAMES[entry.character as CharacterClass] ?? entry.character) : ''
    const key = `${text}|${entry.bot}|${cls}|${entry.color}`
    if (key === this.tagText) return
    this.tagText = key
    const ctx = this.tagCanvas.getContext('2d')!
    ctx.clearRect(0, 0, 384, 104)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.beginPath()
    ctx.roundRect(4, 8, 376, cls ? 88 : 48, 16)
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
    ctx.fillText(text, x, 44, 340)
    // Their class underneath, for everyone to see.
    if (cls) {
      ctx.fillStyle = '#e8f1f5'
      ctx.font = '24px system-ui, sans-serif'
      ctx.fillText(cls, 192, 82, 340)
    }
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
    this.tag.position.set(pose[0], pose[1] + 0.36, pose[2])
  }

  /**
   * Hang the body under the head, turned with the head's yaw. Standing, it stretches or squashes to
   * reach the ground (so it matches your real height, and crouching bends it). Swimming, it leans
   * back toward horizontal, all the way flat near the seabed, so legs never sink into the ground.
   */
  poseBody(): void {
    const outfit = outfitFor(this.stage, this.water)
    if (outfit !== this.outfit) this.setOutfit(outfit)
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

  /** World positions of the hands of everyone shown here (same stage), for touching things. */
  handPositions(): THREE.Vector3[] {
    const out: THREE.Vector3[] = []
    for (const avatar of this.avatars.values()) {
      if (!avatar.group.visible) continue
      for (const hand of avatar.hands) out.push(hand.getWorldPosition(new THREE.Vector3()))
    }
    return out
  }

  /** World positions of the heads of everyone shown here (same stage). */
  headPositions(): THREE.Vector3[] {
    return [...this.avatars.values()].filter((a) => a.group.visible).map((a) => a.head.getWorldPosition(new THREE.Vector3()))
  }

  /** Everyone shown here (same stage), by session id. */
  visibleAvatars(): [string, Avatar][] {
    return [...this.avatars.entries()].filter(([, a]) => a.group.visible)
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
