import * as THREE from 'three'

export type VignetteStrength = 'off' | 'low' | 'high'

const STRENGTH: Record<VignetteStrength, number> = { off: 0, low: 0.55, high: 1 }

// Comfort vignette: darkens the edge of view as the diver moves or turns faster.
// It also doubles as a full fade to black (for running out of air and respawning).
export class ComfortVignette {
  /** 0 = clear, 1 = fully black; used for the out-of-air fade. */
  fade = 0
  /** Separate fade for stage transitions, so the two never fight. */
  transition = 0
  /** Passing out after too much beer. */
  blackout = 0
  /** Warm drunken haze, 0–1 (never moves the camera: colour only). */
  drunk = 0
  private readonly uniforms = { uInner: { value: 2 }, uFade: { value: 0 }, uMask: { value: 0 }, uDrunk: { value: 0 }, uTime: { value: 0 } }
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
        uniform float uMask;
        uniform float uDrunk;
        uniform float uTime;
        varying vec3 vDir;
        void main() {
          // Angle from straight ahead; the sphere is parented to the camera so -Z is the view direction.
          float angle = acos(clamp(-normalize(vDir).z, -1.0, 1.0));
          float edge = smoothstep(uInner, uInner + 0.3, angle);
          // Dive goggles: two round lenses side by side with a nose bridge between them at the bottom;
          // the frame darkens everything outside the lenses. (Kept wide, so the view stays open.)
          vec3 d = normalize(vDir);
          vec2 t = d.xy / max(-d.z, 0.05);
          vec2 l = (t - vec2(-0.4, 0.06)) / vec2(0.78, 0.8);
          vec2 r = (t - vec2(0.4, 0.06)) / vec2(0.78, 0.8);
          float lens = min(length(l), length(r));
          float nose = (1.0 - smoothstep(0.14, 0.22, abs(t.x))) * smoothstep(-0.4, -0.55, t.y) * 0.8;
          float frame = -d.z < 0.05 ? 1.0 : max(smoothstep(0.96, 1.06, lens), nose);
          float mask = frame * 0.88 * uMask;
          float dark = max(max(edge, uFade), mask);
          // Drunk haze: amber, heavier at the edges, slowly breathing, with soft blotches swirling
          // round the edge of view (colour only: the view itself never moves).
          float around = atan(d.y, d.x);
          float swirl = 0.75 + 0.25 * sin(around * 3.0 + uTime * 0.9) * sin(angle * 5.0 - uTime * 0.7);
          float haze = uDrunk * (0.4 + 0.6 * smoothstep(0.1, 0.9, angle)) * (0.8 + 0.2 * sin(uTime * 1.3)) * swirl;
          float alpha = 1.0 - (1.0 - dark) * (1.0 - haze);
          vec3 color = mix(vec3(0.72, 0.36, 0.12), vec3(0.0, 0.02, 0.04), dark / max(dark + haze, 1e-3));
          gl_FragColor = vec4(color, alpha);
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

  /** Show the dive-mask rim (the mask is on). */
  setMask(on: boolean): void {
    this.uniforms.uMask.value = on ? 1 : 0
  }

  get maskOn(): boolean {
    return this.uniforms.uMask.value > 0
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
    this.uniforms.uFade.value = Math.max(this.fade, this.transition, this.blackout)
    this.uniforms.uDrunk.value = this.drunk
    this.uniforms.uTime.value += dt
  }
}
