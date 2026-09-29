import { TUNING as T } from './tuning'

// Air as a soft timer: slow drain while diving, faster with jets, refilled at vents and spare tanks.
export class AirTank {
  air: number

  constructor(readonly capacity: number = T.airCapacity) {
    this.air = capacity
  }

  get fraction(): number {
    return this.air / this.capacity
  }

  get empty(): boolean {
    return this.air <= 0
  }

  /** Drain for one frame; `thrust` is each hand's jet thrust 0–1. */
  drain(dt: number, thrust: readonly number[]): void {
    const jets = thrust.reduce((sum, t) => sum + t, 0)
    this.air = Math.max(0, this.air - dt * (T.airBaseDrain + T.airJetDrain * jets))
  }

  refill(dt: number, rate: number = T.airRefillRate): void {
    this.air = Math.min(this.capacity, this.air + dt * rate)
  }

  fill(): void {
    this.air = this.capacity
  }
}
