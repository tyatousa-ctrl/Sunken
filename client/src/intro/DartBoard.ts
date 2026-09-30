import * as THREE from 'three'
import type { HeldAdapter, HeldSyncable } from '../net/HeldSync'
import type { AudioSystem } from '../audio/AudioSystem'
import type { Particles } from '../fx/Particles'
import type { Hand } from '../input/Hand'
import type { GrabSystem, Interactable } from '../interaction/GrabSystem'
import { Label, type LabelLine } from '../ui/Label'
import { CABIN_FRONT_Z, DECK_Y, type Galleon } from '../world/ship/Galleon'
import { DartsGame, MODE_NAMES, type DartsMode } from './darts/DartsGame'
import { MISS, RADII, SEGMENTS, scoreAt, type DartScore } from './darts/scoring'

/** Board centre, ship-local: on the cabin wall, port of the door, at regulation height (1.73 m). */
export const BOARD_POSITION = new THREE.Vector3(-1.3, DECK_Y + 1.73, CABIN_FRONT_Z - 0.03)
/** Regulation oche distance from the board face. */
export const THROW_DISTANCE = 2.37
const RACK_POSITION = new THREE.Vector3(-2.35, DECK_Y, BOARD_POSITION.z - THROW_DISTANCE - 0.1)
const GRAVITY = 9.8
/** VR throws tend to feel weak without a small boost. */
const THROW_BOOST = 1.15
const DESKTOP_THROW_SPEED = 7
/** Sight-aimed throws fly at the throw's speed, kept within these (m/s). */
const AIMED_MIN_SPEED = 6.5
const AIMED_MAX_SPEED = 11
/** Everyone's aim wobbles a little (degrees), so it's still a game. */
const BASE_SCATTER = 0.7
/** The aiming dot shows when you're this close to the board. */
const AIM_RANGE = 4.5
const RETURN_DELAY = 1.6
const MODES: DartsMode[] = ['301', '501', 'clock']

export interface DartsContext {
  audio: AudioSystem
  debris: Particles
  /** Deck height under a world point, or null over the water. */
  ground: (x: number, z: number) => number | null
  /** Extra random spread on throws, in degrees (grows with drink). */
  scatter: () => number
  onBullseye: () => void
}

type DartState = 'rack' | 'held' | 'flying' | 'stuck' | 'falling' | 'down'

// The dart board on the cabin wall: the board, a slate scoreboard, a throw line, a rack with three
// darts per player colour, and two buttons (game mode, double-out) you press with a hand.
export class DartBoardArea {
  readonly game: DartsGame
  readonly board = new THREE.Group()
  readonly darts: Dart[] = []
  private readonly slateCanvas = document.createElement('canvas')
  private readonly slateTexture: THREE.CanvasTexture
  private readonly slate: THREE.Mesh
  private readonly buttons: { mesh: THREE.Mesh; action: () => void }[] = []
  private buttonCooldown = 0
  private returnTimer = 0
  interrupted = false
  private slateBreakTimer = -1
  private boardFall: THREE.Vector3 | null = null
  private readonly v = new THREE.Vector3()
  /** How-to sign over the rack; the step you're on lights up. */
  private readonly sign = new Label({ width: 0.8, canvasWidth: 640, canvasHeight: 440, billboard: true })
  private readonly rackObject = new THREE.Group()
  /** Red aiming light on the board: where a held dart will land. */
  private readonly aimDot: THREE.Mesh
  /** The viewer's eye (set every frame), for sight-line aiming. */
  camera: THREE.Camera | null = null
  private readonly v2a = new THREE.Vector2()
  private readonly v2b = new THREE.Vector2()

