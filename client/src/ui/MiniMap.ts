import * as THREE from 'three'

/** The part of a stage the mini map shows: a square around (x, z), seen from `top` straight down. */
export interface MapArea {
  x: number
  z: number
  size: number
  /** Height to look down from: anything above it (the sea's surface, a cave roof, sails) is left out. */
  top: number
  /** Printed under the map. */
  name: string
  /** Scale the scene's lights for the picture (the sunlit deck is far brighter than the deep). */
  exposure?: number
  /** Extra all-round light for the picture (dark levels). */
  boost?: number
}

/** Someone to draw on the map. */
export interface MapDot {
  position: THREE.Vector3
  color: THREE.Color
}

const SIZE = 0.058
const RT_PIXELS = 256
const MAX_DOTS = 8
/** Re-draw the picture of the level now and then (doors open, boulders move). */
const REDRAW_SECONDS = 20

// A mini map in the top-right of the dive mask's glass: the level seen from above (drawn once on
// arrival, and now and then after), a dot for each crewmate and bot in their colour, and an arrow
// for you, pointing where you face. North is up.
export class MiniMap {
  readonly group = new THREE.Group()
  private readonly target = new THREE.WebGLRenderTarget(RT_PIXELS, RT_PIXELS, { colorSpace: THREE.SRGBColorSpace })
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  private readonly picture: THREE.Mesh
  private readonly dots: THREE.Mesh[] = []
  private readonly me: THREE.Mesh
  private readonly labelCanvas = document.createElement('canvas')
  private readonly labelTexture: THREE.CanvasTexture
  private readonly light = new THREE.AmbientLight(0xffffff, 2.2)
  private area: MapArea | null = null
  private areaKey = ''
  private sinceDraw = Infinity
  private waitToDraw = 0
  /** Pictures still to take soon after arriving (a second one catches anything that was mid-flash). */
  private earlyDraws = 0
  private readonly probe = new Uint8Array(16)
  private readonly v = new THREE.Vector3()

