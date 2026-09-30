import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { GrabSystem, Interactable } from '../interaction/GrabSystem'
import { Avatar } from '../net/RemotePlayers'
import { Label } from '../ui/Label'
import { DECK_Y, type Galleon } from '../world/ship/Galleon'

/** The rope lies along the middle of the deck, a little to starboard (ship-local). */
export const TUG_X = 0.6
export const TUG_CENTRE_Z = -10
/** Half the rope's length; Red pulls toward the bow (-z), Blue toward the stern (+z). */
const HALF = 2.6
const ROPE_Y = DECK_Y + 1.0
/** Drag the rag this far past the centre line to win. */
export const WIN_AT = 1.2
/** How far the rope moves for each m/s of pulling the other side doesn't match. */
const GAIN = 0.32
/** A hand counts at most this fast (m/s), so flailing isn't everything. */
const MAX_HAND = 2.5
const GRAB_REACH = 0.1
const RESET_SECONDS = 5
export const RED = 0
export const BLUE = 1
const TEAM_NAMES = ['Red', 'Blue']
const TEAM_COLORS = ['#d8412f', '#2f7fd8']

export interface TugContext {
  audio: AudioSystem
  confetti: Particles
  water: Particles
  camera: THREE.Camera
  say: (text: string, seconds: number) => void
  /** Solo, or the crew's host: this device runs the match. */
  isHost: () => boolean
  /** Now (s), for spotting stale pulls. */
  now: () => number
  /** Heads of crewmates (by session id) on deck, for dumping water on the losers. */
  head: (id: string) => THREE.Vector3 | null
}

/** One side's pulling this moment. */
interface Pull {
  team: number
  amount: number
  at: number
}

type Phase = 'idle' | 'pulling' | 'won'

// Tug-of-War, amidships: a thick rope along the deck with a red rag tied at its middle over a chalk
// line, a red mark toward the bow and a blue one toward the stern. Grip the rope on your side of the
// rag and haul it back, hand over hand: the harder your side pulls, the faster the rag comes your way.
// Drag it past your mark to win: cheers and confetti for the winners, a bucket of seawater over the
// losers. 1v1, 2v1 or 2v2; on your own, Bosun Bruno takes the other end (and pulls harder the longer
// it goes). In a crew one device (the host) runs the match from everyone's pulls.
export class TugOfWar {
  /** Tell the crew what my hands are pulling (team, m/s). */
  onPull: (team: number, amount: number) => void = () => {}
  /** The host tells the crew the match: [offset, phase, winner, round, red wins, blue wins, bruno's team]. */
  onMatch: (state: number[]) => void = () => {}
  readonly rope: Rope
  private readonly root = new THREE.Group()
  private readonly rag: THREE.Mesh
  private readonly board = document.createElement('canvas')
  private readonly boardTexture: THREE.CanvasTexture
  private readonly sign = new Label({ width: 0.62, canvasWidth: 620, canvasHeight: 250, billboard: true })
  private readonly bruno = new Avatar('#8a6a3a')
  /** Where the rope is: + toward Blue's end (the stern). */
  offset = 0
  private shownOffset = 0
  phase: Phase = 'idle'
  winner = -1
  round = 0
  readonly score = [0, 0]
  /** Which side Bosun Bruno is pulling for (-1: not needed). */
  brunoTeam = -1
  private brunoPull = 0
  private wonAt = 0
  private matchTime = 0
  private sendTimer = 0
  private matchTimer = 0
  private heard = false
  private drawKey = ''
  /** Everyone's latest pull (by session id; "me" for this device). */
  private readonly pulls = new Map<string, Pull>()
  /** My side in the round (for the bucket), and when I last pulled. */
  private myTeam = -1
  private myLastPull = -99
  private readonly v = new THREE.Vector3()

