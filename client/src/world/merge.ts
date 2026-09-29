import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Merge every single-material mesh under `group` into one mesh per material (fewer draw calls for
 * static scenery). Meshes in `keep` (and their descendants) are left alone. Returns the new meshes.
 */
export function mergeStatic(group: THREE.Object3D, keep: THREE.Object3D[] = []): THREE.Mesh[] {
  group.updateMatrixWorld(true)
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert()
  const kept = new Set<THREE.Object3D>()
  for (const k of keep) k.traverse((o) => kept.add(o))

  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const merged: THREE.Mesh[] = []
  const remove: THREE.Mesh[] = []
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || kept.has(o) || Array.isArray(o.material)) return
    const source = o.geometry as THREE.BufferGeometry
    const g = source.index ? source.toNonIndexed() : source.clone()
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name)
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    g.clearGroups()
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toGroup, o.matrixWorld))
    const list = byMaterial.get(o.material) ?? []
    list.push(g)
    byMaterial.set(o.material, list)
    remove.push(o)
  })
  for (const mesh of remove) mesh.removeFromParent()
  for (const [material, geometries] of byMaterial) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material)
    group.add(mesh)
    merged.push(mesh)
    for (const g of geometries) g.dispose()
  }
  return merged
}
