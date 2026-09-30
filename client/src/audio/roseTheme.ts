// Rose's theme at the bow: a sweeping tin-whistle air over soft strings, written for this game (an
// original tune, synthesized, so nothing to license). If you'd rather play a recording you have the
// rights to, put it at client/public/audio/rose-theme.mp3 and that plays instead.

const RECORDING = 'audio/rose-theme.mp3'
/** Seconds per beat (a lilting 3/4). */
const BEAT = 0.72
/** The air: [MIDI note, beats]. D major. */
const MELODY: [number, number][] = [
  [69, 1], [74, 1], [76, 1],
  [78, 2], [76, 0.5], [74, 0.5],
  [76, 1.5], [74, 0.5], [71, 1],
  [69, 3],
  [78, 1], [81, 1], [83, 1],
  [81, 2], [78, 1],
  [79, 1], [78, 1], [76, 1],
  [74, 1.5], [76, 0.5], [78, 1],
  [76, 1], [74, 1], [71, 1],
  [74, 4],
]
/** A chord a bar (MIDI roots and thirds and fifths), under the air. */
const CHORDS: number[][] = [
  [50, 57, 62, 66], [47, 54, 59, 62], [43, 55, 59, 62], [45, 57, 61, 64],
  [50, 57, 62, 66], [47, 54, 59, 62], [43, 55, 59, 62], [45, 57, 61, 64],
  [43, 55, 59, 62], [50, 57, 62, 66],
]

let playingUntil = 0
/** No recording there (so don't keep asking for it). */
let noRecording = false

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

/** Play the theme (once at a time). Returns how long it lasts (s). */
export function playRoseTheme(ctx: AudioContext, out: AudioNode): number {
  const now = ctx.currentTime
  const beats = MELODY.reduce((sum, [, b]) => sum + b, 0)
  const length = beats * BEAT + 3
  if (now < playingUntil) return playingUntil - now
  playingUntil = now + length
  // A recording, if there is one; else ours.
  const audio = typeof Audio !== 'undefined' && !noRecording ? new Audio(RECORDING) : null
  if (audio) {
    audio.volume = 0.8
    let fellBack = false
    const fallBack = () => {
      if (fellBack) return
      fellBack = true
      noRecording = true
      synthesize(ctx, out)
    }
    audio.addEventListener('error', fallBack)
    audio.play().catch(fallBack)
    // Keep it to the moment (a minute at most).
    setTimeout(() => audio.pause(), 60000)
  } else synthesize(ctx, out)
  return length
}

function synthesize(ctx: AudioContext, out: AudioNode): void {
  const t0 = ctx.currentTime + 0.05
  const master = ctx.createGain()
  master.gain.value = 0.9
  // A big soft room.
  const reverb = ctx.createConvolver()
  reverb.buffer = impulse(ctx, 2.8)
  const wet = ctx.createGain()
  wet.gain.value = 0.45
  master.connect(out)
  master.connect(reverb)
  reverb.connect(wet)
  wet.connect(out)

  // The whistle: a pure tone with a little breath, gliding between notes, vibrato swelling on long ones.
  const whistle = ctx.createOscillator()
  whistle.type = 'sine'
  const edge = ctx.createOscillator()
  edge.type = 'triangle'
  const edgeGain = ctx.createGain()
  edgeGain.gain.value = 0.18
  const voice = ctx.createGain()
  voice.gain.value = 0
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 5.3
  const depth = ctx.createGain()
  depth.gain.value = 0
  lfo.connect(depth)
  depth.connect(whistle.detune)
  depth.connect(edge.detune)
  whistle.connect(voice)
  edge.connect(edgeGain)
  edgeGain.connect(voice)
  voice.connect(master)
  const breath = ctx.createBufferSource()
  breath.buffer = noise(ctx, 2)
  breath.loop = true
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 2400
  band.Q.value = 1.2
  const breathGain = ctx.createGain()
  breathGain.gain.value = 0
  breath.connect(band)
  band.connect(breathGain)
  breathGain.connect(master)

  let t = t0 + BEAT
  for (const [note, beats] of MELODY) {
    const f = hz(note + 12)
    const d = beats * BEAT
    whistle.frequency.setTargetAtTime(f, t, 0.025)
    edge.frequency.setTargetAtTime(f, t, 0.025)
    // Tongued: a tiny dip, a quick rise, a gentle swell and fade through the note.
    voice.gain.setTargetAtTime(0.03, t - 0.03, 0.01)
    voice.gain.setTargetAtTime(0.16, t, 0.03)
    voice.gain.setTargetAtTime(0.12, t + d * 0.6, d * 0.3)
    breathGain.gain.setTargetAtTime(0.012, t, 0.02)
    breathGain.gain.setTargetAtTime(0.004, t + 0.12, 0.1)
    depth.gain.setTargetAtTime(0, t, 0.02)
    if (d > 1) depth.gain.setTargetAtTime(14, t + 0.35, 0.3)
    t += d
  }
  voice.gain.setTargetAtTime(0, t - BEAT, 0.6)
  breathGain.gain.setTargetAtTime(0, t - BEAT, 0.3)
  for (const o of [whistle, edge, lfo, breath]) {
    o.start(t0)
    o.stop(t + 3)
  }

  // Strings: soft, slow-swelling chords, a bar each; and a low D underneath it all.
  const bar = BEAT * 3
  const strings = ctx.createBiquadFilter()
  strings.type = 'lowpass'
  strings.frequency.value = 900
  strings.connect(master)
  CHORDS.forEach((chord, i) => {
    const start = t0 + i * bar
    const end = start + bar * (i === CHORDS.length - 1 ? 2 : 1)
    for (const note of chord) {
      for (const cents of [-7, 6]) {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = hz(note)
        o.detune.value = cents
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, start)
        g.gain.linearRampToValueAtTime(0.012, start + bar * 0.45)
        g.gain.linearRampToValueAtTime(0.009, end - 0.1)
        g.gain.linearRampToValueAtTime(0, end + 0.6)
        o.connect(g)
        g.connect(strings)
        o.start(start)
        o.stop(end + 0.7)
      }
    }
  })
  const drone = ctx.createOscillator()
  drone.frequency.value = hz(38)
  const droneGain = ctx.createGain()
  droneGain.gain.setValueAtTime(0, t0)
  droneGain.gain.linearRampToValueAtTime(0.05, t0 + 2)
  droneGain.gain.setTargetAtTime(0, t, 0.8)
  drone.connect(droneGain)
  droneGain.connect(master)
  drone.start(t0)
  drone.stop(t + 4)
}

function noise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3)
  }
  return buffer
}
