import * as THREE from 'three'
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js'
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js'
import { assetUrl } from '../assets/manifest'
import { Hand } from './Hand'

// Shows both Quest Touch controllers (or tracked hands) with a short pointer ray, and exposes them as Hands.
// Controller and hand meshes are the WebXR Input Profiles models (MIT), bundled under client/public/xr-profiles.
export class Controllers {
  readonly hands: Hand[] = []
  /** Follow whichever grip is currently the left / right controller (index order isn't guaranteed). */
  readonly leftGrip = new THREE.Group()
  readonly rightGrip = new THREE.Group()

  constructor(renderer: THREE.WebGLRenderer, rig: THREE.Group) {
    const modelFactory = new XRControllerModelFactory().setPath(assetUrl('xr-profiles'))
    const handFactory = new XRHandModelFactory().setPath(assetUrl('xr-profile/generic-hand'))

    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i)
      ray.add(makePointer())
      rig.add(ray)

      const grip = renderer.xr.getControllerGrip(i)
      grip.add(modelFactory.createControllerModel(grip))
      rig.add(grip)

      const handModel = renderer.xr.getHand(i)
      handModel.add(handFactory.createHandModel(handModel, 'mesh'))
      rig.add(handModel)

      const hand = new Hand(grip, ray)
      this.hands.push(hand)
      grip.addEventListener('connected', (event) => {
        hand.source = event.data
        hand.handedness = event.data.handedness
        grip.add(hand.handedness === 'left' ? this.leftGrip : this.rightGrip)
      })
      grip.addEventListener('disconnected', () => {
        hand.source = null
      })
    }
  }

  get left(): Hand | undefined {
    return this.hands.find((h) => h.connected && h.handedness === 'left')
  }

  get right(): Hand | undefined {
    return this.hands.find((h) => h.connected && h.handedness === 'right')
  }

  update(dt: number): void {
    for (const hand of this.hands) hand.update(dt)
  }
}

function makePointer(): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)])
  const material = new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.5 })
  const line = new THREE.Line(geometry, material)
  line.scale.z = 0.6
  return line
}
