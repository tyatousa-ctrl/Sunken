import { bowZ, foremastZ, halfWidthAt } from '../world/ship/Galleon'

/** The crew's own ship is twice a wreck's length: this much extra deck amidships. */
export const STRETCH = 27.5
/** Her bow (ship-local z). */
export const DECK_BOW_Z = bowZ(STRETCH)
/** Her foremast (ship-local z). */
export const FOREMAST_Z = foremastZ(STRETCH)

/** Half the width of her deck at ship-local z. */
export function deckHalfWidth(z: number): number {
  return halfWidthAt(z, STRETCH)
}
