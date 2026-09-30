import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import { Avatar } from '../net/RemotePlayers'
import { clickables, makeButton } from '../ui/Clickables'
import { Label } from '../ui/Label'
import { DECK_Y, type Galleon } from '../world/ship/Galleon'
import { type Bid, bidStands, countFace, isRaise, minRaise, nextSeat, packDice, rollDice, sailorMove, SEATS, START_DICE, unpackDice } from './diceRules'

/** The barrel table stands amidships, on the centreline between the cannons (ship-local). */
export const DICE_AT = new THREE.Vector3(0.6, DECK_Y, -10)
export const TABLE_RADIUS = 0.62
const TOP = DECK_Y + 0.78
/** Seats sit this far out from the table's middle; cups (and dice under them) this far. */
const SEAT_R = 1.0
const CUP_R = 0.33
const DIE = 0.03
/** Seconds: a sailor thinks, the dice stay on show after "Liar!", the winner's cheered. */
const THINK = [1.4, 2.6]
const REVEAL_SECONDS = 6
const OVER_SECONDS = 8
/** A crewmate who hasn't moved in this long has a sailor play their turn for them. */
const TURN_SECONDS = 60
/** Solo or two of you: sailors fill the table to this many players (unless sent away). */
const FILL_TO = 3
export const SAILOR = 9
const EMPTY = -1
const SAILOR_NAMES = ['One-Eyed Pete', 'Salty Sal', 'Barnacle Bill', 'Mad Maggie']
const SAILOR_COLORS = ['#b5651d', '#8b3a62', '#4a7a4a', '#5b5b9b']
const FACE_NAMES = ['', 'ones', 'twos', 'threes', 'fours', 'fives', 'sixes']
const SEAT_COLORS = ['#d8412f', '#2f7fd8', '#3cb371', '#e0a030']

export const enum Phase {
  Idle = 0,
  Bidding = 1,
  Reveal = 2,
  Over = 3,
}

/** What a player can do (sent to the host): [nonce, slot, action, a, b]. */
export const enum Act {
  Sit = 1,
  Leave = 2,
  Start = 3,
  Bid = 4,
  Liar = 5,
  Sailors = 6,
}

export interface DiceContext {
  audio: AudioSystem
  confetti: Particles
  camera: THREE.Camera
  say: (text: string, seconds: number) => void
  /** Solo, or the crew's host: this device runs the game. */
  isHost: () => boolean
  /** My crew slot (0 when solo). */
  mySlot: () => number
  /** The crewmate in a slot, or null if they've gone. */
  nameOf: (slot: number) => string | null
}

// Liar's Dice, pirate style, round a barrel table amidships. Up to four sit down (point at "Sit here"
// and pull the trigger); sailors take the empty chairs when there are fewer than three of you. Everyone
// slams a leather cup over five dice and peeks at their own (your cup tips back for you alone). Take it
// in turns round the table: bid how many dice on the whole table show a face ("four fives"), each bid
// beating the last (more dice, or as many of a higher face), or call "Liar!" on the last bid. Up come
// the cups: if there are at least that many, the caller loses a die; if not, the bidder does. Lose all
// five and you're out; the last with dice wins. One device (the host) runs the game for everyone.
export class LiarsDice {
  /** Tell the host what I did: [nonce, slot, action, a, b]. */
  onAct: (v: number[]) => void = () => {}
  /** The host tells the crew the game: the table, and who sits where with what dice. */
  onState: (table: number[], seats: number[]) => void = () => {}

  private readonly root = new THREE.Group()
  private readonly seats: Seat[] = []
  private readonly board = document.createElement('canvas')
  private readonly boardTexture: THREE.CanvasTexture
  private readonly sign = new Label({ width: 0.7, canvasWidth: 640, canvasHeight: 300, billboard: true })
  private boardKey = ''

  // The shared game (the host's word; everyone draws it).
  phase: Phase = Phase.Idle
  round = 0
  turn = 0
  bid: Bid | null = null
  bidSeat = -1
  loser = -1
  winner = -1
  /** Who sits where: EMPTY, a crew slot, or SAILOR. */
  readonly occ: number[] = new Array(SEATS).fill(EMPTY)
  readonly dice: number[][] = Array.from({ length: SEATS }, () => [])
  /** The crew sent the sailors away (two or more of you want the table to yourselves). */
  noSailors = false

  // The host's bookkeeping.
  private timer = 0
  private readonly lastNonce = new Map<number, number>()
  private dirty = true
  private heartbeat = 0

