import * as THREE from 'three'

export type VignetteStrength = 'off' | 'low' | 'high'

const STRENGTH: Record<VignetteStrength, number> = { off: 0, low: 0.55, high: 1 }

// Comfort vignette: darkens the edge of view as the diver moves or turns faster.
// It also doubles as a full fade to black (for running out of air and respawning).
export class ComfortVignette {
  /** 0 = clear, 1 = fully black; used for fades. */
  fade = 0
  private readonly uniforms = { uInner: { value: 2 }, uFade: { value: 0 } }
  private amount = 0

  constructor(
    camera: THREE.Camera,
    private strength: VignetteStrength,
  ) {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uInner;
        uniform float uFade;
        varying vec3 vDir;
        void main() {
          // Angle from straight ahead; the sphere is parented to the camera so -Z is the view direction.
          float angle = acos(clamp(-normalize(vDir).z, -1.0, 1.0));
          float edge = smoothstep(uInner, uInner + 0.3, angle);
          gl_FragColor = vec4(0.0, 0.02, 0.04, max(edge, uFade));
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    })
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 12), material)
    sphere.renderOrder = 1000
    sphere.frustumCulled = false
    camera.add(sphere)
  }

  setStrength(strength: VignetteStrength): void {
    this.strength = strength
  }

  update(dt: number, speed: number, yawRate: number): void {
    const motion = THREE.MathUtils.clamp((speed - 0.6) / 3 + Math.abs(yawRate) / 1.5, 0, 1)
    const target = motion * STRENGTH[this.strength]
    // Close quickly, open slowly.
    const rate = target > this.amount ? 6 : 2
    this.amount += (target - this.amount) * (1 - Math.exp(-rate * dt))
    // At rest the inner edge sits outside the field of view (~1.5 rad); at full it narrows to ~0.45 rad.
    this.uniforms.uInner.value = THREE.MathUtils.lerp(1.5, 0.45, this.amount)
    this.uniforms.uFade.value = this.fade
  }
}
