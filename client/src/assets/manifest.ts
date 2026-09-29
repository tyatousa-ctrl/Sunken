import manifest from './manifest.json'

export interface AssetEntry {
  id: string
  url: string
  source: string
  author: string
  license: string
  triangles: number | null
  bytes: number | null
}

const byId = new Map<string, AssetEntry>((manifest.assets as AssetEntry[]).map((a) => [a.id, a]))

/** The one place asset URLs come from (the brief forbids hard-coding them elsewhere). */
export function assetUrl(id: string): string {
  const entry = byId.get(id)
  if (!entry) throw new Error(`Asset "${id}" is not in manifest.json`)
  return entry.url
}
