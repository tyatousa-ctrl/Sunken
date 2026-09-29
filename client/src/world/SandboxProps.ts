import * as THREE from 'three'
import { applyCaustics } from './caustics'
import { sandHeight, VENT_POSITION } from './SeabedScene'
import type { GrabSystem } from '../interaction/GrabSystem'

// Placeholder grabbable props for the movement sandbox, built from primitives:
// Greek amphorae, shells, Mediterranean red starfish and a spare air tank.
export function addSandboxProps(grab: GrabSystem): void {
  const amphorae: [number, number, number][] = [
    [-1.6, -3.2, 0.3],
    [2.2, -4.6, 1.4],
    [-3.4, -6.5, 1.3],
  ]
  for (const [x, z, tilt] of amphorae) {
    const amphora = makeAmphora()
    amphora.rotation.set(tilt, Math.random() * Math.PI, 0)
    place(amphora, x, z, 0.12)
    grab.add(amphora, 0.22)
  }

  for (let i = 0; i < 6; i++) {
    const angle = i * 1.1 + 0.4
    const shell = makeShell()
    place(shell, Math.cos(angle) * (1.8 + i * 0.5), Math.sin(angle) * (1.8 + i * 0.5) - 1, 0.02)
    grab.add(shell, 0.05)
  }

  const starfish: [number, number][] = [
    [0.8, -2.2],
    [-2.4, -1.5],
    [3.1, -2.9],
  ]
  for (const [x, z] of starfish) {
    const star = makeStarfish()
    place(star, x, z, 0.02)
    grab.add(star, 0.1)
  }

  const tank = makeAirTank()
  place(tank, VENT_POSITION.x + 1.6, VENT_POSITION.z + 1.2, 0.09)
  tank.rotation.z = Math.PI / 2
  grab.add(tank, 0.18, 'airTank')
}

function place(object: THREE.Object3D, x: number, z: number, lift: number): void {
  object.position.set(x, sandHeight(x, z) + lift, z)
}

function material(color: number, roughness = 0.8): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness })
  applyCaustics(m, 0.45)
  return m
}

function makeAmphora(): THREE.Group {
  const profile = [
    [0.0, 0.0],
    [0.03, 0.0],
    [0.05, 0.05],
    [0.1, 0.15],
    [0.14, 0.28],
    [0.13, 0.4],
    [0.07, 0.5],
    [0.045, 0.56],
    [0.045, 0.66],
    [0.06, 0.68],
    [0.05, 0.7],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const body = new THREE.LatheGeometry(profile, 14)
  body.translate(0, -0.35, 0)
  const clay = material(0xa5522f, 0.9)
  const group = new THREE.Group()
  group.add(new THREE.Mesh(body, clay))
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 10, Math.PI), clay)
    handle.position.set(side * 0.07, 0.2, 0)
    handle.rotation.set(0, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2)
    group.add(handle)
  }
  return group
}

function makeShell(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
  geometry.scale(1, 0.45, 0.8)
  return new THREE.Mesh(geometry, material(0xe9c3b0, 0.6))
}

function makeStarfish(): THREE.Mesh {
  const shape = new THREE.Shape()
  for (let i = 0; i <= 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + Math.PI / 2
    const r = i % 2 === 0 ? 0.1 : 0.035
    const x = Math.cos(angle) * r
    const y = Math.sin(angle) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1 })
  geometry.rotateX(-Math.PI / 2)
  return new THREE.Mesh(geometry, material(0xc8452a, 0.85))
}

function makeAirTank(): THREE.Group {
  const group = new THREE.Group()
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 14), material(0xe8c547, 0.4)))
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.07, 8), material(0x9aa3a8, 0.3))
  valve.position.y = 0.245
  group.add(valve)
  return group
}
