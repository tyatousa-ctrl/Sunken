import * as THREE from 'three'
import { BOW_Z, CABIN_FRONT_Z, DECK_Y, halfWidthAt, type Galleon } from '../world/ship/Galleon'

interface CrewSpec {
  name: string
  shirt: number
  hat: 'bandana' | 'tricorn'
  home: [number, number]
  facing: number
}

const SPECS: CrewSpec[] = [
  { name: 'Salvo', shirt: 0xb23a2e, hat: 'bandana', home: [2.4, 5.2], facing: Math.PI / 2 },
  { name: 'Nino', shirt: 0xe3d7b8, hat: 'tricorn', home: [2.6, -3.5], facing: Math.PI / 2 },
  { name: 'Rosalia', shirt: 0x2f5e9e, hat: 'bandana', home: [-1.2, -6.5], facing: -Math.PI / 2 },
  { name: 'Turi', shirt: 0x3f6b3a, hat: 'tricorn', home: [-2.8, 5.4], facing: 0.4 },
]

class Sailor {
  readonly group = new THREE.Group()
  readonly target = new THREE.Vector3()
  panic = false
  private readonly body: THREE.Group
  private phase = Math.random() * 10
  private retarget = 0

  constructor(readonly spec: CrewSpec) {
    this.body = new THREE.Group()
    const skin = new THREE.MeshStandardMaterial({ color: 0xc58c64, roughness: 0.8 })
    const shirt = new THREE.MeshStandardMaterial({ color: spec.shirt, roughness: 0.9 })
    const trousers = new THREE.MeshStandardMaterial({ color: 0x2c2a33, roughness: 0.9 })
    const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 })
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.55, 4, 8), trousers)
    legs.position.y = 0.45
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.45, 4, 10), shirt)
    torso.position.y = 1.15
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), skin)
    head.position.y = 1.62
    const hat =
      spec.hat === 'tricorn'
        ? new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.14, 3), black)
        : new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc8322b }))
    hat.position.y = spec.hat === 'tricorn' ? 1.76 : 1.64
    this.body.add(legs, torso, head, hat)
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.45, 3, 6), shirt)
      arm.position.set(side * 0.28, 1.15, 0)
      arm.rotation.z = side * 0.15
      arm.name = side < 0 ? 'armL' : 'armR'
      this.body.add(arm)
    }
    this.group.add(this.body)
    this.group.position.set(spec.home[0], DECK_Y, spec.home[1])
    this.group.rotation.y = spec.facing
  }

  update(dt: number, elapsed: number): void {
    this.phase += dt
    const armL = this.body.getObjectByName('armL')!
    const armR = this.body.getObjectByName('armR')!
    if (!this.panic) {
      // Idle: gentle sway, the odd shift of weight.
      this.body.rotation.z = Math.sin(this.phase * 0.8) * 0.03
      this.body.position.y = 0
      armL.rotation.x = armR.rotation.x = 0
      return
    }
    // Panic: run between random spots on deck, arms waving.
    this.retarget -= dt
    if (this.retarget <= 0 || this.group.position.distanceTo(this.target) < 0.3) {
      this.retarget = 2 + Math.random() * 2
      const z = BOW_Z + 3 + Math.random() * (CABIN_FRONT_Z - BOW_Z - 4)
      const half = halfWidthAt(z) - 0.8
      this.target.set((Math.random() * 2 - 1) * half, DECK_Y, z)
    }
    const step = this.target.clone().sub(this.group.position)
    step.y = 0
    const dist = step.length()
    if (dist > 0.01) {
      step.multiplyScalar(Math.min(dist, 3 * dt) / dist)
      this.group.position.add(step)
      this.group.rotation.y = Math.atan2(step.x, step.z)
    }
    this.body.position.y = Math.abs(Math.sin(elapsed * 9 + this.phase)) * 0.06
    armL.rotation.x = Math.sin(elapsed * 9 + this.phase) * 1.2 - 1.4
    armR.rotation.x = Math.cos(elapsed * 9 + this.phase) * 1.2 - 1.4
  }
}

type ParrotMode = 'perched' | 'outbound' | 'circling' | 'returning'

