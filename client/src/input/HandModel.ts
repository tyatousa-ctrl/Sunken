import * as THREE from 'three'

export type GloveKind = 'skin' | 'neoprene'

const COLORS: Record<GloveKind, number> = { skin: 0xd9a27a, neoprene: 0x1d2126 }

/** Per finger: z of the knuckle along the handle, segment lengths, and how far it curls (radians per joint). */
const FINGERS = [
  { name: 'index', z: -0.038, lengths: [0.042, 0.026, 0.022], radius: 0.0095 },
  { name: 'middle', z: -0.013, lengths: [0.046, 0.029, 0.023], radius: 0.0098 },
  { name: 'ring', z: 0.011, lengths: [0.043, 0.027, 0.022], radius: 0.0092 },
  { name: 'pinky', z: 0.033, lengths: [0.034, 0.021, 0.019], radius: 0.0082 },
]
/** Finger joint angles (about the handle's axis) fully open and fully closed round the handle. */
const OPEN = [-0.65, -0.55, -0.35]
const CLOSED = [-1.25, -1.35, -1.0]
/** The index finger straightens further when off the trigger (pointing). */
const INDEX_OPEN = [-0.2, -0.1, -0.05]

// A gloved hand drawn in place of the controller, posed round the controller's handle in grip space
// (the handle runs along z, thumb on the top face at the front). Built for the right hand; the left
// is its mirror image. The index finger follows the trigger, the other three the grip, and the thumb
// settles on the buttons when you touch them.
export class HandModel {
  readonly group = new THREE.Group()
  private readonly material: THREE.MeshStandardMaterial
  /** Each finger's joint chain (three pivots), in FINGERS order. */
  private readonly joints: THREE.Group[][] = []
  private readonly thumb: THREE.Group[] = []
  private readonly curl = [0, 0, 0, 0]
  private thumbDown = 0

  constructor(handedness: 'left' | 'right') {
    this.material = new THREE.MeshStandardMaterial({ color: COLORS.skin, roughness: 0.75 })
    const hand = new THREE.Group()
    // Palm: on the outside of the handle (+x), from the knuckle row up over the top.
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), this.material)
    palm.scale.set(0.38, 0.85, 1.05)
    palm.position.set(0.043, 0.015, 0)
    palm.rotation.z = 0.25
    // Wrist cuff, trailing back toward the forearm.
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.045, 12), this.material)
    cuff.position.set(0.038, 0.06, 0.04)
    cuff.rotation.x = 0.9
    hand.add(palm, cuff)

    // Fingers start at the knuckle row along the bottom edge of the palm and wrap under the handle.
    for (const f of FINGERS) {
      const chain: THREE.Group[] = []
      let parent: THREE.Object3D = hand
      f.lengths.forEach((length, i) => {
        const joint = new THREE.Group()
        if (i === 0) joint.position.set(0.042, -0.018, f.z)
        else joint.position.set(0, -f.lengths[i - 1], 0)
        const seg = new THREE.Mesh(new THREE.CapsuleGeometry(f.radius * (1 - i * 0.08), length - f.radius * 2, 3, 8), this.material)
        seg.position.y = -length / 2
        joint.add(seg)
        parent.add(joint)
        chain.push(joint)
        parent = joint
      })
      this.joints.push(chain)
    }

    // Thumb: from the heel of the palm, over the top of the handle onto the button face.
    let parent: THREE.Object3D = hand
    for (const [i, length] of [0.035, 0.028, 0.022].entries()) {
      const joint = new THREE.Group()
      if (i === 0) {
        joint.position.set(0.035, 0.035, -0.02)
        joint.rotation.set(0, 0, 0)
      } else joint.position.set(0, 0, -[0.035, 0.028][i - 1])
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105 - i * 0.001, length - 0.02, 3, 8), this.material)
      seg.rotation.x = Math.PI / 2
      seg.position.z = -length / 2
      joint.add(seg)
      parent.add(joint)
      this.thumb.push(joint)
      parent = joint
    }

    this.group.add(hand)
    if (handedness === 'left') this.group.scale.x = -1
    this.pose(0, 0, false, 1)
  }

  setGlove(kind: GloveKind): void {
    this.material.color.setHex(COLORS[kind])
  }

  /**
   * Pose from the controller: `trigger` and `grip` 0–1, `thumbOnButtons` if the thumb is touching
   * the face buttons or stick. Eases toward the pose (`k` 0–1 per call).
   */
  pose(trigger: number, grip: number, thumbOnButtons: boolean, k: number): void {
    const targets = [trigger, grip, grip, grip]
    this.joints.forEach((chain, f) => {
      this.curl[f] += (targets[f] - this.curl[f]) * k
      const c = this.curl[f]
      const open = f === 0 ? INDEX_OPEN : OPEN
      chain.forEach((joint, j) => (joint.rotation.z = open[j] + (CLOSED[j] - open[j]) * c))
    })
    this.thumbDown += ((thumbOnButtons ? 1 : 0) - this.thumbDown) * k
    // Thumb (pointing forward, -z) swings in over the top (about y) and presses down (about x).
    this.thumb[0].rotation.set(-0.2 - 0.25 * this.thumbDown, 0.35 + 0.45 * this.thumbDown, 0)
    this.thumb[1].rotation.x = -0.15 - 0.35 * this.thumbDown
    this.thumb[2].rotation.x = -0.1 - 0.3 * this.thumbDown
  }
}