  constructor(
    readonly root: THREE.Group,
    ship: Galleon,
    grab: GrabSystem,
    players: { name: string; color: string }[],
    private readonly ctx: DartsContext,
  ) {
    this.game = new DartsGame(players)

    // Board faces the deck (local +z is the face; the wall is behind it).
    this.board.position.copy(BOARD_POSITION)
    this.board.rotation.y = Math.PI
    const face = new THREE.Mesh(new THREE.CircleGeometry(RADII.board, 48), new THREE.MeshStandardMaterial({ map: makeBoardTexture(), roughness: 0.9 }))
    face.position.z = 0.02
    const back = new THREE.Mesh(new THREE.CylinderGeometry(RADII.board + 0.01, RADII.board + 0.01, 0.04, 40), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 }))
    back.rotation.x = Math.PI / 2
    this.board.add(back, face)
    ship.shake.add(this.board)
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.45, depthWrite: false, fog: false }))
    this.aimDot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), new THREE.MeshBasicMaterial({ color: 0xff2a1f, depthWrite: false, fog: false }))
    this.aimDot.add(glow)
    glow.position.z = -0.001
    this.aimDot.visible = false
    this.aimDot.renderOrder = 20
    this.board.add(this.aimDot)

    // Slate scoreboard beside the board.
    this.slateCanvas.width = 512
    this.slateCanvas.height = 400
    this.slateTexture = new THREE.CanvasTexture(this.slateCanvas)
    this.slateTexture.colorSpace = THREE.SRGBColorSpace
    this.slate = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.55), new THREE.MeshStandardMaterial({ map: this.slateTexture, roughness: 1 }))
    this.slate.position.set(BOARD_POSITION.x - 1.05, DECK_Y + 1.6, CABIN_FRONT_Z - 0.02)
    this.slate.rotation.y = Math.PI
    ship.shake.add(this.slate)

    // Two round buttons under the slate: mode and double-out.
    const buttonMaterial = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
    const modeButton = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16), buttonMaterial(0x2f5e9e))
    const doubleButton = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16), buttonMaterial(0xc8322b))
    for (const [mesh, dx] of [[modeButton, -0.15], [doubleButton, 0.15]] as const) {
      mesh.rotation.x = Math.PI / 2
      mesh.position.set(this.slate.position.x + dx, DECK_Y + 1.22, CABIN_FRONT_Z - 0.03)
      ship.shake.add(mesh)
    }
    this.buttons.push(
      { mesh: modeButton, action: () => this.cycleMode() },
      { mesh: doubleButton, action: () => this.toggleDoubleOut() },
    )

    // Throw line (oche) painted on the deck.
    const oche = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.005, 0.04), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 1 }))
    oche.position.set(BOARD_POSITION.x, DECK_Y + 0.003, BOARD_POSITION.z - THROW_DISTANCE)
    ship.shake.add(oche)

    // Rack: a post with a tray; each player colour gets three darts.
    const rack = this.rackObject
    rack.position.copy(RACK_POSITION)
    this.sign.mesh.position.set(0, 1.75, 0)
    rack.add(this.sign.mesh)
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.85 })
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), wood)
    post.position.y = 0.5
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.14), wood)
    tray.position.y = 1.0
    rack.add(post, tray)
    ship.shake.add(rack)
    players.forEach((player, p) => {
      for (let i = 0; i < 3; i++) {
        const slot = new THREE.Vector3(-0.1 + i * 0.1, 1.03, -0.03 + p * 0.03)
        const dart = new Dart(rack, slot, player.color, this)
        this.darts.push(grab.add(dart))
      }
    })
    this.drawSlate()
  }

  get audio(): AudioSystem {
    return this.ctx.audio
  }

  scatter(): number {
    return this.ctx.scatter()
  }

  ground(x: number, z: number): number | null {
    return this.ctx.ground(x, z)
  }

  /** A dart finished: stuck in the board, or missed (wall, deck, overboard). */
  scoreDart(score: DartScore, thrower: Hand | null): void {
    if (this.interrupted) return
    if (score.points === 50) this.ctx.onBullseye()
    thrower?.pulse(score.points > 0 ? 0.6 : 0.2, 50)
    const result = this.game.throw(score)
    this.drawSlate()
    if (result.turnOver) this.returnTimer = RETURN_DELAY
    if (result.won) this.returnTimer = 4
  }

  /** Blacked-out player loses their turn. */
  skipTurn(): void {
    if (this.interrupted) return
    this.game.skipTurn()
    this.returnTimer = RETURN_DELAY
    this.drawSlate()
  }

  /** First cannonball: darts fall, the board drops off the wall, the slate shows final scores, then breaks. */
  interrupt(): void {
    if (this.interrupted) return
    this.interrupted = true
    this.game.message = 'Final scores'
    this.drawSlate()
    this.slateBreakTimer = 2
    for (const d of this.darts) d.knockDown()
    this.root.attach(this.board)
    this.boardFall = new THREE.Vector3(0, 0, 0)
  }

  /**
   * Where a dart at `from` is aimed: the line from your eye through the dart, onto the board or the
   * wall around it (board-local x, y), or null when it isn't pointed at the wall.
   */
  aimAt(from: THREE.Vector3, target: THREE.Vector2): boolean {
    if (!this.camera || this.interrupted) return false
    const eye = this.camera.getWorldPosition(new THREE.Vector3())
    this.board.updateMatrixWorld()
    const a = this.board.worldToLocal(eye.clone())
    if (a.z > AIM_RANGE || a.z < 0.3) return false
    // Where the dart lines up from your eye...
    const b = this.board.worldToLocal(from.clone())
    const sight = hitBoard(a, b, this.v2a)
    // ...and where you're looking. Half of each: steady enough to aim, but your hand still steers it.
    const gazeEnd = eye.add(this.camera.getWorldDirection(new THREE.Vector3()))
    const gaze = hitBoard(a, this.board.worldToLocal(gazeEnd), this.v2b)
    if (!sight || !gaze) return false
    target.copy(sight).lerp(gaze, 0.5)
    return Math.abs(target.x) < 1.5 && target.y > -1.4 && target.y < 0.8
  }

  /** Show or hide the aiming light (board-local point). It glides a little so it doesn't jitter. */
  showAim(point: THREE.Vector2 | null): void {
    const wasVisible = this.aimDot.visible
    this.aimDot.visible = point !== null
    if (!point) return
    if (!wasVisible) this.aimDot.position.set(point.x, point.y, 0.03)
    else this.aimDot.position.lerp(this.v.set(point.x, point.y, 0.03), 0.35)
    // Throws go where the dot is.
    point.set(this.aimDot.position.x, this.aimDot.position.y)
  }

  update(dt: number, hands: Hand[], camera?: THREE.Camera): void {
    if (camera) {
      this.camera = camera
      this.updateSign(camera)
    }
    if (!this.darts.some((d) => d.state === 'held')) this.showAim(null)
    this.buttonCooldown = Math.max(0, this.buttonCooldown - dt)
    if (!this.interrupted) {
      for (const b of this.buttons) {
        if (this.buttonCooldown > 0) break
        b.mesh.getWorldPosition(this.v)
        const hand = hands.find((h) => h.connected && !h.held && h.worldPos(new THREE.Vector3()).distanceTo(this.v) < 0.08)
        if (hand) {
          hand.pulse(0.4, 30)
          this.ctx.audio.play('click', this.v)
          this.buttonCooldown = 0.8
          b.action()
        }
      }
      if (this.returnTimer > 0) {
        this.returnTimer -= dt
        if (this.returnTimer <= 0) {
          if (this.game.winner) this.game.reset()
          for (const d of this.darts) d.returnToRack()
          this.drawSlate()
        }
      }
    }
    if (this.slateBreakTimer > 0) {
      this.slateBreakTimer -= dt
      if (this.slateBreakTimer <= 0) {
        this.slate.getWorldPosition(this.v)
        this.slate.visible = false
        this.ctx.debris.emit({ position: this.v, spread: 3, color: 0x2b2f2c, size: 0.08, life: 1.5, count: 30 })
        this.ctx.audio.play('crack', this.v)
      }
    }
    if (this.boardFall) this.updateBoardFall(dt)
  }

  private updateSign(camera: THREE.Camera): void {
    this.sign.visible = !this.interrupted
    if (this.interrupted) return
    const holding = this.darts.some((d) => d.state === 'held')
    // Behind the line = your head is on the far side of the oche from the board (ship-local z).
    const head = this.rackObject.parent!.worldToLocal(camera.getWorldPosition(this.v))
    const atLine = head.z < BOARD_POSITION.z - THROW_DISTANCE + 0.25 && Math.abs(head.x - BOARD_POSITION.x) < 1.2
    const step = !holding ? 0 : atLine ? 2 : 1
    const line = (i: number, text: string): LabelLine =>
      i === step ? { text: `▶ ${text}`, color: '#ffd27a', size: 29, bold: true } : { text, size: 26, color: '#d9e2e6' }
    this.sign.set([
      { text: 'Darts', size: 44, bold: true, color: '#f2b64a' },
      line(0, '1. Grip a dart (or point at one and grip)'),
      line(1, '2. Stand behind the white line'),
      line(2, '3. Raise the dart in front of your eye: the red dot shows where it will land. Let go of grip (or pull the trigger) to throw'),
      { text: 'Blue button: game  ·  Red button: double out (touch them)', size: 22, color: '#9fb2bb' },
    ])
    this.sign.face(camera)
  }

  private updateBoardFall(dt: number): void {
    const fall = this.boardFall!
    fall.y -= GRAVITY * dt
    this.board.position.addScaledVector(fall, dt)
    this.board.rotation.x += dt * 2
    const floor = this.ctx.ground(this.board.position.x, this.board.position.z)
    if (floor !== null && this.board.position.y < floor + 0.05) {
      this.board.position.y = floor + 0.05
      this.board.rotation.set(-Math.PI / 2, 0, 0.3)
      this.boardFall = null
      this.ctx.audio.play('thud', this.board.position)
    } else if (this.board.position.y < -5) {
      this.boardFall = null
    }
  }

  private cycleMode(): void {
    const next = MODES[(MODES.indexOf(this.game.mode) + 1) % MODES.length]
    this.game.reset(next)
    for (const d of this.darts) d.returnToRack()
    this.drawSlate()
  }

  private toggleDoubleOut(): void {
    this.game.reset(this.game.mode, !this.game.doubleOut)
    for (const d of this.darts) d.returnToRack()
    this.drawSlate()
  }

  private drawSlate(): void {
    const ctx = this.slateCanvas.getContext('2d')!
    const g = this.game
    ctx.fillStyle = '#2b2f2c'
    ctx.fillRect(0, 0, 512, 400)
    ctx.strokeStyle = '#8a5a2b'
    ctx.lineWidth = 16
    ctx.strokeRect(8, 8, 496, 384)
    ctx.fillStyle = '#efeee6'
    ctx.textAlign = 'center'
    ctx.font = 'bold 40px Georgia, serif'
    ctx.fillText(`Darts: ${MODE_NAMES[g.mode]}`, 256, 60)
    ctx.font = '22px Georgia, serif'
    ctx.fillStyle = '#c9c8bd'
    ctx.fillText(g.mode === 'clock' ? 'Hit 1 to 20 in order, then the bull' : `Double out: ${g.doubleOut ? 'on' : 'off'}`, 256, 92)
    g.players.forEach((p, i) => {
      const y = 150 + i * 56
      ctx.textAlign = 'left'
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(46, y - 10, 12, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#efeee6'
      ctx.font = `${i === g.current && !g.winner ? 'bold ' : ''}32px Georgia, serif`
      ctx.fillText(`${i === g.current && !g.winner ? '▸ ' : ''}${p.name}`, 66, y)
      ctx.textAlign = 'right'
      ctx.fillText(g.mode === 'clock' ? (p.target > 25 ? 'done' : p.target === 25 ? 'bull' : `→ ${p.target}`) : String(p.remaining), 330, y)
      ctx.font = '24px Georgia, serif'
      ctx.fillStyle = '#c9c8bd'
      ctx.fillText(p.lastDarts.slice(-3).join('  '), 488, y)
    })
    ctx.textAlign = 'center'
    ctx.font = 'bold 30px Georgia, serif'
    ctx.fillStyle = '#ffd166'
    if (g.message) ctx.fillText(g.message, 256, 330)
    ctx.font = '18px Georgia, serif'
    ctx.fillStyle = '#9e9d93'
    ctx.fillText('blue button: game mode  ·  red button: double out', 256, 372)
    this.slateTexture.needsUpdate = true
  }
}