  // Mine.
  private nonce = Math.floor(Date.now() / 1000) % 1_000_000
  private pick: Bid = { q: 1, f: 1 }
  private pickedFor = ''
  private seen = { round: -1, phase: Phase.Idle as Phase, bidKey: '' }
  /** Heard the host yet? (The first word may be an old game: no cheering one we weren't here for.) */
  private heard = false

  constructor(
    ship: Galleon,
    private readonly ctx: DiceContext,
  ) {
    ship.shake.add(this.root)
    this.root.position.copy(DICE_AT)
    this.buildTable()
    const materials = dieMaterials()
    for (let i = 0; i < SEATS; i++) {
      const seat = new Seat(i, materials, this)
      this.root.add(seat.group)
      this.seats.push(seat)
    }
    // The bid board, hung over the table on a pole, one face to each seat.
    this.board.width = 512
    this.board.height = 256
    this.boardTexture = new THREE.CanvasTexture(this.board)
    this.boardTexture.colorSpace = THREE.SRGBColorSpace
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.85 })
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.1, 8), wood)
    pole.position.y = TOP - DECK_Y + 0.55
    const face = new THREE.MeshBasicMaterial({ map: this.boardTexture, fog: false })
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.26, 0.52), [face, face, wood, wood, face, face])
    box.position.y = TOP - DECK_Y + 1.2
    this.root.add(pole, box)
    this.sign.mesh.position.set(0, TOP - DECK_Y + 1.72, 0)
    this.root.add(this.sign.mesh)
    this.sign.set([
      { text: "Liar's Dice", size: 46, bold: true, color: '#f2b64a' },
      { text: 'Point at "Sit here" and pull the trigger. Everyone gets 5 dice under a cup: only you see yours.', size: 22 },
      { text: 'In turn, bid how many dice on the WHOLE table show a face, each bid higher than the last, or call LIAR!', size: 22, color: '#ffe0a0' },
      { text: 'Wrong call or bad bid: lose a die. Last pirate with dice wins!', size: 22 },
    ])
    this.drawBoard()
  }

  private buildTable(): void {
    const staves = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.8 })
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.6 })
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, TOP - DECK_Y - 0.05, 16), staves)
    barrel.position.y = (TOP - DECK_Y - 0.05) / 2
    for (const y of [0.12, TOP - DECK_Y - 0.17]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.015, 6, 24).rotateX(Math.PI / 2), iron)
      hoop.position.y = y
      this.root.add(hoop)
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.05, 32), new THREE.MeshStandardMaterial({ color: 0x8d6238, roughness: 0.7 }))
    top.position.y = TOP - DECK_Y - 0.025
    // Green baize to roll on.
    const baize = new THREE.Mesh(new THREE.CircleGeometry(TABLE_RADIUS - 0.06, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1f5a36, roughness: 1 }))
    baize.position.y = TOP - DECK_Y + 0.001
    this.root.add(barrel, top, baize)
  }

  /** My seat at the table, if I'm sitting down. */
  get mySeat(): number {
    return this.occ.indexOf(this.ctx.mySlot())
  }

  nameAt(seat: number): string {
    const o = this.occ[seat]
    if (o === SAILOR) return SAILOR_NAMES[seat]
    if (o === EMPTY) return ''
    if (o === this.ctx.mySlot()) return 'You'
    return this.ctx.nameOf(o) ?? 'A pirate'
  }

  private get counts(): number[] {
    return this.dice.map((d) => d.length)
  }

  private get totalDice(): number {
    return this.counts.reduce((a, b) => a + b, 0)
  }

  // ---- Doing things ------------------------------------------------------------------------------

  /** Something I do at the table: the host does it straight away, crewmates ask the host. */
  act(action: Act, a = 0, b = 0): void {
    const slot = this.ctx.mySlot()
    if (this.ctx.isHost()) this.apply(slot, action, a, b)
    else this.onAct([++this.nonce, slot, action, a, b])
  }

  /** A crewmate did something (only the host listens). */
  remoteAct(v: number[], by: string): void {
    if (!by || !this.ctx.isHost()) return
    const [nonce, slot, action, a, b] = v
    if (nonce <= (this.lastNonce.get(slot) ?? -1)) return
    this.lastNonce.set(slot, nonce)
    this.apply(slot, action as Act, a, b)
  }

  /** The host's word on the game. */
  remoteTable(v: number[]): void {
    if (this.ctx.isHost() && this.round > 0) return
    const [phase, round, turn, q, f, bidSeat, loser, winner] = v
    this.phase = (phase % 10) as Phase
    this.noSailors = phase >= 10
    this.round = round
    this.turn = turn
    this.bid = q > 0 ? { q, f } : null
    this.bidSeat = bidSeat
    this.loser = loser
    this.winner = winner
    if (!this.heard) {
      this.heard = true
      this.seen = { round: this.round, phase: this.phase, bidKey: this.bidKey() }
    }
  }

  private bidKey(): string {
    return this.bid ? `${this.bid.q}x${this.bid.f}@${this.bidSeat}` : ''
  }

  remoteSeats(v: number[]): void {
    if (this.ctx.isHost() && this.round > 0) return
    for (let i = 0; i < SEATS; i++) {
      this.occ[i] = v[i] ?? EMPTY
      this.dice[i] = unpackDice(v[SEATS + i] ?? 0)
    }
  }

  /** The host applies a player's move (anyone's, including its own). */
  private apply(slot: number, action: Act, a: number, b: number): void {
    const seat = this.occ.indexOf(slot)
    switch (action) {
      case Act.Sit:
        if (this.phase !== Phase.Idle || a < 0 || a >= SEATS || this.occ[a] !== EMPTY) return
        if (seat >= 0) this.occ[seat] = EMPTY
        this.occ[a] = slot
        break
      case Act.Leave:
        if (seat < 0) return
        // Mid-game, a sailor takes over your dice.
        this.occ[seat] = this.phase === Phase.Idle ? EMPTY : SAILOR
        break
      case Act.Sailors:
        if (this.phase !== Phase.Idle) return
        this.noSailors = !this.noSailors
        break
      case Act.Start:
        if (this.phase !== Phase.Idle || seat < 0) return
        this.startGame()
        break
      case Act.Bid: {
        const bid = { q: a, f: b }
        if (this.phase !== Phase.Bidding || seat !== this.turn || !isRaise(this.bid, bid) || a > this.totalDice) return
        this.placeBid(seat, bid)
        break
      }
      case Act.Liar:
        if (this.phase !== Phase.Bidding || seat !== this.turn || !this.bid) return
        this.callLiar(seat)
        break
      default:
        return
    }
    this.dirty = true
  }

  private startGame(): void {
    const humans = this.occ.filter((o) => o !== EMPTY && o !== SAILOR).length
    const want = this.noSailors && humans >= 2 ? humans : Math.max(humans, Math.min(SEATS, FILL_TO))
    for (let i = 0, n = humans; i < SEATS && n < want; i++) {
      if (this.occ[i] !== EMPTY) continue
      this.occ[i] = SAILOR
      n++
    }
    for (let i = 0; i < SEATS; i++) this.dice[i] = this.occ[i] === EMPTY ? [] : rollDice(START_DICE, Math.random)
    this.round = Math.max(this.round, 0) + 1
    const seated = this.occ.map((o, i) => (o === EMPTY ? -1 : i)).filter((i) => i >= 0)
    this.turn = seated[Math.floor(Math.random() * seated.length)]
    this.bid = null
    this.bidSeat = -1
    this.loser = -1
    this.winner = -1
    this.phase = Phase.Bidding
    this.timer = 0
  }

  private placeBid(seat: number, bid: Bid): void {
    this.bid = bid
    this.bidSeat = seat
    this.turn = nextSeat(this.counts, seat)
    this.timer = 0
  }

  private callLiar(seat: number): void {
    this.loser = bidStands(this.dice, this.bid!) ? seat : this.bidSeat
    this.turn = seat
    this.phase = Phase.Reveal
    this.timer = 0
  }

  /** The host: sailors play, slow players get a hand, cups come up and go down, winners are cheered. */
  private runHost(dt: number): void {
    // A crewmate who's gone: their chair empties (or, mid-game, a sailor takes their dice).
    for (let i = 0; i < SEATS; i++) {
      const o = this.occ[i]
      if (o === EMPTY || o === SAILOR || this.ctx.nameOf(o) !== null) continue
      this.occ[i] = this.phase === Phase.Idle ? EMPTY : SAILOR
      this.dirty = true
    }
    this.timer += dt
    if (this.phase === Phase.Bidding) {
      const o = this.occ[this.turn]
      const think = o === SAILOR ? THINK[0] + ((this.round * 7 + this.turn * 3 + (this.bid?.q ?? 0)) % 10) / 10 * (THINK[1] - THINK[0]) : TURN_SECONDS
      if (this.timer >= think) {
        const move = sailorMove(this.dice[this.turn], this.totalDice, this.bid, Math.random)
        if (move && move.q <= this.totalDice) this.placeBid(this.turn, move)
        else if (this.bid) this.callLiar(this.turn)
        else this.placeBid(this.turn, { q: 1, f: this.dice[this.turn][0] ?? 1 })
        this.dirty = true
      }
    } else if (this.phase === Phase.Reveal && this.timer >= REVEAL_SECONDS) {
      this.dice[this.loser].pop()
      const left = this.occ.map((_, i) => i).filter((i) => this.dice[i].length > 0)
      if (left.length <= 1) {
        this.winner = left[0] ?? -1
        this.phase = Phase.Over
      } else {
        for (const i of left) this.dice[i] = rollDice(this.dice[i].length, Math.random)
        this.turn = this.dice[this.loser].length > 0 ? this.loser : nextSeat(this.counts, this.loser)
        this.bid = null
        this.bidSeat = -1
        this.round++
        this.phase = Phase.Bidding
      }
      this.timer = 0
      this.dirty = true
    } else if (this.phase === Phase.Over && this.timer >= OVER_SECONDS) {
      // Back to the table: sailors go back to their duties, the crew keep their chairs.
      for (let i = 0; i < SEATS; i++) {
        if (this.occ[i] === SAILOR) this.occ[i] = EMPTY
        this.dice[i] = []
      }
      this.phase = Phase.Idle
      this.bid = null
      this.winner = -1
      this.loser = -1
      this.dirty = true
    }
    this.heartbeat -= dt
    if (!this.dirty && this.heartbeat > 0) return
    this.dirty = false
    this.heartbeat = 5
    this.onState(
      [this.phase + (this.noSailors ? 10 : 0), this.round, this.turn, this.bid?.q ?? 0, this.bid?.f ?? 0, this.bidSeat, this.loser, this.winner],
      [...this.occ, ...this.dice.map(packDice)],
    )
  }

  // ---- Every frame ---------------------------------------------------------------------------------

  update(dt: number, camera: THREE.Camera): void {
    if (this.ctx.isHost()) this.runHost(dt)
    this.react()
    this.sign.face(camera)
    const mine = this.mySeat
    // Getting ready to bid: start from the cheapest raise on what I've got most of.
    const key = `${this.round}|${this.bid?.q}|${this.bid?.f}`
    if (mine >= 0 && this.phase === Phase.Bidding && this.turn === mine && this.pickedFor !== key) {
      this.pickedFor = key
      const hand = this.dice[mine]
      const best = [1, 2, 3, 4, 5, 6].sort((a, b) => countFace([hand], b) - countFace([hand], a) || b - a)[0]
      this.pick = minRaise(this.bid, best)
    }
    for (const seat of this.seats) seat.update(dt, mine)
    this.drawBoard()
  }

  /** Sounds and words when the game moves on (the same on every device). */
  private react(): void {
    const at = this.root.localToWorld(new THREE.Vector3(0, TOP - DECK_Y, 0))
    const bidKey = this.bidKey()
    if (this.round !== this.seen.round && this.phase === Phase.Bidding) {
      // Cups slammed down on fresh dice.
      this.ctx.audio.play('thud', at, 0.9)
      this.ctx.audio.play('click', at, 0.6)
      if (this.mySeat >= 0 && this.turn === this.mySeat) this.ctx.say("Liar's Dice: you open the bidding.", 3)
    }
    if (bidKey && bidKey !== this.seen.bidKey && this.phase === Phase.Bidding) {
      this.ctx.audio.play('click', at, 0.5)
      if (this.mySeat >= 0 && this.turn === this.mySeat) this.ctx.say(`${this.nameAt(this.bidSeat)} bids ${this.bidText(this.bid!)}. Your turn: raise it, or call LIAR!`, 4)
    }
    if (this.phase !== this.seen.phase) {
      if (this.phase === Phase.Reveal && this.bid) {
        const count = countFace(this.dice, this.bid.f)
        this.ctx.audio.play('whistle', at, 0.6)
        this.ctx.say(`LIAR! There ${count === 1 ? 'is' : 'are'} ${count} ${FACE_NAMES[this.bid.f]}: ${this.loses(this.loser)} a die.`, 5)
      }
      if (this.phase === Phase.Over && this.winner >= 0) {
        for (let i = 0; i < 4; i++) this.ctx.confetti.emit({ position: at.clone().setY(at.y + 0.6), velocity: new THREE.Vector3(0, 2.5, 0), spread: 1.8, color: [0xffd35a, 0xd8412f, 0x2f7fd8, 0x3cb371][i], size: 0.045, life: 1.6, count: 25 })
        this.ctx.audio.play('whistle', at, 0.9)
        this.ctx.say(this.winner === this.mySeat ? "You win at Liar's Dice! The table's yours, captain." : `${this.nameAt(this.winner)} wins at Liar's Dice!`, 5)
      }
    }
    this.seen = { round: this.round, phase: this.phase, bidKey }
  }

  /** "Pete loses", or "You lose". */
  private loses(seat: number): string {
    return seat === this.mySeat ? 'You lose' : `${this.nameAt(seat)} loses`
  }

  bidText(bid: Bid): string {
    return `${bid.q} ${bid.q === 1 ? FACE_NAMES[bid.f].slice(0, -1) : FACE_NAMES[bid.f]}`
  }

  // ---- My bid (the buttons on my panel) -------------------------------------------------------------

  get myPick(): Bid {
    return this.pick
  }

  adjust(dq: number): void {
    this.pick = { q: THREE.MathUtils.clamp(this.pick.q + dq, 1, Math.max(1, this.totalDice)), f: this.pick.f }
  }

  choose(f: number): void {
    this.pick = { q: this.pick.q, f }
    // Keep it a legal raise if it can be one.
    if (!isRaise(this.bid, this.pick)) this.pick = minRaise(this.bid, f)
  }

  placeMine(): void {
    if (!isRaise(this.bid, this.pick)) {
      this.ctx.say(`You have to beat ${this.bidText(this.bid!)}: more dice, or as many of a higher face.`, 3)
      return
    }
    this.act(Act.Bid, this.pick.q, this.pick.f)
  }

  callMine(): void {
    if (!this.bid) {
      this.ctx.say('Nobody has bid yet: you open, so make a bid.', 3)
      return
    }
    this.act(Act.Liar)
  }

  // ---- The board over the table --------------------------------------------------------------------

  private drawBoard(): void {
    let title = "LIAR'S DICE"
    let line1 = 'Take a seat!'
    let line2 = this.occ.some((o) => o !== EMPTY) ? 'Then press Start' : ''
    const turnName = this.nameAt(this.turn)
    if (this.phase === Phase.Bidding) {
      title = this.bid ? `Bid: ${this.bidText(this.bid)}` : 'Opening bid...'
      line1 = this.bid ? `by ${this.nameAt(this.bidSeat)}` : ''
      line2 = this.turn === this.mySeat ? 'Your turn!' : `${turnName} to play`
    } else if (this.phase === Phase.Reveal && this.bid) {
      const count = countFace(this.dice, this.bid.f)
      title = `LIAR! ${count} ${FACE_NAMES[this.bid.f]}`
      line1 = `Bid was ${this.bidText(this.bid)}`
      line2 = `${this.loses(this.loser)} a die`
    } else if (this.phase === Phase.Over) {
      title = this.winner === this.mySeat ? 'You win!' : `${this.nameAt(this.winner)} wins!`
      line1 = 'Well bluffed.'
      line2 = ''
    }
    const counts = this.counts.map((n, i) => (this.occ[i] === EMPTY ? '' : `${n}`)).join(',')
    const key = `${title}|${line1}|${line2}|${counts}`
    if (key === this.boardKey) return
    this.boardKey = key
    const c = this.board.getContext('2d')!
    c.fillStyle = '#2b2f2c'
    c.fillRect(0, 0, 512, 256)
    c.strokeStyle = '#8a5a2b'
    c.lineWidth = 14
    c.strokeRect(7, 7, 498, 242)
    c.textAlign = 'center'
    c.fillStyle = '#f2b64a'
    c.font = 'bold 46px Georgia, serif'
    c.fillText(title, 256, 70, 480)
    c.fillStyle = '#efeee6'
    c.font = '32px Georgia, serif'
    c.fillText(line1, 256, 120, 480)
    c.fillStyle = '#ffd166'
    c.font = 'bold 32px Georgia, serif'
    c.fillText(line2, 256, 165, 480)
    // Dice left, seat by seat, in the seats' colours.
    c.font = 'bold 30px Georgia, serif'
    for (let i = 0; i < SEATS; i++) {
      if (this.occ[i] === EMPTY) continue
      c.fillStyle = SEAT_COLORS[i]
      c.fillText(`${'■'.repeat(this.dice[i].length) || '✗'}`, 70 + i * 124, 222, 115)
    }
    this.boardTexture.needsUpdate = true
  }
}

