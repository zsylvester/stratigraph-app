/**
 * Per-time-step photo textures for the 3D block's top surface (manifest
 * `textures` sets, e.g. the XES-02 overhead photos). Images are fetched and
 * decoded on demand and kept in a small LRU of ready-to-render THREE textures
 * — the full sequence would be ~800 MB of GPU memory, the LRU stays under
 * ~100 MB while covering playback lookahead plus scrubbing headroom.
 *
 * Images are pre-warped to grid coordinates offline (row 0 = grid row 0), so
 * sampling is a plain affine UV over the manifest extent, flipY off.
 */

import * as THREE from 'three'

import type { Dataset } from '../../data/loader'
import type { TextureSet } from '../../data/types'

const LRU_MAX = 40

export interface PhotoTextures {
  spec: TextureSet
  /** cached texture for step k, or null (never triggers a load) */
  get(k: number): THREE.Texture | null
  /** fetch + decode + cache the texture for step k */
  load(k: number): Promise<THREE.Texture>
  /** warm the cache for steps k..k+count-1 (playback lookahead) */
  prefetch(k: number, count: number): void
  dispose(): void
}

export function createPhotoTextures(
  dataset: Dataset,
  spec: TextureSet,
  anisotropy: number,
): PhotoTextures {
  // Map preserves insertion order -> LRU by delete/re-set on access
  const cache = new Map<number, THREE.Texture>()
  const inflight = new Map<number, Promise<THREE.Texture>>()
  let disposed = false

  const urlFor = (k: number) =>
    dataset.url(spec.pattern.replace('{step}', String(k).padStart(spec.stepPad ?? 0, '0')))

  const get = (k: number): THREE.Texture | null => {
    const t = cache.get(k)
    if (t) {
      cache.delete(k)
      cache.set(k, t) // mark most-recently-used
    }
    return t ?? null
  }

  const load = (k: number): Promise<THREE.Texture> => {
    const kk = Math.min(spec.n - 1, Math.max(0, k))
    const hit = get(kk)
    if (hit) return Promise.resolve(hit)
    let p = inflight.get(kk)
    if (p) return p
    p = fetch(urlFor(kk))
      .then((r) => {
        if (!r.ok) throw new Error(`texture step ${kk}: ${r.status}`)
        return r.blob()
      })
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        const tex = new THREE.Texture(bitmap)
        tex.flipY = false // row 0 of the image is grid row 0 -> v = 0
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = anisotropy
        tex.needsUpdate = true
        inflight.delete(kk)
        if (disposed) {
          tex.dispose()
          throw new Error('disposed')
        }
        cache.set(kk, tex)
        while (cache.size > LRU_MAX) {
          const [oldK, oldT] = cache.entries().next().value!
          cache.delete(oldK)
          oldT.dispose()
        }
        return tex
      })
    p.catch(() => inflight.delete(kk))
    inflight.set(kk, p)
    return p
  }

  return {
    spec,
    get,
    load,
    prefetch: (k, count) => {
      for (let i = 0; i < count; i++) {
        const kk = k + i
        if (kk >= spec.n) break
        if (!cache.has(kk) && !inflight.has(kk)) void load(kk).catch(() => {})
      }
    },
    dispose: () => {
      disposed = true
      for (const t of cache.values()) t.dispose()
      cache.clear()
      inflight.clear()
    },
  }
}