/** Where a line through a and b (board-local) crosses the board face, or null if it points away. */
function hitBoard(a: THREE.Vector3, b: THREE.Vector3, target: THREE.Vector2): THREE.Vector2 | null {
  const dz = b.z - a.z
  if (dz > -0.01) return null
  const t = (0.03 - a.z) / dz
  return target.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}

export class Dart implements Interactable, HeldSyncable {
  readonly object = new THREE.Group()
  state: DartState = 'rack'
  private readonly velocity = new THREE.Vector3()
  private readonly materials: THREE.MeshStandardMaterial[] = []
  private readonly rack: THREE.Object3D
  private readonly slot: THREE.Vector3
  private thrower: Hand | null = null
  private holder: Hand | null = null
  /** Fastest the hand moved in the last moments of holding (m/s): the throw's strength. */
  private peakSpeed = 0
  private peakAge = 0
  private aimed = false
  private readonly aim = new THREE.Vector2()
  private scored = false
  private downTimer = 0
  private readonly prevLocal = new THREE.Vector3()
  private readonly local = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  private readonly forward = new THREE.Vector3(0, 0, -1)
  private readonly v = new THREE.Vector3()

  constructor(
    rack: THREE.Object3D,
    slot: THREE.Vector3,
    color: string,
    private readonly area: DartBoardArea,
  ) {
    const brass = new THREE.MeshStandardMaterial({ color: 0xc59a3c, roughness: 0.3, metalness: 0.8 })
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.25, metalness: 0.9 })
    const flight = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide })
    this.materials.push(brass, flight)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.003, 0.035, 6), steel)
    tip.rotation.x = -Math.PI / 2
    tip.position.z = -0.075
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8), brass)
    barrel.rotation.x = Math.PI / 2
    barrel.position.z = -0.035
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.045, 6), steel)
    shaft.rotation.x = Math.PI / 2
    shaft.position.z = 0.012
    this.object.add(tip, barrel, shaft)
    for (const angle of [0, Math.PI / 2]) {
      const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.035), flight)
      fin.position.z = 0.045
      fin.rotation.set(-Math.PI / 2, 0, angle)
      this.object.add(fin)
    }
    this.rack = rack
    this.slot = slot
    this.returnToRack()
  }

  takenElsewhere = false

  /** In a crewmate's hand: this dart (and gone from where it was here). */
  heldAdapter(): HeldAdapter {
    return {
      heldBy: () => this.holder,
      shown: () => this.object,
      taken: (on) => {
        this.takenElsewhere = on
        this.object.visible = !on
      },
    }
  }

  grabGap(point: THREE.Vector3): number {
    if (this.state !== 'rack' && this.state !== 'down' && this.state !== 'stuck') return Infinity
    return point.distanceTo(this.object.getWorldPosition(this.v)) - 0.05
  }

  grab(hand: Hand): void {
    this.state = 'held'
    this.holder = hand
    this.peakSpeed = 0
    hand.ray.add(this.object)
    this.object.position.set(0, 0, -0.02)
    this.object.quaternion.identity()
    hand.pulse(0.15, 15)
  }

  /** Held: point away from your eye, light up the aim, and throw on the trigger. */
  private hold(dt: number): void {
    const hand = this.holder
    if (!hand) return
    // Remember the fastest recent hand speed (a flick's peak comes just before the release).
    this.peakAge += dt
    const speed = hand.localVel.length()
    if (speed >= this.peakSpeed || this.peakAge > 0.25) {
      this.peakSpeed = speed
      this.peakAge = 0
    }
    if (hand.virtual) return
    const from = this.object.getWorldPosition(this.v)
    this.aimed = this.area.aimAt(from, this.aim)
    this.area.showAim(this.aimed ? this.aim : null)
    // Point the dart along your line of sight (tip away from you), whatever the controller's angle.
    const eye = this.area.camera?.getWorldPosition(new THREE.Vector3())
    if (eye) {
      const dir = from.clone().sub(eye).normalize()
      const world = new THREE.Quaternion().setFromUnitVectors(this.forward, dir)
      const parent = this.object.parent!.getWorldQuaternion(this.q)
      this.object.quaternion.copy(parent.invert().multiply(world))
    }
    if (hand.triggerPressed) {
      hand.held = null
      this.release(hand, new THREE.Vector3())
    }
  }

  release(hand: Hand, throwVelocity: THREE.Vector3): void {
    if (this.state !== 'held') return
    this.area.root.attach(this.object)
    this.thrower = hand
    this.holder = null
    this.scored = false
    if (!hand.virtual && this.aimed) {
      // Sight-aimed: fly to the red dot, as hard as you threw (within limits).
      const target = this.area.board.localToWorld(new THREE.Vector3(this.aim.x, this.aim.y, 0.02))
      const from = this.object.getWorldPosition(this.v)
      const speed = THREE.MathUtils.clamp(this.peakSpeed * THROW_BOOST * 1.4, AIMED_MIN_SPEED, AIMED_MAX_SPEED)
      const flight = from.distanceTo(target) / speed
      this.velocity.subVectors(target, from).divideScalar(flight)
      this.velocity.y += 0.5 * GRAVITY * flight
      const wobble = THREE.MathUtils.degToRad(BASE_SCATTER)
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      this.velocity.applyAxisAngle(axis, (Math.random() - 0.5) * 2 * wobble)
      this.area.showAim(null)
    } else if (hand.virtual) {
      // Desktop: lob it at whatever you're looking at, about oche distance away.
      const eye = hand.ray.parent!
      const target = eye.getWorldPosition(new THREE.Vector3()).addScaledVector(eye.getWorldDirection(new THREE.Vector3()), THROW_DISTANCE)
      const from = this.object.getWorldPosition(this.v)
      const flight = THROW_DISTANCE / DESKTOP_THROW_SPEED
      this.velocity.subVectors(target, from).divideScalar(flight)
      this.velocity.y += 0.5 * GRAVITY * flight
    } else {
      this.velocity.copy(throwVelocity).multiplyScalar(THROW_BOOST)
    }
    // Scatter: a small random twist that grows with drink.
    const scatter = THREE.MathUtils.degToRad(this.area.scatter())
    if (scatter > 0) {
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      this.velocity.applyAxisAngle(axis, (Math.random() - 0.5) * 2 * scatter)
    }
    if (this.velocity.length() < 1.5) {
      // Barely thrown: just drops.
      this.state = 'falling'
      return
    }
    this.state = 'flying'
    this.area.board.worldToLocal(this.prevLocal.copy(this.object.getWorldPosition(this.v)))
  }

  setHighlight(on: boolean): void {
    for (const m of this.materials) m.emissive.copy(on ? new THREE.Color(0x2e7896) : new THREE.Color(0x000000))
  }

  /** Back to its slot in the rack. */
  returnToRack(): void {
    if (this.state === 'held') return
    this.rack.add(this.object)
    this.object.position.copy(this.slot)
    this.object.rotation.set(0, 0, 0)
    this.state = 'rack'
  }

  /** The attack shakes it off the board or out of the rack. */
  knockDown(): void {
    if (this.state === 'held') return
    this.area.root.attach(this.object)
    this.velocity.set((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2)
    this.state = 'falling'
  }

  update(dt: number): void {
    if (this.state === 'held') this.hold(dt)
    else if (this.state === 'flying') this.fly(dt)
    else if (this.state === 'falling') this.fall(dt)
    else if (this.state === 'down' && !this.area.interrupted) {
      // Fallen darts respawn in the rack; once the attack starts they stay where they fell.
      this.downTimer -= dt
      if (this.downTimer <= 0) this.returnToRack()
    }
  }

  private fly(dt: number): void {
    // Exact ballistic step (independent of frame rate).
    const pos = this.object.position.addScaledVector(this.velocity, dt)
    pos.y -= 0.5 * GRAVITY * dt * dt
    this.velocity.y -= GRAVITY * dt
    this.object.quaternion.setFromUnitVectors(this.forward, this.v.copy(this.velocity).normalize())

    // Crossing the board / cabin-wall plane from the front.
    this.area.board.worldToLocal(this.local.copy(this.object.getWorldPosition(this.v)))
    if (this.prevLocal.z > 0.02 && this.local.z <= 0.02) {
      const t = (this.prevLocal.z - 0.02) / (this.prevLocal.z - this.local.z)
      const x = this.prevLocal.x + (this.local.x - this.prevLocal.x) * t
      const y = this.prevLocal.y + (this.local.y - this.prevLocal.y) * t
      const dirLocal = this.v.copy(this.velocity).normalize().transformDirection(new THREE.Matrix4().copy(this.area.board.matrixWorld).invert())
      const pointFirst = -dirLocal.z > 0.55
      if (Math.hypot(x, y) <= RADII.board && pointFirst) {
        this.area.board.add(this.object)
        this.object.position.set(x, y, 0.06)
        this.object.quaternion.setFromUnitVectors(this.forward, new THREE.Vector3(0, 0, -1))
        this.state = 'stuck'
        this.area.audio.play('dartHit', this.object.getWorldPosition(this.v))
        this.finish(scoreAt(x, y))
        return
      }
      // Hit flat, or hit the cabin wall around the board: bounces off and drops.
      // (Beyond the cabin's sides and roof there's no wall, so the dart flies on.)
      const onWall = Math.abs(x) < 3.4 && y > -BOARD_POSITION.y + DECK_Y && y < 0.9
      if (onWall || Math.hypot(x, y) <= RADII.board) {
        this.velocity.multiplyScalar(-0.2)
        this.state = 'falling'
        this.area.audio.play('thud', pos, 0.5)
      }
    }
    this.prevLocal.copy(this.local)
    this.checkGround()
  }

  private fall(dt: number): void {
    this.velocity.y -= GRAVITY * dt
    this.object.position.addScaledVector(this.velocity, dt)
    this.object.rotation.x += dt * 6
    this.checkGround()
  }

  private checkGround(): void {
    const p = this.object.getWorldPosition(this.v)
    const floor = this.area.ground(p.x, p.z)
    if (floor !== null && p.y <= floor + 0.01) {
      this.object.position.y += floor + 0.01 - p.y
      this.object.rotation.set(0, Math.random() * 6, Math.PI / 2)
      this.state = 'down'
      this.downTimer = RETURN_DELAY
      this.finish(MISS)
    } else if (p.y < -1) {
      // Overboard: straight back to the rack.
      this.state = 'down'
      this.downTimer = 0
      this.finish(MISS)
    }
  }

  private finish(score: DartScore): void {
    if (this.scored || !this.thrower) return
    this.scored = true
    this.area.scoreDart(score, this.thrower)
    this.thrower = null
  }
}