  constructor(
    ship: Galleon,
    grab: GrabSystem,
    private readonly ctx: TugContext,
  ) {
    ship.shake.add(this.root)
    // The chalk line and the two marks on the deck.
    const chalk = (z: number, color: number, w: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, w).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color, roughness: 1 }))
      m.position.set(TUG_X, DECK_Y + 0.004, z)
      this.root.add(m)
    }
    chalk(TUG_CENTRE_Z, 0xeeeeee, 0.05)
    chalk(TUG_CENTRE_Z - WIN_AT, 0xd8412f, 0.08)
    chalk(TUG_CENTRE_Z + WIN_AT, 0x2f7fd8, 0.08)
    // Posts at each end with a coil of spare rope, painted in the side's colour.
    for (const [z, color] of [[TUG_CENTRE_Z - HALF - 0.5, 0xd8412f], [TUG_CENTRE_Z + HALF + 0.5, 0x2f7fd8]] as const) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.7, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }))
      post.position.set(TUG_X + 0.9, DECK_Y + 0.35, z)
      this.root.add(post)
    }

    this.rope = new Rope(this)
    this.root.add(this.rope.object)
    grab.add(this.rope)
    // The red rag tied round its middle.
    this.rag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.26, 3, 4), new THREE.MeshStandardMaterial({ color: 0xd11f1f, roughness: 0.9, side: THREE.DoubleSide }))
    this.rag.position.set(0, -0.14, 0)
    this.rope.object.add(this.rag)

    // The score board beside the centre line.
    this.board.width = 512
    this.board.height = 256
    this.boardTexture = new THREE.CanvasTexture(this.board)
    this.boardTexture.colorSpace = THREE.SRGBColorSpace
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.08), new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.85 }))
    post.position.set(TUG_X + 1.9, DECK_Y + 0.9, TUG_CENTRE_Z)
    const slate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: this.boardTexture, fog: false }))
    slate.position.set(TUG_X + 1.85, DECK_Y + 1.9, TUG_CENTRE_Z)
    slate.rotation.y = -Math.PI / 2
    this.root.add(post, slate)
    this.sign.mesh.position.set(TUG_X + 1.9, DECK_Y + 2.45, TUG_CENTRE_Z)
    this.root.add(this.sign.mesh)
    this.sign.set([
      { text: 'Tug-of-War', size: 44, bold: true, color: '#f2b64a' },
      { text: 'Grip the rope on your side of the rag and haul it back, hand over hand', size: 24 },
      { text: 'Red: toward the bow · Blue: toward the stern', size: 24, color: '#ffe0a0' },
      { text: 'Drag the rag past your mark to win!', size: 24 },
    ])

    // Bosun Bruno: a big fellow who takes the other end when you're on your own.
    this.bruno.setInfo({ sessionId: 'bruno', name: 'Bosun Bruno', color: '#8a6a3a', connected: true })
    this.bruno.group.visible = false
    this.root.add(this.bruno.group)
    this.drawBoard()
  }

  /** The rope's centre (ship-local z) right now: where the rag is. */
  get ragZ(): number {
    return TUG_CENTRE_Z + this.shownOffset
  }

  /** A hand on the rope: which side of the rag is it on? */
  teamAt(point: THREE.Vector3): number {
    const local = this.root.worldToLocal(point.clone())
    return local.z < this.ragZ ? RED : BLUE
  }

  /** The rope's line (world), for gripping it. */
  line(target: THREE.Line3): THREE.Line3 {
    const a = this.root.localToWorld(new THREE.Vector3(TUG_X, ROPE_Y, this.ragZ - HALF))
    const b = this.root.localToWorld(new THREE.Vector3(TUG_X, ROPE_Y, this.ragZ + HALF))
    return target.set(a, b)
  }

  /** A crewmate's pull arrived. */
  remotePull(id: string, team: number, amount: number): void {
    this.pulls.set(id, { team, amount, at: this.ctx.now() })
  }

  /** The host's word on the match (crewmates show this). */
  remoteMatch(s: number[]): void {
    if (this.ctx.isHost()) return
    const [offset, phase, winner, round, red, blue, bruno] = s
    // (The first word we hear may be an old result: no celebrating a match we weren't here for.)
    const newWin = phase === 2 && this.phase !== 'won' && this.heard
    this.heard = true
    this.offset = offset
    this.round = round
    this.score[RED] = red
    this.score[BLUE] = blue
    this.brunoTeam = bruno
    this.phase = phase === 1 ? 'pulling' : phase === 2 ? 'won' : 'idle'
    if (newWin) this.celebrate(winner)
    this.winner = winner
  }

  update(dt: number, hands: Hand[], camera: THREE.Camera): void {
    this.sign.face(camera)
    const now = this.ctx.now()
    // My pull this frame: every hand on the rope, moving toward its side's end.
    let mine = 0
    let team = -1
    for (const h of hands) {
      const p = this.rope.pullOf(h, dt)
      if (p) {
        mine += p.amount
        team = p.team
      }
    }
    if (team >= 0) {
      this.myTeam = team
      this.myLastPull = now
      this.pulls.set('me', { team, amount: mine, at: now })
    } else this.pulls.delete('me')
    this.sendTimer -= dt
    if (this.sendTimer <= 0) {
      this.sendTimer = 0.1
      if (team >= 0 || mine > 0) this.onPull(team, Math.round(mine * 100) / 100)
    }

    if (this.ctx.isHost()) this.runMatch(dt, now)
    // Show the rope sliding (smoothly, when it comes from the host).
    this.shownOffset += (this.offset - this.shownOffset) * Math.min(1, dt * 12)
    this.rope.object.position.z = this.ragZ
    this.rag.rotation.y = Math.sin(now * 3) * 0.3
    this.poseBruno(now)
    this.drawBoard()
  }

  /** The host's side of things: add up the pulls, move the rope, call the winner. */
  private runMatch(dt: number, now: number): void {
    const fresh = [...this.pulls.values()].filter((p) => now - p.at < 0.5)
    const force = [0, 0]
    const teams = new Set<number>()
    for (const p of fresh) {
      teams.add(p.team)
      force[p.team] += Math.min(p.amount, MAX_HAND * 2)
    }
    if (this.phase === 'won') {
      if (now - this.wonAt > RESET_SECONDS) {
        this.phase = 'idle'
        this.winner = -1
        this.brunoTeam = -1
      }
      this.offset *= Math.exp(-dt * 1.5)
    } else {
      // Someone's on one side only: Bruno takes the other end.
      if (teams.size === 1) this.brunoTeam = teams.has(RED) ? BLUE : RED
      else if (teams.size === 2) this.brunoTeam = -1
      if (teams.size > 0 && this.phase === 'idle') {
        this.phase = 'pulling'
        this.matchTime = 0
        this.round++
      }
      if (this.phase === 'pulling') {
        this.matchTime += dt
        if (this.brunoTeam >= 0) {
          // He hauls in heaves, and harder the longer it goes.
          this.brunoPull = (0.9 + Math.min(1, this.matchTime / 25) * 0.9) * (0.75 + 0.5 * Math.max(0, Math.sin(this.matchTime * 2.2)))
          force[this.brunoTeam] += this.brunoPull
        }
        this.offset += (force[BLUE] - force[RED]) * GAIN * dt
        if (teams.size === 0 && this.brunoTeam < 0) this.offset *= Math.exp(-dt * 0.5)
        if (Math.abs(this.offset) >= WIN_AT) {
          const winner = this.offset < 0 ? RED : BLUE
          this.phase = 'won'
          this.winner = winner
          this.wonAt = now
          this.score[winner]++
          this.celebrate(winner)
        }
      }
    }
    this.matchTimer -= dt
    if (this.matchTimer > 0 && this.phase !== 'won') return
    this.matchTimer = 0.1
    this.onMatch([Math.round(this.offset * 1000) / 1000, ['idle', 'pulling', 'won'].indexOf(this.phase), this.winner, this.round, this.score[RED], this.score[BLUE], this.brunoTeam])
  }

  /** The winners cheer under confetti; the losers get a bucket of seawater. */
  private celebrate(winner: number): void {
    const end = this.root.localToWorld(new THREE.Vector3(TUG_X, ROPE_Y + 0.8, TUG_CENTRE_Z + (winner === RED ? -HALF : HALF)))
    for (let i = 0; i < 4; i++) this.ctx.confetti.emit({ position: end, velocity: new THREE.Vector3(0, 3, 0), spread: 2.2, color: [0xffd35a, 0xd8412f, 0x2f7fd8, 0x3cb371][i], size: 0.05, life: 1.6, count: 25 })
    this.ctx.audio.play('whistle', end, 0.8)
    const loser = 1 - winner
    const now = this.ctx.now()
    // Me: soaked if I was pulling for the losing side just now.
    if (this.myTeam === loser && now - this.myLastPull < 3) {
      const head = this.ctx.camera.getWorldPosition(new THREE.Vector3())
      this.soak(head)
      this.ctx.say(`${TEAM_NAMES[winner]} wins! Sploosh: a bucket of seawater down your neck.`, 4)
    } else if (this.myTeam === winner && now - this.myLastPull < 3) {
      this.ctx.say(`${TEAM_NAMES[winner]} wins! Heave-ho, well hauled!`, 4)
    } else this.ctx.say(`${TEAM_NAMES[winner]} wins the tug-of-war!`, 3)
    // Crewmates who were pulling for the losers get theirs too.
    for (const [id, p] of this.pulls) {
      if (id === 'me' || p.team !== loser || now - p.at > 3) continue
      const head = this.ctx.head(id)
      if (head) this.soak(head)
    }
    this.myTeam = -1
  }

  /** A bucket's worth of water tipped over a head. */
  private soak(head: THREE.Vector3): void {
    const above = head.clone().add(new THREE.Vector3(0, 0.5, 0))
    this.ctx.water.emit({ position: above, velocity: new THREE.Vector3(0, -1.5, 0), spread: 0.6, color: 0xbfe6f5, size: 0.06, life: 0.9, count: 45 })
    this.ctx.audio.play('splash', head, 1)
  }

  /** Bruno at his end, leaning back, fists on the rope. */
  private poseBruno(now: number): void {
    const team = this.brunoTeam
    this.bruno.group.visible = team >= 0
    if (team < 0) return
    const dir = team === RED ? -1 : 1
    const z = this.ragZ + dir * (HALF - 0.4)
    const lean = 0.25 + 0.1 * Math.sin(now * 2.2)
    const pose = new Array(21).fill(0) as number[]
    const head = this.root.localToWorld(new THREE.Vector3(TUG_X + 0.3, DECK_Y + 1.75, z + dir * lean))
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, dir > 0 ? 0 : Math.PI, 0))
    const l = this.root.localToWorld(new THREE.Vector3(TUG_X + 0.08, ROPE_Y, z - dir * 0.2))
    const r = this.root.localToWorld(new THREE.Vector3(TUG_X + 0.04, ROPE_Y, z - dir * 0.45))
    head.toArray(pose, 0)
    q.toArray(pose, 3)
    l.toArray(pose, 7)
    q.toArray(pose, 10)
    r.toArray(pose, 14)
    q.toArray(pose, 17)
    this.bruno.apply(pose as never)
    this.bruno.water = false
    this.bruno.poseBody()
  }

  private drawBoard(): void {
    const status = this.phase === 'won' ? `${TEAM_NAMES[this.winner]} wins!` : this.phase === 'pulling' ? 'PULL!' : 'Grab the rope!'
    const key = `${this.score[RED]}|${this.score[BLUE]}|${status}|${this.brunoTeam}`
    if (key === this.drawKey) return
    this.drawKey = key
    const ctx = this.board.getContext('2d')!
    ctx.fillStyle = '#2b2f2c'
    ctx.fillRect(0, 0, 512, 256)
    ctx.strokeStyle = '#8a5a2b'
    ctx.lineWidth = 14
    ctx.strokeRect(7, 7, 498, 242)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#f2b64a'
    ctx.font = 'bold 40px Georgia, serif'
    ctx.fillText('TUG-OF-WAR', 256, 58)
    ctx.font = 'bold 64px Georgia, serif'
    ctx.fillStyle = TEAM_COLORS[RED]
    ctx.fillText(String(this.score[RED]), 150, 140)
    ctx.fillStyle = '#efeee6'
    ctx.fillText(':', 256, 136)
    ctx.fillStyle = TEAM_COLORS[BLUE]
    ctx.fillText(String(this.score[BLUE]), 362, 140)
    ctx.font = '26px Georgia, serif'
    ctx.fillStyle = '#c9c8bd'
    ctx.fillText('Red (bow)', 150, 172)
    ctx.fillText('Blue (stern)', 362, 172)
    ctx.font = 'bold 34px Georgia, serif'
    ctx.fillStyle = this.phase === 'won' ? TEAM_COLORS[this.winner] : '#ffd166'
    ctx.fillText(status + (this.brunoTeam >= 0 && this.phase !== 'won' ? `  (Bruno's ${TEAM_NAMES[this.brunoTeam]})` : ''), 256, 225, 480)
    this.boardTexture.needsUpdate = true
  }
}