/** One chair at the table: stool, cup and dice, a sailor (sometimes), and the player's panel. */
class Seat {
  readonly group = new THREE.Group()
  private readonly cup: THREE.Mesh
  private readonly dice: THREE.Mesh[] = []
  private readonly sailor: Avatar
  private readonly panel = new THREE.Group()
  private readonly display = document.createElement('canvas')
  private readonly displayTexture: THREE.CanvasTexture
  private readonly marker: THREE.Mesh
  private displayKey = ''
  private diceKey = ''
  private lift = 0
  private readonly buttons: Record<string, THREE.Mesh> = {}
  private readonly faces: THREE.Mesh[] = []

  constructor(
    private readonly index: number,
    materials: THREE.Material[],
    private readonly game: LiarsDice,
  ) {
    // Seat 0 toward the stern, then round: starboard, bow, port.
    this.group.rotation.y = (index * Math.PI) / 2
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.85 })
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.5, 12), wood)
    stool.position.set(0, 0.25, SEAT_R)
    // A painted band in the seat's colour, so you can tell the chairs apart on the board.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.06, 12), new THREE.MeshStandardMaterial({ color: SEAT_COLORS[index], roughness: 0.6 }))
    band.position.set(0, 0.44, SEAT_R)
    this.group.add(stool, band)

    this.cup = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.115, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x5b3418, roughness: 0.9, side: THREE.DoubleSide }))
    const lid = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16).rotateX(-Math.PI / 2), this.cup.material)
    lid.position.y = 0.0575
    this.cup.add(lid)
    this.group.add(this.cup)
    for (let i = 0; i < START_DICE; i++) {
      const die = new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE, DIE), materials)
      const a = (i / START_DICE) * Math.PI * 2
      die.position.set(Math.sin(a) * 0.036, TOP - DECK_Y + DIE / 2, CUP_R + Math.cos(a) * 0.036)
      this.group.add(die)
      this.dice.push(die)
    }

    this.sailor = new Avatar(SAILOR_COLORS[index])
    this.sailor.setInfo({ sessionId: `sailor${index}`, name: SAILOR_NAMES[index], color: SAILOR_COLORS[index], connected: true })
    this.sailor.group.visible = false
    this.group.add(this.sailor.group)

    // The panel at the table's edge, leaning back toward whoever sits here.
    this.panel.position.set(0, TOP - DECK_Y + 0.13, TABLE_RADIUS - 0.02)
    this.panel.rotation.x = -0.55
    this.group.add(this.panel)
    this.display.width = 512
    this.display.height = 128
    this.displayTexture = new THREE.CanvasTexture(this.display)
    this.displayTexture.colorSpace = THREE.SRGBColorSpace
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.125), new THREE.MeshBasicMaterial({ map: this.displayTexture, fog: false }))
    screen.position.y = 0.08
    this.panel.add(screen)
    const button = (name: string, text: string, w: number, x: number, y: number, bg: string, onClick: () => void) => {
      const mesh = makeButton(text, w, 0.048, bg, '#ffffff')
      mesh.position.set(x, y, 0.004)
      this.panel.add(mesh)
      clickables.add({ mesh, onClick })
      this.buttons[name] = mesh
    }
    const green = 'rgba(40, 120, 70, 0.95)'
    const blue = 'rgba(30, 90, 140, 0.95)'
    const red = 'rgba(170, 40, 30, 0.95)'
    const grey = 'rgba(80, 80, 80, 0.95)'
    button('sit', 'Sit here', 0.2, 0, -0.01, green, () => this.game.act(Act.Sit, this.index))
    button('start', 'Start', 0.14, -0.16, -0.01, green, () => this.game.act(Act.Start))
    button('sailors', 'Sailors', 0.14, 0, -0.01, blue, () => this.game.act(Act.Sailors))
    button('leave', 'Leave', 0.14, 0.16, -0.01, grey, () => this.game.act(Act.Leave))
    button('less', '−', 0.06, -0.2, -0.075, grey, () => this.game.adjust(-1))
    button('more', '+', 0.06, -0.13, -0.075, grey, () => this.game.adjust(1))
    button('bid', 'BID', 0.13, 0.02, -0.075, green, () => this.game.placeMine())
    button('liar', 'LIAR!', 0.13, 0.175, -0.075, red, () => this.game.callMine())
    for (let f = 1; f <= 6; f++) {
      const mesh = dieButton(f)
      mesh.position.set(-0.2 + (f - 1) * 0.08, -0.01, 0.004)
      this.panel.add(mesh)
      clickables.add({ mesh, onClick: () => this.game.choose(f) })
      this.faces.push(mesh)
    }
    // A gold bar under the face I've picked.
    this.marker = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.008), new THREE.MeshBasicMaterial({ color: 0xffc83d, fog: false }))
    this.marker.position.set(0, -0.042, 0.004)
    this.panel.add(this.marker)
  }

  update(dt: number, mine: number): void {
    const g = this.game
    const o = g.occ[this.index]
    const isMine = this.index === mine
    const playing = g.phase !== Phase.Idle && o !== EMPTY
    const myTurn = isMine && g.phase === Phase.Bidding && g.turn === this.index

    // Buttons: sit in an empty chair (before a game); in yours, start, send the sailors off, or leave;
    // on your turn, pick a face and how many, then bid, or call liar.
    const show = (name: string, on: boolean) => (this.buttons[name].visible = on)
    show('sit', g.phase === Phase.Idle && o === EMPTY)
    show('start', isMine && g.phase === Phase.Idle)
    show('sailors', isMine && g.phase === Phase.Idle)
    show('leave', isMine && g.phase !== Phase.Over)
    if (isMine && g.phase === Phase.Bidding) this.buttons.leave.position.set(0.2, 0.17, 0.004)
    else this.buttons.leave.position.set(0.16, -0.01, 0.004)
    for (const name of ['less', 'more', 'bid', 'liar']) show(name, myTurn)
    for (const f of this.faces) f.visible = myTurn
    this.marker.visible = myTurn
    if (myTurn) this.marker.position.x = -0.2 + (g.myPick.f - 1) * 0.08
    this.panel.visible = o === EMPTY ? g.phase === Phase.Idle : true

    // The cup: down over the dice; tipped back for its owner to peek; up for everyone at "Liar!".
    const reveal = g.phase === Phase.Reveal
    const lift = reveal ? 1 : isMine && g.phase === Phase.Bidding ? 0.6 : 0
    this.lift += (lift - this.lift) * Math.min(1, dt * 8)
    this.cup.visible = playing || g.phase === Phase.Idle
    this.cup.position.set(0, TOP - DECK_Y + 0.0575 + this.lift * 0.17, CUP_R - this.lift * 0.09)
    this.cup.rotation.x = -this.lift * 0.9
    // Dice: only mine while bidding, everyone's once the cups come up.
    const hand = g.dice[this.index]
    const shown = playing && (reveal || (isMine && g.phase === Phase.Bidding))
    const diceKey = `${hand.join('')}|${shown}|${reveal ? g.bid?.f : 0}|${g.round}`
    if (diceKey !== this.diceKey) {
      this.diceKey = diceKey
      this.dice.forEach((die, i) => {
        die.visible = shown && i < hand.length
        if (i >= hand.length) return
        const yaw = ((g.round * 13 + this.index * 7 + i * 5) % 12) * 0.52
        faceUp(die, hand[i], yaw)
        // At the reveal, the dice that count stand out.
        const counts = reveal && g.bid && hand[i] === g.bid.f
        die.scale.setScalar(counts ? 1.35 : 1)
        die.position.y = TOP - DECK_Y + (DIE * die.scale.y) / 2 + (counts ? 0.004 : 0)
      })
    }

    // A sailor sits here: sat on the stool, hands on the table.
    this.sailor.group.visible = o === SAILOR
    if (o === SAILOR) this.poseSailor(performance.now() / 1000)
    this.drawDisplay(isMine, myTurn)
  }

  private poseSailor(now: number): void {
    const sway = Math.sin(now * 1.3 + this.index) * 0.03
    const think = this.game.phase === Phase.Bidding && this.game.turn === this.index
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(think ? -0.35 : -0.2, sway, 0, 'YXZ'))
    const pose = new Array(21).fill(0) as number[]
    pose[0] = sway
    pose[1] = 1.22 + (think ? -0.04 : 0)
    pose[2] = SEAT_R - 0.05
    q.toArray(pose, 3)
    const lift = think ? 0.06 + Math.abs(Math.sin(now * 5)) * 0.04 : 0
    ;[-0.2, 0.2].forEach((x, i) => {
      pose[7 + i * 7] = x
      pose[8 + i * 7] = TOP - DECK_Y + 0.04 + (i === 1 ? lift : 0)
      pose[9 + i * 7] = TABLE_RADIUS - 0.08
      q.toArray(pose, 10 + i * 7)
    })
    this.sailor.apply(pose as never)
    this.sailor.water = false
    this.sailor.poseBody()
  }

  private drawDisplay(isMine: boolean, myTurn: boolean): void {
    const g = this.game
    const o = g.occ[this.index]
    const name = o === EMPTY ? 'Empty chair' : g.nameAt(this.index)
    let status = ''
    if (g.phase === Phase.Idle) status = o === EMPTY ? '' : isMine ? 'Start when everyone\'s sat down' + (g.noSailors ? ' (no sailors)' : '') : 'Ready'
    else if (myTurn) status = `Bid ${g.bidText(g.myPick)}?`
    else if (g.phase === Phase.Bidding && g.turn === this.index) status = 'Thinking...'
    else if (o !== EMPTY && g.dice[this.index].length === 0) status = 'Out'
    const key = `${name}|${status}|${g.dice[this.index].length}|${myTurn}`
    if (key === this.displayKey) return
    this.displayKey = key
    const c = this.display.getContext('2d')!
    c.clearRect(0, 0, 512, 128)
    c.fillStyle = 'rgba(20, 16, 12, 0.85)'
    c.beginPath()
    c.roundRect(2, 2, 508, 124, 18)
    c.fill()
    c.strokeStyle = SEAT_COLORS[this.index]
    c.lineWidth = 5
    c.stroke()
    c.textAlign = 'left'
    c.fillStyle = SEAT_COLORS[this.index]
    c.font = 'bold 36px Georgia, serif'
    c.fillText(name, 20, 48, 340)
    if (o !== EMPTY && g.phase !== Phase.Idle) {
      c.textAlign = 'right'
      c.fillStyle = '#efeee6'
      c.fillText(`${g.dice[this.index].length} ${g.dice[this.index].length === 1 ? 'die' : 'dice'}`, 492, 48)
    }
    c.textAlign = 'left'
    c.fillStyle = myTurn ? '#ffd166' : '#d8d4c8'
    c.font = `${myTurn ? 'bold ' : ''}32px Georgia, serif`
    c.fillText(status, 20, 100, 472)
    this.displayTexture.needsUpdate = true
  }
}