function makeBoardTexture(): THREE.CanvasTexture {
  const size = 1024
  const c = size / 2
  const px = (metres: number) => (metres / RADII.board) * c
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#141414'
  ctx.fillRect(0, 0, size, size)
  const ring = (outer: number, inner: number, colors: [string, string]) => {
    SEGMENTS.forEach((_, i) => {
      // Canvas angles run clockwise from +x; segment 20 is centred straight up.
      const start = ((i * 18 - 9 - 90) * Math.PI) / 180
      const end = start + (18 * Math.PI) / 180
      ctx.beginPath()
      ctx.arc(c, c, px(outer), start, end)
      ctx.arc(c, c, px(inner), end, start, true)
      ctx.closePath()
      ctx.fillStyle = colors[i % 2]
      ctx.fill()
    })
  }
  ring(RADII.doubleOut, RADII.doubleIn, ['#c23b2c', '#2e7d3a'])
  ring(RADII.doubleIn, RADII.trebleOut, ['#1a1a1a', '#efe2c2'])
  ring(RADII.trebleOut, RADII.trebleIn, ['#c23b2c', '#2e7d3a'])
  ring(RADII.trebleIn, RADII.outerBull, ['#1a1a1a', '#efe2c2'])
  ctx.fillStyle = '#2e7d3a'
  ctx.beginPath()
  ctx.arc(c, c, px(RADII.outerBull), 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#c23b2c'
  ctx.beginPath()
  ctx.arc(c, c, px(RADII.bull), 0, Math.PI * 2)
  ctx.fill()
  // Wire and numbers.
  ctx.strokeStyle = '#b9b9b9'
  ctx.lineWidth = 2
  for (const r of [RADII.doubleOut, RADII.doubleIn, RADII.trebleOut, RADII.trebleIn, RADII.outerBull]) {
    ctx.beginPath()
    ctx.arc(c, c, px(r), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = '#f2f2f2'
  ctx.font = 'bold 54px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  SEGMENTS.forEach((n, i) => {
    const a = ((i * 18 - 90) * Math.PI) / 180
    const r = px((RADII.doubleOut + RADII.board) / 2)
    ctx.fillText(String(n), c + Math.cos(a) * r, c + Math.sin(a) * r)
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}