/** The rope: grip it anywhere; your hand's pull toward your side's end is what counts. */
class Rope implements Interactable {
  readonly object = new THREE.Group()
  readonly pullable = false
  private readonly holds = new Map<Hand, { team: number; last: THREE.Vector3 }>()
  private readonly line = new THREE.Line3()
  private readonly v = new THREE.Vector3()

  constructor(private readonly game: TugOfWar) {
    const hemp = new THREE.MeshStandardMaterial({ color: 0x9c7a4a, roughness: 1 })
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, HALF * 2, 10).rotateX(Math.PI / 2), hemp)
    this.object.add(rope)
    // A few twists along it so you can see it slide.
    for (let i = -6; i <= 6; i++) {
      if (i === 0) continue
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.006, 5, 10), new THREE.MeshStandardMaterial({ color: 0x6f5431, roughness: 1 }))
      band.position.z = i * 0.38
      this.object.add(band)
    }
    this.object.position.set(TUG_X, ROPE_Y, TUG_CENTRE_Z)
  }

  grabGap(point: THREE.Vector3, hand: Hand): number {
    if (this.holds.has(hand)) return Infinity
    this.game.line(this.line)
    return this.line.closestPointToPoint(point, true, this.v).distanceTo(point) - GRAB_REACH
  }

  grab(hand: Hand): void {
    const at = hand.worldPos(new THREE.Vector3())
    this.holds.set(hand, { team: this.game.teamAt(at), last: at })
    hand.pulse(0.4, 40)
  }

  release(hand: Hand): void {
    this.holds.delete(hand)
  }

  setHighlight(): void {}

  /** How hard this hand is pulling (m/s toward its side's end), if it's on the rope. */
  pullOf(hand: Hand, dt: number): { team: number; amount: number } | null {
    const hold = this.holds.get(hand)
    if (!hold) return null
    const now = hand.worldPos(new THREE.Vector3())
    const moved = now.clone().sub(hold.last)
    hold.last.copy(now)
    // Along the rope, toward your end (world: the rope runs along the ship's z).
    this.game.line(this.line)
    const axis = this.line.delta(new THREE.Vector3()).normalize()
    const toward = hold.team === RED ? -1 : 1
    const speed = dt > 0 ? (moved.dot(axis) * toward) / dt : 0
    const amount = Math.max(0, Math.min(MAX_HAND, speed))
    if (amount > 0.8) hand.pulse(Math.min(0.8, amount * 0.25), 30)
    return { team: hold.team, amount }
  }
}
