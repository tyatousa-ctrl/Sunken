// Procedural one-shot sounds baked into AudioBuffers (no audio files to license yet).
// Each recipe is filtered noise and/or tones with an envelope, plus optional echoes.

export type SfxName = 'gunshot' | 'cannon' | 'crack' | 'splash' | 'bigSplash' | 'click' | 'impact' | 'whistle' | 'gulp' | 'thud' | 'pop' | 'pour' | 'dartHit'

interface Recipe {
  seconds: number
  /** One-pole low-pass cutoff in Hz (applied to the noise). */
  lowpass?: number
  highpass?: number
  noise?: number
  /** Low sine "thump" frequency and amount. */
  thump?: [freq: number, amount: number]
  tone?: [startFreq: number, endFreq: number, amount: number]
  attack?: number
  decay: number
  /** Echo delays (s) and gains: cliffs bouncing a gunshot back. */
  echoes?: [delay: number, gain: number][]
  gain?: number
}

const RECIPES: Record<SfxName, Recipe> = {
  gunshot: { seconds: 2.2, noise: 1, lowpass: 2600, thump: [70, 0.8], decay: 0.12, echoes: [[0.42, 0.28], [0.95, 0.12]], gain: 0.9 },
  cannon: { seconds: 3.5, noise: 1, lowpass: 700, thump: [42, 1.2], decay: 0.45, echoes: [[0.6, 0.3], [1.4, 0.15]], gain: 1 },
  crack: { seconds: 0.25, noise: 1, highpass: 1800, decay: 0.035, gain: 0.8 },
  splash: { seconds: 0.9, noise: 1, lowpass: 1600, highpass: 300, attack: 0.02, decay: 0.25, gain: 0.5 },
  bigSplash: { seconds: 2, noise: 1, lowpass: 1100, highpass: 120, attack: 0.05, decay: 0.6, gain: 0.9 },
  click: { seconds: 0.12, noise: 0.6, highpass: 2500, tone: [1400, 900, 0.4], decay: 0.02, gain: 0.6 },
  impact: { seconds: 1.6, noise: 1, lowpass: 1200, thump: [60, 1], decay: 0.3, gain: 1 },
  whistle: { seconds: 0.5, tone: [1800, 2300, 0.5], attack: 0.03, decay: 0.2, gain: 0.35 },
  gulp: { seconds: 0.35, tone: [260, 140, 0.6], noise: 0.1, lowpass: 500, attack: 0.03, decay: 0.12, gain: 0.5 },
  thud: { seconds: 0.2, noise: 0.5, lowpass: 600, thump: [110, 0.8], decay: 0.05, gain: 0.7 },
  pop: { seconds: 0.15, tone: [900, 400, 0.5], decay: 0.04, gain: 0.4 },
  pour: { seconds: 0.6, noise: 1, lowpass: 2200, highpass: 700, attack: 0.05, decay: 0.3, gain: 0.3 },
  dartHit: { seconds: 0.18, noise: 0.7, lowpass: 1800, thump: [180, 0.6], decay: 0.03, gain: 0.8 },
}

export function synthesize(context: BaseAudioContext, name: SfxName): AudioBuffer {
  const r = RECIPES[name]
  const rate = context.sampleRate
  const length = Math.floor(r.seconds * rate)
  const dry = new Float32Array(length)
  const lpA = r.lowpass ? 1 - Math.exp((-2 * Math.PI * r.lowpass) / rate) : 1
  const hpA = r.highpass ? Math.exp((-2 * Math.PI * r.highpass) / rate) : 0
  let lp = 0
  let hpPrevIn = 0
  let hpOut = 0
  let phase = 0
  let tonePhase = 0
  const attack = r.attack ?? 0.002
  for (let i = 0; i < length; i++) {
    const t = i / rate
    const env = (t < attack ? t / attack : 1) * Math.exp(-(t - Math.min(t, attack)) / r.decay)
    let s = 0
    if (r.noise) {
      lp += lpA * (Math.random() * 2 - 1 - lp)
      let n = lp
      if (r.highpass) {
        hpOut = hpA * (hpOut + n - hpPrevIn)
        hpPrevIn = n
        n = hpOut
      }
      s += n * r.noise
    }
    if (r.thump) {
      phase += (2 * Math.PI * r.thump[0] * (1 - 0.5 * Math.min(1, t / 0.3))) / rate
      s += Math.sin(phase) * r.thump[1] * Math.exp(-t / (r.decay * 1.5))
    }
    if (r.tone) {
      const f = r.tone[0] + (r.tone[1] - r.tone[0]) * Math.min(1, t / r.seconds)
      tonePhase += (2 * Math.PI * f) / rate
      s += Math.sin(tonePhase) * r.tone[2]
    }
    dry[i] = s * env
  }
  const buffer = context.createBuffer(1, length, rate)
  const out = buffer.getChannelData(0)
  out.set(dry)
  for (const [delay, gain] of r.echoes ?? []) {
    const offset = Math.floor(delay * rate)
    for (let i = 0; i + offset < length; i++) out[i + offset] += dry[i] * gain
  }
  let peak = 0
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]))
  const scale = peak > 0 ? (r.gain ?? 1) / peak : 0
  for (let i = 0; i < length; i++) out[i] *= scale
  return buffer
}

/** Looping ambience beds: `waves` (above water, slow swells) and `underwater` (muffled hum). */
export function synthesizeBed(context: BaseAudioContext, kind: 'waves' | 'underwater'): AudioBuffer {
  const rate = context.sampleRate
  const seconds = 8
  const length = seconds * rate
  const buffer = context.createBuffer(1, length, rate)
  const out = buffer.getChannelData(0)
  // Soft and low: a bed you notice when it stops, not a hiss.
  const cutoff = kind === 'waves' ? 520 : 170
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / rate)
  let lp = 0
  for (let i = 0; i < length; i++) {
    const t = i / rate
    lp += a * (Math.random() * 2 - 1 - lp)
    // Swells loop cleanly over the 8 s buffer (whole number of cycles).
    const swell = kind === 'waves' ? 0.45 + 0.35 * Math.sin((2 * Math.PI * t) / 4) + 0.2 * Math.sin((2 * Math.PI * t) / 8 + 1) : 1
    out[i] = lp * swell * (kind === 'waves' ? 1.6 : 2)
  }
  return buffer
}
