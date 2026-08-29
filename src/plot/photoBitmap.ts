/**
 * Decoded per-time-step photos (manifest `textures` sets) for 2D canvas use —
 * the map view drapes them in plan view. Module-level LRU of ImageBitmaps,
 * keyed by dataset + step; the 3D panel keeps its own GPU-texture cache
 * (plot/three/photoTexture.ts), the browser's HTTP cache dedupes the network.
 */

import type { Dataset } from '../data/loader'
import type { TextureSet } from '../data/types'

const LRU_MAX = 24

const cache = new Map<string, ImageBitmap>()
const inflight = new Map<string, Promise<ImageBitmap>>()

const keyOf = (dataset: Dataset, k: number) => `${dataset.manifest.id}:${k}`

const urlOf = (dataset: Dataset, spec: TextureSet, k: number) =>
  dataset.url(spec.pattern.replace('{step}', String(k).padStart(spec.stepPad ?? 0, '0')))

/** Cached bitmap for step k, or null; never triggers a load. */
export function peekPhotoBitmap(dataset: Dataset, k: number): ImageBitmap | null {
  const key = keyOf(dataset, k)
  const bm = cache.get(key)
  if (bm) {
    cache.delete(key)
    cache.set(key, bm) // mark most-recently-used
  }
  return bm ?? null
}

/** Fetch + decode + cache the photo for step k. */
export function loadPhotoBitmap(
  dataset: Dataset,
  spec: TextureSet,
  k: number,
): Promise<ImageBitmap> {
  const kk = Math.min(spec.n - 1, Math.max(0, k))
  const hit = peekPhotoBitmap(dataset, kk)
  if (hit) return Promise.resolve(hit)
  const key = keyOf(dataset, kk)
  let p = inflight.get(key)
  if (p) return p
  p = fetch(urlOf(dataset, spec, kk))
    .then((r) => {
      if (!r.ok) throw new Error(`photo step ${kk}: ${r.status}`)
      return r.blob()
    })
    .then((blob) => createImageBitmap(blob))
    .then((bm) => {
      inflight.delete(key)
      cache.set(key, bm)
      while (cache.size > LRU_MAX) {
        const [oldKey, oldBm] = cache.entries().next().value!
        cache.delete(oldKey)
        oldBm.close()
      }
      return bm
    })
  p.catch(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** Warm the cache for steps k..k+count-1 (playback lookahead). */
export function prefetchPhotoBitmaps(
  dataset: Dataset,
  spec: TextureSet,
  k: number,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const kk = k + i
    if (kk >= spec.n) break
    if (!cache.has(keyOf(dataset, kk)) && !inflight.has(keyOf(dataset, kk))) {
      void loadPhotoBitmap(dataset, spec, kk).catch(() => {})
    }
  }
}