  constructor(camera: THREE.Camera) {
    const overlay = (color: number | THREE.Color, opacity = 1) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false, toneMapped: false })
    // Frame, picture, then the dots on top.
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + 0.004, SIZE + 0.004), overlay(0x04141d, 0.75))
    frame.renderOrder = 1001
    this.picture = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshBasicMaterial({ map: this.target.texture, transparent: true, opacity: 0.88, depthTest: false, depthWrite: false, fog: false, toneMapped: false }))
    this.picture.renderOrder = 1002
    this.group.add(frame, this.picture)
    const dotGeometry = new THREE.CircleGeometry(0.0023, 14)
    const ringGeometry = new THREE.RingGeometry(0.0023, 0.0031, 14)
    for (let i = 0; i < MAX_DOTS; i++) {
      const dot = new THREE.Mesh(dotGeometry, overlay(0xffffff))
      const ring = new THREE.Mesh(ringGeometry, overlay(0x04141d))
      dot.add(ring)
      dot.renderOrder = ring.renderOrder = 1003
      dot.visible = false
      this.group.add(dot)
      this.dots.push(dot)
    }
    const arrow = new THREE.Shape()
    arrow.moveTo(0, 0.0048)
    arrow.lineTo(0.0032, -0.0034)
    arrow.lineTo(0, -0.0018)
    arrow.lineTo(-0.0032, -0.0034)
    arrow.closePath()
    this.me = new THREE.Mesh(new THREE.ShapeGeometry(arrow), overlay(0xffe08a))
    this.me.renderOrder = 1004
    this.group.add(this.me)
    // The level's name under the map.
    this.labelCanvas.width = 256
    this.labelCanvas.height = 40
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas)
    this.labelTexture.colorSpace = THREE.SRGBColorSpace
    const label = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE * (40 / 256)), new THREE.MeshBasicMaterial({ map: this.labelTexture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }))
    label.position.y = -SIZE / 2 - 0.0055
    label.renderOrder = 1003
    this.group.add(label)

    // Top right of the glass, tilted to face the eye.
    this.group.position.set(0.106, 0.068, -0.26)
    this.group.rotation.set(-0.24, -0.36, 0, 'YXZ')
    this.group.visible = false
    this.group.traverse((o) => (o.frustumCulled = false))
    camera.add(this.group)
    this.ortho.up.set(0, 0, -1)
  }

  /**
   * Keep the map up to date. `area` null hides it. `draw` renders the level from above into the
   * map's picture (the game calls it between frames, where rendering elsewhere is safe).
   */
  update(dt: number, visible: boolean, area: MapArea | null, me: THREE.Object3D, others: MapDot[]): boolean {
    this.group.visible = visible && area !== null
    if (!area) {
      this.area = null
      this.areaKey = ''
      return false
    }
    // A new level (not just the sinking ship moving the area a little): label it and take its picture.
    const key = `${area.name}|${area.size}`
    this.area = area
    if (key !== this.areaKey) {
      this.areaKey = key
      this.drawLabel(area.name)
      // Wait a moment after arriving (the level settles and lights up) before taking its picture.
      this.waitToDraw = 1
      this.earlyDraws = 2
      this.sinceDraw = 0
    }
    if (!this.group.visible) return false

    // You: an arrow where you are, turned the way you face.
    me.getWorldPosition(this.v)
    this.place(this.me, this.v)
    const facing = me.getWorldDirection(new THREE.Vector3())
    this.me.rotation.z = Math.atan2(-facing.x, -facing.z)
    this.dots.forEach((dot, i) => {
      const other = others[i]
      dot.visible = !!other
      if (!other) return
      ;(dot.material as THREE.MeshBasicMaterial).color.copy(other.color)
      this.place(dot, other.position)
    })

    this.sinceDraw += dt
    if (this.waitToDraw > 0) {
      this.waitToDraw -= dt
      return this.waitToDraw <= 0
    }
    return this.sinceDraw > (this.earlyDraws > 0 ? 4 : REDRAW_SECONDS)
  }

  /** Render the level from above into the picture. Called with the renderer free (between frames). */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hide: THREE.Object3D[]): void {
    const area = this.area
    if (!area) return
    this.sinceDraw = 0
    const half = area.size / 2
    Object.assign(this.ortho, { left: -half, right: half, top: half, bottom: -half, near: 0.05, far: area.top + 120 })
    this.ortho.position.set(area.x, area.top, area.z)
    this.ortho.lookAt(area.x, area.top - 1, area.z)
    this.ortho.updateProjectionMatrix()

    const fog = scene.fog
    const background = scene.background
    // Leave out the player's own things, and drifting particles (a speckled square round you).
    const hidden = [...hide]
    scene.traverse((o) => {
      if ((o as THREE.Points).isPoints) hidden.push(o)
    })
    const wasVisible = hidden.map((o) => o.visible)
    const exposure = area.exposure ?? 1
    const lights: [THREE.Light, number][] = []
    if (exposure !== 1) scene.traverse((o) => (o as THREE.Light).isLight && lights.push([o as THREE.Light, (o as THREE.Light).intensity]))
    for (const [light, intensity] of lights) light.intensity = intensity * exposure
    scene.fog = null
    scene.background = new THREE.Color(0x0b2a3a)
    hidden.forEach((o) => (o.visible = false))
    this.light.intensity = area.boost ?? 2.2
    scene.add(this.light)
    const xr = renderer.xr.enabled
    const before = renderer.getRenderTarget()
    renderer.xr.enabled = false
    renderer.setRenderTarget(this.target)
    renderer.clear()
    renderer.render(scene, this.ortho)
    // Washed out (it caught a cannon flash)? Take it again shortly.
    renderer.readRenderTargetPixels(this.target, RT_PIXELS / 2 - 1, RT_PIXELS / 2 - 1, 2, 2, this.probe)
    const blank = this.probe.every((v, i) => i % 4 === 3 || v >= 250)
    this.earlyDraws = blank ? Math.max(this.earlyDraws, 1) : Math.max(0, this.earlyDraws - 1)
    renderer.setRenderTarget(before)
    renderer.xr.enabled = xr
    scene.remove(this.light)
    for (const [light, intensity] of lights) light.intensity = intensity
    hidden.forEach((o, i) => (o.visible = wasVisible[i]))
    scene.fog = fog
    scene.background = background
  }

  /** A world point onto the map (clamped to the edge, so someone far off shows at the rim). */
  private place(mesh: THREE.Object3D, world: THREE.Vector3): void {
    const area = this.area!
    const u = THREE.MathUtils.clamp((world.x - area.x) / area.size, -0.47, 0.47)
    const v = THREE.MathUtils.clamp((world.z - area.z) / area.size, -0.47, 0.47)
    mesh.position.set(u * SIZE, -v * SIZE, 0.0004)
  }

  private drawLabel(name: string): void {
    const ctx = this.labelCanvas.getContext('2d')!
    ctx.clearRect(0, 0, 256, 40)
    ctx.fillStyle = 'rgba(4, 20, 30, 0.6)'
    ctx.beginPath()
    ctx.roundRect(0, 2, 256, 36, 10)
    ctx.fill()
    ctx.fillStyle = '#d8f4ff'
    ctx.font = 'bold 24px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, 128, 21)
    this.labelTexture.needsUpdate = true
  }
}
