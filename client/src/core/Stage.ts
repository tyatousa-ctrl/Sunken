import type * as THREE from 'three'
import type { AudioSystem } from '../audio/AudioSystem'
import type { DesktopControls } from '../input/DesktopControls'
import type { Hand } from '../input/Hand'
import type { ComfortVignette } from '../movement/ComfortVignette'
import type { Player } from '../movement/Player'
import type { Hud } from '../ui/Hud'
import type { WristComputer } from '../ui/WristComputer'
import type { Inventory } from '../systems/Inventory'
import type { NetClient } from '../net/NetClient'
import type { RemotePlayers } from '../net/RemotePlayers'
import type { BotCrew } from '../bots/BotCrew'
import type { Settings } from './settings'

/** Things that last the whole run (achievements, stats), shown on the victory screen later. */
export interface RunRecord {
  whoShotFirst: string | null
  clayHits: number
  clayShots: number
  /** Achievement: a bullseye on the dart board before the attack. */
  bullseyeBeforeBattle: boolean
}

import type { CharacterClass } from '../systems/crew'
export type { CharacterClass }

/** The crew's shared progress: carried from stage to stage, saved at checkpoints. */
export interface PartyState {
  character: CharacterClass
  inventory: Inventory
  score: number
  hasMap: boolean
  /** Map pieces found (piece I is the part of the map you start with). */
  mapPieces: number[]
  /** The level to resume from. */
  checkpoint: string
}

/** Shared services a stage can use. */
export interface GameContext {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  rig: THREE.Group
  player: Player
  audio: AudioSystem
  hud: Hud
  wrist: WristComputer
  vignette: ComfortVignette
  desktop: DesktopControls
  settings: Settings
  record: RunRecord
  party: PartyState
  /** The crew connection, or null when playing solo. */
  net: NetClient | null
  remote: RemotePlayers | null
  bots: BotCrew
  /** The hands in use this frame: both controllers in VR, the virtual hand on desktop. */
  readonly hands: Hand[]
  readonly inXr: boolean
  /** Half the render-target height in pixels, for particle sizing. */
  readonly halfHeight: number
  /** Fade to black, swap to the next stage, fade back in. */
  goTo(next: () => Stage): void
}

/** One chunk of the game (the ship deck, an underwater level). Owns everything under `root`. */
export interface Stage {
  /** Which part of the game this is ("intro", "level1", "sandbox"): avatars only show to players in the same one. */
  readonly id: string
  readonly root: THREE.Group
  enter(): void
  update(dt: number, elapsed: number): void
  exit(): void
}

/** Free GPU resources for everything under `root`. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const m of materials) {
      for (const value of Object.values(m)) if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose()
      m.dispose()
    }
  })
}
