/**
 * Runs gridClean's analyzeGrid off the main thread — the sampled sweep over
 * a full topo volume takes ~1-2 s on the large datasets, which would freeze
 * the UI when the 3D panel first opens. The caller transfers a copy of the
 * topo data in; the result masks transfer back.
 */

import { analyzeGrid, GridClean } from './gridClean'

export interface AnalyzeMsg {
  data: Float32Array
  nRows: number
  nCols: number
  nt: number
  res: number
  hasSubsid: boolean
}

self.onmessage = (e: MessageEvent<AnalyzeMsg>) => {
  const { data, nRows, nCols, nt, res, hasSubsid } = e.data
  const clean: GridClean = analyzeGrid(data, nRows, nCols, nt, res, hasSubsid)
  ;(self as unknown as Worker).postMessage(clean, [clean.bad.buffer, clean.exempt.buffer])
}
