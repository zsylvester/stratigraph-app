/**
 * Shared display cleanup for grid3d volumes. gridClean's analysis (spike mask,
 * plateau wedges, junk-edge crop) is computed ONCE per dataset, off the main
 * thread, and cached — the 3D block diagram and the 2D section panels both go
 * through it, so a wall and the cross section at the same index show the same
 * geometry over the same extent.
 */

import type { Dataset } from '../data/loader'
import type { SpaceGrid3d } from '../data/types'
import type { GridClean } from '../plot/three/gridClean'
import type { AnalyzeMsg } from '../plot/three/gridCleanWorker'

const cache = new Map<string, Promise<GridClean | null>>()

function analyzeInWorker(msg: AnalyzeMsg): Promise<GridClean> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../plot/three/gridCleanWorker.ts', import.meta.url), {
      type: 'module',
    })
    w.onmessage = (e: MessageEvent<GridClean>) => {
      w.terminate()
      resolve(e.data)
    }
    w.onerror = (e) => {
      w.terminate()
      reject(new Error(e.message))
    }
    w.postMessage(msg, [msg.data.buffer])
  })
}

/**
 * The grid analysis for a dataset (null for kinds that have no grid). Cached
 * per dataset id; concurrent callers share the one in-flight promise.
 */
export function gridCleanFor(dataset: Dataset): Promise<GridClean | null> {
  const m = dataset.manifest
  if (m.kind !== 'grid3d') return Promise.resolve(null)
  let p = cache.get(m.id)
  if (!p) {
    const space = m.space as SpaceGrid3d
    p = dataset.array('topo').then((topoV) =>
      analyzeInWorker({
        data: new Float32Array(topoV.data as Float32Array), // transferred away
        nRows: space.shape[0],
        nCols: space.shape[1],
        nt: m.time.n,
        res: m.processing.resolution,
        hasSubsid: !!m.arrays.subsid,
      }),
    )
    cache.set(m.id, p)
    p.catch(() => cache.delete(m.id))
  }
  return p
}
