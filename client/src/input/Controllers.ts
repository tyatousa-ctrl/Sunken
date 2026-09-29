import * as THREE from 'three'
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js'
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js'

// Shows both Quest Touch controllers (or tracked hands) with a short pointer ray.
// Controller meshes come from the WebXR Input Profiles registry (MIT), fetched at runtime by three.js.
export class Controllers {
  readonly leftGrip: THREE.Group
  readonly rightGrip: THREE.Group

  constructor(renderer: THREE.WebGLRenderer, rig: THREE.Group) {
    const modelFactory = new XRControllerModelFactory()
    const handFactory = new XRHandModelFactory()
    const grips: THREE.XRGripSpace[] = []

    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i)
      ray.add(makePointer())
      rig.add(ray)

      const grip = renderer.xr.getControllerGrip(i)
      grip.add(modelFactory.createControllerModel(grip))
      rig.add(grip)
      grips.push(grip)

      const hand = renderer.xr.getHand(i)
      hand.add(handFactory.createHandModel(hand, 'mesh'))
      rig.add(hand)
    }

    // Controller index order is not guaranteed, so assign handedness once the input source connects.
    this.leftGrip = new THREE.Group()
    this.rightGrip = new THREE.Group()
    grips.forEach((grip) => {
      grip.addEventListener('connected', (event) => {
        const target = event.data.handedness === 'left' ? this.leftGrip : this.rightGrip
        grip.add(target)
      })
    })
  }
}

function makePointer(): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)])
  const material = new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.5 })
  const line = new THREE.Line(geometry, material)
  line.scale.z = 0.6
  return line
}
