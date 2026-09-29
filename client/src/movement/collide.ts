import * as THREE from 'three'
import type { BoxCollider, SwimEnvironment } from './environment'

export const HEAD_CLEARANCE = 0.35
/** Eyes stay this high over the seabed: a diver lying flat, with a body and tank under the head. */
export const FLOOR_CLEARANCE = 0.5
/** How far a diver's head can come up out of the water at the surface (to breathe and look around). */
export const SURFACE_POKE = 0.25

const v = new THREE.Vector3()
const local = new THREE.Vector3()
const closest = new THREE.Vector3()
const out = new THREE.Vector3()

/**
 * How far to move a diver's head (a sphere of HEAD_CLEARANCE) so it's clear of the seabed, the
 * surface, rocks, boxes and the edge of the area. Written into `push`; returns it.
 */
export function swimPush(head: THREE.Vector3, env: SwimEnvironment, push: THREE.Vector3): THREE.Vector3 {
  push.set(0, 0, 0)
  const floor = env.floorHeight(head.x, head.z) + FLOOR_CLEARANCE
  if (head.y < floor) push.y += floor - head.y
  const ceiling = env.surfaceY + SURFACE_POKE
  if (head.y > ceiling) push.y += ceiling - head.y

  for (const rock of env.rocks) {
    const offset = v.subVectors(head, rock.center)
    const min = rock.radius + HEAD_CLEARANCE
    const dist = offset.length()
    if (dist < min && dist > 1e-4) push.addScaledVector(offset, (min - dist) / dist)
  }
  for (const box of env.boxes) pushOutOfBox(head, box, push)

  const horizontal = Math.hypot(head.x, head.z)
  if (horizontal > env.radius) {
    push.x -= (head.x / horizontal) * (horizontal - env.radius)
    push.z -= (head.z / horizontal) * (horizontal - env.radius)
  }
  return push
}

/** Keep the head sphere out of an oriented box: push along the shortest way out. */
function pushOutOfBox(head: THREE.Vector3, box: BoxCollider, push: THREE.Vector3): void {
  local.copy(head).add(push).applyMatrix4(box.inverse)
  const h = box.half
  closest.set(THREE.MathUtils.clamp(local.x, -h.x, h.x), THREE.MathUtils.clamp(local.y, -h.y, h.y), THREE.MathUtils.clamp(local.z, -h.z, h.z))
  out.subVectors(local, closest)
  const dist = out.length()
  if (dist >= HEAD_CLEARANCE) return
  if (dist > 1e-4) {
    out.multiplyScalar((HEAD_CLEARANCE - dist) / dist)
  } else {
    // Centre inside the box: leave through the nearest face.
    const gaps = [h.x - Math.abs(local.x), h.y - Math.abs(local.y), h.z - Math.abs(local.z)]
    const axis = gaps.indexOf(Math.min(...gaps))
    out.set(0, 0, 0).setComponent(axis, Math.sign(local.getComponent(axis) || 1) * (gaps[axis] + HEAD_CLEARANCE))
  }
  // Box-local offset → world (rotation only; transformDirection normalises, so keep the length).
  const length = out.length()
  push.addScaledVector(out.transformDirection(box.matrix), length)
}