// The parrot: perches on the starboard rail; can fly out to circle a target and come back.
class Parrot {
  readonly group = new THREE.Group()
  private readonly wings: THREE.Mesh[] = []
  private mode: ParrotMode = 'perched'
  private readonly target = new THREE.Vector3()
  private circle = 0
  private readonly v = new THREE.Vector3()

  constructor(
    private readonly perch: THREE.Object3D,
    private readonly root: THREE.Group,
  ) {
    const green = new THREE.MeshStandardMaterial({ color: 0x2c9a3f, roughness: 0.7 })
    const red = new THREE.MeshStandardMaterial({ color: 0xd23a2a, roughness: 0.7 })
    const beak = new THREE.MeshStandardMaterial({ color: 0xe8c33a, roughness: 0.5 })
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), green)
    body.scale.set(0.8, 1, 1.4)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), red)
    head.position.set(0, 0.07, -0.08)
    const bill = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 6), beak)
    bill.position.set(0, 0.06, -0.14)
    bill.rotation.x = -Math.PI / 2
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.01, 0.16), red)
    tail.position.set(0, -0.02, 0.15)
    this.group.add(body, head, bill, tail)
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1).translate(side * 0.08, 0, 0), green)
      ;(wing.material as THREE.Material).side = THREE.DoubleSide
      wing.position.y = 0.02
      this.group.add(wing)
      this.wings.push(wing)
    }
    perch.add(this.group)
  }

  flyTo(target: THREE.Vector3): void {
    if (this.mode !== 'perched') return
    this.target.copy(target)
    this.root.attach(this.group)
    this.mode = 'outbound'
  }

  update(dt: number, elapsed: number): void {
    const flap = this.mode === 'perched' ? Math.sin(elapsed * 2) * 0.1 : Math.sin(elapsed * 22) * 0.9
    this.wings[0].rotation.z = -flap
    this.wings[1].rotation.z = flap
    if (this.mode === 'perched') return
    const speed = 11
    if (this.mode === 'outbound') {
      const goal = this.v.copy(this.target).add(new THREE.Vector3(0, 12, 0))
      if (this.moveToward(goal, speed * dt)) {
        this.mode = 'circling'
        this.circle = 0
      }
    } else if (this.mode === 'circling') {
      this.circle += dt * 0.7
      const goal = this.v.set(Math.cos(this.circle) * 9, 12, Math.sin(this.circle) * 9).add(this.target)
      this.moveToward(goal, speed * dt)
      if (this.circle > Math.PI * 4) this.mode = 'returning'
    } else if (this.perch.getWorldPosition(this.v) && this.moveToward(this.v, speed * dt)) {
      this.perch.attach(this.group)
      this.group.position.set(0, 0, 0)
      this.group.rotation.set(0, Math.PI / 2, 0)
      this.mode = 'perched'
    }
  }

  private moveToward(goal: THREE.Vector3, step: number): boolean {
    const to = goal.clone().sub(this.group.position)
    const dist = to.length()
    if (dist <= step) {
      this.group.position.copy(goal)
      return true
    }
    this.group.position.addScaledVector(to, step / dist)
    this.group.lookAt(goal)
    this.group.rotateY(Math.PI)
    return false
  }
}

export class Crew {
  readonly sailors: Sailor[]
  readonly parrot: Parrot

  constructor(ship: Galleon, root: THREE.Group) {
    this.sailors = SPECS.map((spec) => new Sailor(spec))
    for (const s of this.sailors) ship.shake.add(s.group)
    const perch = new THREE.Object3D()
    const z = 3.2
    perch.position.set(halfWidthAt(z) - 0.02, DECK_Y + 1.1, z)
    perch.rotation.y = Math.PI / 2
    ship.shake.add(perch)
    this.parrot = new Parrot(perch, root)
  }

  get(name: string): Sailor {
    return this.sailors.find((s) => s.spec.name === name)!
  }

  panic(): void {
    for (const s of this.sailors) s.panic = true
  }

  update(dt: number, elapsed: number): void {
    for (const s of this.sailors) s.update(dt, elapsed)
    this.parrot.update(dt, elapsed)
  }
}
