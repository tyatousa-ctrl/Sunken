import * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { NetClient } from './NetClient'
import type { RemotePlayers } from './RemotePlayers'
import type { RtcSignal } from './protocol'

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

interface Peer {
  pc: RTCPeerConnection
  sound: THREE.PositionalAudio | null
  element: HTMLAudioElement | null
  filter: BiquadFilterNode | null
}

// Voice chat: a WebRTC audio mesh (up to 4 peers) signalled through the crew room. Each voice
// plays from that diver's head, muffled when either of you is underwater. Mute is local.
export class Voice {
  muted = false
  private stream: MediaStream | null = null
  private readonly peers = new Map<string, Peer>()

  constructor(
    private readonly net: NetClient,
    private readonly audio: AudioSystem,
    private readonly remote: RemotePlayers,
  ) {
    net.on<RtcSignal>('rtc', (msg) => void this.onSignal(msg))
  }

  /** Ask for the microphone (needs a user gesture). Voice still plays to you if this fails. */
  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      this.setMuted(this.muted)
      return true
    } catch {
      return false
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !muted
  }

  get connectedPeers(): number {
    return [...this.peers.values()].filter((p) => p.pc.connectionState === 'connected').length
  }

  update(listenerUnderwater: boolean): void {
    const roster = this.net.roster().filter((p) => p.sessionId !== this.net.sessionId && p.connected)
    // The lower session id calls the other, so each pair connects exactly once.
    for (const p of roster) if (!this.peers.has(p.sessionId) && this.net.sessionId < p.sessionId) this.connect(p.sessionId, true)
    for (const [id, peer] of this.peers) {
      if (!roster.some((p) => p.sessionId === id)) {
        this.close(id)
        continue
      }
      // Keep each voice at its speaker's head, muffled underwater.
      const head = this.remote.head(id)
      if (peer.sound && head && peer.sound.parent !== head) head.add(peer.sound)
      if (peer.filter) peer.filter.frequency.value = listenerUnderwater || this.remote.isUnderwater(id) ? 700 : 20000
    }
  }

  dispose(): void {
    for (const id of [...this.peers.keys()]) this.close(id)
    for (const track of this.stream?.getTracks() ?? []) track.stop()
  }

  private connect(id: string, initiator: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const peer: Peer = { pc, sound: null, element: null, filter: null }
    this.peers.set(id, peer)
    for (const track of this.stream?.getAudioTracks() ?? []) pc.addTrack(track, this.stream!)
    if (!this.stream) pc.addTransceiver('audio', { direction: 'recvonly' })
    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.send('rtc', { to: id, data: { candidate: e.candidate.toJSON() } })
    }
    pc.ontrack = (e) => this.attach(peer, e.streams[0] ?? new MediaStream([e.track]))
    if (initiator) {
      void (async () => {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        this.net.send('rtc', { to: id, data: { sdp: pc.localDescription } })
      })()
    }
    return peer
  }

  private async onSignal(msg: RtcSignal): Promise<void> {
    const from = msg.from
    if (!from) return
    const data = msg.data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
    const peer = this.peers.get(from) ?? this.connect(from, false)
    try {
      if (data.sdp) {
        await peer.pc.setRemoteDescription(data.sdp)
        if (data.sdp.type === 'offer') {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer())
          this.net.send('rtc', { to: from, data: { sdp: peer.pc.localDescription } })
        }
      } else if (data.candidate) {
        await peer.pc.addIceCandidate(data.candidate)
      }
    } catch (err) {
      console.warn('voice signalling', err)
    }
  }

  private attach(peer: Peer, stream: MediaStream): void {
    if (peer.sound) return
    // Chrome only feeds remote WebRTC audio into Web Audio if a media element is also playing it.
    const element = new Audio()
    element.srcObject = stream
    element.muted = true
    void element.play().catch(() => {})
    const sound = new THREE.PositionalAudio(this.audio.listener)
    sound.setMediaStreamSource(stream)
    sound.setRefDistance(1.5)
    const filter = this.audio.context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 20000
    sound.setFilter(filter)
    peer.sound = sound
    peer.element = element
    peer.filter = filter
  }

  private close(id: string): void {
    const peer = this.peers.get(id)
    if (!peer) return
    peer.pc.close()
    peer.sound?.removeFromParent()
    peer.sound?.disconnect()
    if (peer.element) peer.element.srcObject = null
    this.peers.delete(id)
  }
}
