import * as THREE from 'three'
import { CABIN_FRONT_Z, DECK_Y, type Galleon } from '../world/ship/Galleon'
import { deckHalfWidth, DECK_BOW_Z } from './deck'

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
      const z = DECK_BOW_Z + 3 + Math.random() * (CABIN_FRONT_Z - DECK_BOW_Z - 4)
      const half = deckHalfWidth(z) - 0.8
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

export class Crew {
  readonly sailors: Sailor[]

  constructor(ship: Galleon, root: THREE.Group) {
    this.sailors = SPECS.map((spec) => new Sailor(spec))
    for (const s of this.sailors) ship.shake.add(s.group)
  }

  get(name: string): Sailor {
    return this.sailors.find((s) => s.spec.name === name)!
  }

  panic(): void {
    for (const s of this.sailors) s.panic = true
  }

  update(dt: number, elapsed: number): void {
    for (const s of this.sailors) s.update(dt, elapsed)
  }
}
