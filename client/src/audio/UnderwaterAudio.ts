import * as THREE from 'three'
import type { Hand } from '../input/Hand'

// Procedural underwater sound: a muffled ambient bed and a bubble-jet hiss at each hand.
// All generated from noise, so there are no audio files to license yet.
export class UnderwaterAudio {
  readonly listener = new THREE.AudioListener()
  private ambient: THREE.Audio | null = null
  private readonly hiss = new Map<Hand, THREE.PositionalAudio>()
  private started = false

  constructor(
    camera: THREE.Camera,
    private readonly hands: Hand[],
  ) {
    camera.add(this.listener)
  }

  /** Call from a user gesture (browsers keep audio suspended until one). */
  start(): void {
    const context = this.listener.context
    if (context.state !== 'running') void context.resume()
    if (this.started) return
    this.started = true
    const noise = makeNoise(context, 3)

    const ambient = new THREE.Audio(this.listener)
    ambient.setBuffer(noise)
    ambient.setLoop(true)
    ambient.setVolume(0.35)
    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 280
    ambient.setFilter(lowpass)
    ambient.play()
    this.ambient = ambient

    for (const hand of this.hands) {
      const sound = new THREE.PositionalAudio(this.listener)
      sound.setBuffer(noise)
      sound.setLoop(true)
      sound.setVolume(0)
      sound.setRefDistance(0.4)
      const band = context.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = 1800
      band.Q.value = 0.8
      sound.setFilter(band)
      sound.play()
      hand.grip.add(sound)
      this.hiss.set(hand, sound)
    }
  }

  /** `thrust` is each hand's jet thrust 0–1, in the same order as the hands. */
  update(thrust: readonly number[]): void {
    if (!this.ambient) return
    this.hands.forEach((hand, i) => this.hiss.get(hand)?.setVolume((thrust[i] ?? 0) * 0.5))
  }
}

function makeNoise(context: AudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}
