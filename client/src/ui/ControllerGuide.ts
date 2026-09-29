import * as THREE from 'three'
import { Label } from './Label'

/** What each button does right now. Lines are short: "A: backpack". */
export interface ButtonGuide {
  left: string[]
  right: string[]
  /** Keyboard version, shown in the corner on desktop. */
  desktop: string[]
}

/** Show a controller's labels when its face is turned toward you, within this distance. */
const SHOW_DISTANCE = 0.55
const SHOW_DOT = 0.8

// A small card floating over each controller listing its buttons. It appears when you raise the
// controller and turn its face toward you, and hides otherwise (and while that hand holds something,
// which has its own label), so it never gets in the way.
export class ControllerGuide {
  enabled = true
  private readonly labels: [Label, Label]
  private readonly dom = document.createElement('div')
  private domText = ''
  private readonly v = new THREE.Vector3()
  private readonly n = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()

  constructor(leftGrip: THREE.Object3D, rightGrip: THREE.Object3D) {
    this.labels = [leftGrip, rightGrip].map((grip) => {
      const label = new Label({ width: 0.13, canvasWidth: 360, canvasHeight: 300, onTop: true })
      // Above the controller's face, tipped back toward the eyes.
      label.mesh.position.set(0, 0.075, -0.03)
      label.mesh.rotation.x = -0.75
      label.visible = false
      grip.add(label.mesh)
      return label
    }) as [Label, Label]
    this.dom.className = 'legend-dom'
    this.dom.style.display = 'none'
    document.body.appendChild(this.dom)
  }

  /** `busy`: is the left / right hand holding something right now. */
  update(guide: ButtonGuide | null, camera: THREE.Camera, inXr: boolean, busy: [boolean, boolean] = [false, false]): void {
    const show = this.enabled && guide !== null
    const text = show && !inXr ? guide.desktop.join('<br>') : ''
    if (text !== this.domText) {
      this.domText = text
      this.dom.innerHTML = text
      this.dom.style.display = text ? 'block' : 'none'
    }
    camera.getWorldPosition(this.v)
    this.labels.forEach((label, i) => {
      if (!show || !inXr || busy[i]) {
        label.visible = false
        return
      }
      const lines = i === 0 ? guide.left : guide.right
      // Facing the eyes: the label's front normal points at the camera.
      const mesh = label.mesh
      mesh.getWorldPosition(this.n)
      const toEye = this.n.sub(this.v).negate()
      const distance = toEye.length()
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(this.q))
      label.visible = distance < SHOW_DISTANCE && normal.dot(toEye.normalize()) > SHOW_DOT && lines.length > 0
      if (label.visible)
        label.set([
          { text: i === 0 ? 'Left hand' : 'Right hand', size: 26, bold: true, color: '#8fd3ff' },
          ...lines.map((text) => ({ text, size: 30 })),
        ])
    })
  }
}
