import * as THREE from 'three'
import type { Hand } from '../input/Hand'
import { synthesize, synthesizeBed, type SfxName } from './synth'

export type AudioEnvironment = 'air' | 'water'

// All game audio: ambience beds that crossfade between above and below water, a bubble-jet hiss
// per hand, and positional one-shot effects. Everything is synthesized (see synth.ts).
export class AudioSystem {
  readonly listener = new THREE.AudioListener()
  private readonly buffers = new Map<SfxName, AudioBuffer>()
  private waves: THREE.Audio | null = null
  private underwater: THREE.Audio | null = null
  private readonly hiss = new Map<Hand, THREE.PositionalAudio>()
  private environment: AudioEnvironment = 'air'
  private duck = 1
  /** Player's background-sound setting, 0–1. */
  private ambience = 0.3
  private duckTimer = 0
  private started = false

  constructor(
    camera: THREE.Camera,
    private readonly scene: THREE.Scene,
    private readonly hands: Hand[],
  ) {
    camera.add(this.listener)
  }

  get context(): AudioContext {
    return this.listener.context
  }

  /** Call from a user gesture (browsers keep audio suspended until one). */
  start(): void {
    if (this.context.state !== 'running') void this.context.resume()
    if (this.started) return
    this.started = true
    this.waves = this.loop(synthesizeBed(this.context, 'waves'))
    this.underwater = this.loop(synthesizeBed(this.context, 'underwater'))
    const noise = synthesizeBed(this.context, 'underwater')
    for (const hand of this.hands) {
      const sound = new THREE.PositionalAudio(this.listener)
      sound.setBuffer(noise)
      sound.setLoop(true)
      sound.setVolume(0)
      sound.setRefDistance(0.4)
      const band = this.context.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = 1800
      band.Q.value = 0.8
      sound.setFilter(band)
      sound.play()
      hand.grip.add(sound)
      this.hiss.set(hand, sound)
    }
    this.applyLevels()
  }

  /** Background sound level from settings (0–1). */
  setAmbience(level: number): void {
    this.ambience = Math.max(0, Math.min(1, level))
    this.applyLevels()
  }

  setEnvironment(environment: AudioEnvironment): void {
    this.environment = environment
    this.applyLevels()
  }

  /** Drop the ambience to near silence for `seconds` (the beat before the attack). */
  silence(seconds: number): void {
    this.duck = 0.1
    this.duckTimer = seconds
    this.applyLevels()
  }

  play(name: SfxName, at?: THREE.Vector3, volume = 1): void {
    if (!this.started) return
    let buffer = this.buffers.get(name)
    if (!buffer) {
      buffer = synthesize(this.context, name)
      this.buffers.set(name, buffer)
    }
    const underwater = this.environment === 'water'
    const sound = at ? new THREE.PositionalAudio(this.listener) : new THREE.Audio(this.listener)
    sound.setBuffer(buffer)
    sound.setVolume(volume)
    if (sound instanceof THREE.PositionalAudio) {
      sound.setRefDistance(name === 'cannon' ? 25 : 3)
      sound.setRolloffFactor(0.8)
      sound.position.copy(at!)
      this.scene.add(sound)
    }
    if (underwater) {
      const muffle = this.context.createBiquadFilter()
      muffle.type = 'lowpass'
      muffle.frequency.value = 500
      sound.setFilter(muffle)
    }
    const ended = sound.onEnded.bind(sound)
    sound.onEnded = () => {
      ended()
      sound.removeFromParent()
      sound.disconnect()
    }
    sound.play()
  }

  update(dt: number, thrust: readonly number[]): void {
    if (!this.started) return
    if (this.duckTimer > 0) {
      this.duckTimer -= dt
      if (this.duckTimer <= 0) {
        this.duck = 1
        this.applyLevels()
      }
    }
    this.hands.forEach((hand, i) => this.hiss.get(hand)?.setVolume((thrust[i] ?? 0) * 0.25))
  }

  private loop(buffer: AudioBuffer): THREE.Audio {
    const sound = new THREE.Audio(this.listener)
    sound.setBuffer(buffer)
    sound.setLoop(true)
    sound.setVolume(0)
    sound.play()
    return sound
  }

  private applyLevels(): void {
    // Well under the effects and voices; the slider scales it from silent to this.
    this.waves?.setVolume(this.environment === 'air' ? 0.08 * this.ambience * this.duck : 0)
    this.underwater?.setVolume(this.environment === 'water' ? 0.06 * this.ambience * this.duck : 0)
  }
}
