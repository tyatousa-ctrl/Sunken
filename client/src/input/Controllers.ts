import * as THREE from 'three'
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js'
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js'
import { assetUrl } from '../assets/manifest'
import { Hand } from './Hand'
import { HandModel, type GloveKind } from './HandModel'

// Shows your hands (gloved hands posed round the controllers, or tracked hands) with a short pointer
// ray, and exposes the controllers as Hands. Tracked-hand meshes are the WebXR Input Profiles models
// (MIT), bundled under client/public/xr-profiles; the controller models are kept for reference only.
export class Controllers {
  readonly hands: Hand[] = []
  private readonly models = new Map<Hand, HandModel>()
  private glove: GloveKind = 'skin'
  /** Follow whichever grip is currently the left / right controller (index order isn't guaranteed). */
  readonly leftGrip = new THREE.Group()
  readonly rightGrip = new THREE.Group()

  constructor(renderer: THREE.WebGLRenderer, rig: THREE.Group) {
    // `?controllers` in the URL also draws the controller models (for lining the hands up).
    const modelFactory = new URLSearchParams(location.search).has('controllers') ? new XRControllerModelFactory().setPath(assetUrl('xr-profiles')) : null
    const handFactory = new XRHandModelFactory().setPath(assetUrl('xr-profile/generic-hand'))

    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i)
      const pointer = makePointer()
      ray.add(pointer)
      rig.add(ray)

      const grip = renderer.xr.getControllerGrip(i)
      if (modelFactory) grip.add(modelFactory.createControllerModel(grip))
      rig.add(grip)

      const handModel = renderer.xr.getHand(i)
      handModel.add(handFactory.createHandModel(handModel, 'mesh'))
      rig.add(handModel)

      const hand = new Hand(grip, ray)
      hand.pointer = pointer
      this.hands.push(hand)
      grip.addEventListener('connected', (event) => {
        hand.source = event.data
        hand.handedness = event.data.handedness
        grip.add(hand.handedness === 'left' ? this.leftGrip : this.rightGrip)
        // A gloved hand in place of the controller (tracked hands draw themselves).
        this.models.get(hand)?.group.removeFromParent()
        const model = new HandModel(hand.handedness === 'left' ? 'left' : 'right')
        model.setGlove(this.glove)
        model.group.visible = !event.data.hand
        grip.add(model.group)
        this.models.set(hand, model)
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

  /** Bare hands on deck, neoprene gloves for diving. */
  setGlove(kind: GloveKind): void {
    if (kind === this.glove) return
    this.glove = kind
    for (const model of this.models.values()) model.setGlove(kind)
  }

  update(dt: number): void {
    for (const hand of this.hands) {
      hand.update(dt)
      const model = this.models.get(hand)
      const pad = hand.source?.gamepad
      if (!model || !pad) continue
      // Quest Touch: 0 trigger, 1 grip, 3 stick, 4 A/X, 5 B/Y (touch sensors on the stick and buttons).
      const b = pad.buttons
      const touching = !!(b[3]?.touched || b[4]?.touched || b[5]?.touched)
      model.pose(b[0]?.value ?? 0, b[1]?.value ?? (hand.squeeze ? 1 : 0), touching, 1 - Math.exp(-20 * dt))
    }
  }
}

function makePointer(): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)])
  const material = new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.5 })
  const line = new THREE.Line(geometry, material)
  line.scale.z = 0.6
  return line
}