/** Turn a die so `face` is up, then spin it about the vertical. Faces: +x 3, -x 4, +y 1, -y 6, +z 2, -z 5. */
function faceUp(die: THREE.Object3D, face: number, yaw: number): void {
  const [x, z] = [
    [0, 0],
    [0, 0],
    [-Math.PI / 2, 0],
    [0, Math.PI / 2],
    [0, -Math.PI / 2],
    [Math.PI / 2, 0],
    [Math.PI, 0],
  ][face]
  die.rotation.set(x, yaw, z, 'YXZ')
}

/** Pips on a square, for a face of a die. */
function drawPips(c: CanvasRenderingContext2D, size: number, face: number, bg: string, pip: string): void {
  c.fillStyle = bg
  c.beginPath()
  c.roundRect(2, 2, size - 4, size - 4, size * 0.16)
  c.fill()
  c.fillStyle = pip
  const at = (u: number, v: number) => {
    c.beginPath()
    c.arc(u * size, v * size, size * 0.09, 0, Math.PI * 2)
    c.fill()
  }
  const L = 0.27
  const M = 0.5
  const R = 0.73
  const spots: Record<number, [number, number][]> = {
    1: [[M, M]],
    2: [[L, L], [R, R]],
    3: [[L, L], [M, M], [R, R]],
    4: [[L, L], [R, L], [L, R], [R, R]],
    5: [[L, L], [R, L], [M, M], [L, R], [R, R]],
    6: [[L, L], [R, L], [L, M], [R, M], [L, R], [R, R]],
  }
  for (const [u, v] of spots[face]) at(u, v)
}

/** Bone-white dice with black pips (one-pip red), in BoxGeometry face order. */
function dieMaterials(): THREE.Material[] {
  return [3, 4, 1, 6, 2, 5].map((face) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const c = canvas.getContext('2d')!
    c.fillStyle = '#e9e1cc'
    c.fillRect(0, 0, 64, 64)
    drawPips(c, 64, face, '#f3ecd9', face === 1 ? '#b02020' : '#1a1a1a')
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 })
  })
}

/** A die face you can point at and click. */
function dieButton(face: number): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 96
  drawPips(canvas.getContext('2d')!, 96, face, '#f3ecd9', face === 1 ? '#b02020' : '#1a1a1a')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.056), new THREE.MeshBasicMaterial({ map: texture, transparent: true, fog: false }))
  mesh.renderOrder = 20
  return mesh
}
