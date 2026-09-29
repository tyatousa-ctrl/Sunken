// All movement feel numbers in one place. Speeds in m/s, accelerations in m/s².
export const TUNING = {
  // Water drag: velocity decays by e^(-drag·t). Terminal speed for a constant push = accel / drag.
  drag: 1.2,
  // Extra decay applied only to the part of the speed above the current cap, so bursts bleed off smoothly.
  overspeedDrag: 2.5,

  swimMaxSpeed: 1.5,
  jetMaxSpeed: 4,
  driftSpeed: 0.8,

  // Arm strokes: only hand motion faster than this (relative to the body) pulls water.
  strokeThreshold: 0.35,
  strokeStrength: 2.2,
  strokeAccelCap: 6,

  // Bubble jets: one hand at full trigger reaches ~2.7 m/s; both hands (1.5× total) reach the 4 m/s cap.
  jetDeadzone: 0.05,
  jetAccel: 3.2,
  dualJetMultiplier: 1.5,

  // Spin trick: both jets firing in roughly opposite directions turn the diver.
  spinOpposedDot: -0.3,
  spinGain: 1.4,
  spinDamping: 2.5,
  maxYawRate: 1.6,

  // Air, in "seconds of calm swimming".
  airCapacity: 240,
  airBaseDrain: 1,
  airJetDrain: 3,
  airRefillRate: 45,
} as const
