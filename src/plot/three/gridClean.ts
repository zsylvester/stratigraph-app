/**
 * Display-side cleanup of grid3d topo volumes for the 3D block diagram
 * (analogous to the map view's 3x3 blur). Three artifact families, three
 * detectors — bundle data is never modified:
 *
 * 1. SPIKES (TDWB-17-1 cart noise, isolated outliers): real relief deviates
 *    from the 4-neighbor median by ≲p99 while spikes sit far in the tail —
 *    threshold max(3×p99, 10×resolution) separates them cleanly (meanderpy:
 *    nothing flagged). Spike cells are median-replaced when rendered.
 * 2. PLATEAU WEDGES (XES-02 "corner fix"): the notebook fills the proximal
 *    triangular corners with a CONSTANT surface (topo 0, flat subsidence) at
 *    every step. The top surface renders them as-is — flat shoulders framing
 *    the basin, like the original block diagrams — and they are exempt from
 *    spike treatment (their cliff boundary is a persistent high-deviation
 *    chain). On WALLS, strata drawn across the fill boundary would collapse
 *    into a tall needle of slivers (all surfaces pinch to the fill level),
 *    so wall painting pens up across exempt cells (sectionPaint skipMask):
 *    the wedge segment reads as solid basement up to the plateau, meeting
 *    the top-surface shoulder seamlessly. Detected as time-constant cells
 *    flood-connected to the grid boundary (only meaningful when the dataset
 *    has subsidence — in a subsiding tank no REAL cell holds constant
 *    elevation, while meanderpy's genuinely static floodplain must not
 *    match).
 * 3. JUNK EDGE LINES (TDWB tank walls): outermost rows/cols whose mean
 *    difference to their inward neighbor dwarfs real relief. Trimmed off the
 *    displayed block, along with edges dominated by flagged cells.
 */

export interface GridClean {
  /** displayed sub-grid (inclusive index ranges) */
  r0: number
  r1: number
  c0: number
  c1: number
  /** spike cells: median-replace for display; sections interpolate across */
  bad: Uint8Array
  /** plateau wedges + their cliff ring: render as-is, never despike */
  exempt: Uint8Array
  /** topo color range over clean, in-crop cells (all time steps) */
  range: [number, number]
  /** spike deviation threshold (per-step dynamic despiking of the surface) */
  spikeThresh: number
}

export function analyzeGrid(
  data: Float32Array,
  nRows: number,
  nCols: number,
  nt: number,
  res: number,
  hasSubsid: boolean,
): GridClean {
  const at = (r: number, c: number, k: number) => data[(r * nCols + c) * nt + k]
  // deviation from the median of the 8-neighborhood: near edges half of a
  // cell's 4-neighbors lie on the same (possibly junk) line, so the plus-
  // shaped stencil under-detects there — diagonals reach clean cells.
  // Allocation-free (scratch array + insertion sort): this runs hundreds of
  // millions of times across the sampled volume.
  const nb = new Float64Array(8)
  const dev = (r: number, c: number, k: number): number => {
    const v = at(r, c, k)
    if (!Number.isFinite(v)) return 0
    let n = 0
    const rA = r > 0 ? r - 1 : r
    const rB = r < nRows - 1 ? r + 1 : r
    const cA = c > 0 ? c - 1 : c
    const cB = c < nCols - 1 ? c + 1 : c
    for (let rr = rA; rr <= rB; rr++) {
      for (let cc = cA; cc <= cB; cc++) {
        if (rr === r && cc === c) continue
        const u = at(rr, cc, k)
        if (!Number.isFinite(u)) continue
        // insertion sort as we go
        let i = n++
        while (i > 0 && nb[i - 1] > u) {
          nb[i] = nb[i - 1]
          i--
        }
        nb[i] = u
      }
    }
    if (!n) return 0
    const m = n % 2 ? nb[(n - 1) / 2] : (nb[n / 2 - 1] + nb[n / 2]) / 2
    return Math.abs(v - m)
  }

  // deviation distribution at the final step -> spike threshold
  const devs: number[] = []
  for (let r = 0; r < nRows; r += 2) {
    for (let c = 0; c < nCols; c += 2) devs.push(dev(r, c, nt - 1))
  }
  devs.sort((a, b) => a - b)
  const p99 = devs[Math.floor(devs.length * 0.99)]
  const p95 = devs[Math.floor(devs.length * 0.95)]
  // Does a spike population exist at all? Smooth model output (meanderpy)
  // has a continuous deviation tail (p9999 ≈ 2.8×p99) — nothing to mask,
  // and a low bar would flag real cutbanks. Flume scans have a detached
  // outlier population (p9999 ≈ 8-32×p99).
  const p9999 = devs[Math.min(devs.length - 1, Math.floor(devs.length * 0.9999))]
  const hasSpikes = p9999 > 4 * p99
  // The static mask requires RECURRENCE at the same cell, which already
  // rules out sharp transient morphology — so its amplitude bar can sit
  // lower (TDWB rail noise hovers at 25-35 mm, ~2-3×p99). The dynamic
  // per-step surface despike has no recurrence check, so it stays at 3×p99
  // to never clip a real one-off feature.
  const statThresh = hasSpikes ? Math.max(2 * p99, 10 * res) : Infinity
  const spikeThresh = Math.max(3 * p99, 10 * res)

  const steps: number[] = []
  const stride = Math.max(1, Math.floor(nt / 15))
  for (let k = 0; k < nt; k += stride) steps.push(k)
  if (steps[steps.length - 1] !== nt - 1) steps.push(nt - 1)
  const allSteps = Array.from({ length: nt }, (_, k) => k)

  // 1. plateau wedges (XES-02 corner fix): time-constant cells flooded from
  // the grid boundary, plus a one-cell ring covering the cliff boundary to
  // the real data. These render AS-IS (like the original stratigraph block
  // diagrams) and are exempt from all spike treatment below.
  const exempt = new Uint8Array(nRows * nCols)
  if (hasSubsid) {
    const dead = new Uint8Array(nRows * nCols)
    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < nCols; c++) {
        let mn = Infinity
        let mx = -Infinity
        for (const k of steps) {
          const v = at(r, c, k)
          if (v < mn) mn = v
          if (v > mx) mx = v
        }
        if (mx - mn < res) dead[r * nCols + c] = 1
      }
    }
    // BFS from all boundary dead cells
    const plateau = new Uint8Array(nRows * nCols)
    const queue: number[] = []
    const push = (r: number, c: number) => {
      const i = r * nCols + c
      if (dead[i] && !plateau[i]) {
        plateau[i] = 1
        queue.push(i)
      }
    }
    for (let c = 0; c < nCols; c++) {
      push(0, c)
      push(nRows - 1, c)
    }
    for (let r = 0; r < nRows; r++) {
      push(r, 0)
      push(r, nCols - 1)
    }
    while (queue.length) {
      const i = queue.pop()!
      const r = (i / nCols) | 0
      const c = i % nCols
      if (r > 0) push(r - 1, c)
      if (r < nRows - 1) push(r + 1, c)
      if (c > 0) push(r, c - 1)
      if (c < nCols - 1) push(r, c + 1)
    }
    // dilate one cell so the cliff cells bordering the plateau are covered
    exempt.set(plateau)
    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < nCols; c++) {
        if (!plateau[r * nCols + c]) continue
        if (r > 0) exempt[(r - 1) * nCols + c] = 1
        if (r < nRows - 1) exempt[(r + 1) * nCols + c] = 1
        if (c > 0) exempt[r * nCols + c - 1] = 1
        if (c < nCols - 1) exempt[r * nCols + c + 1] = 1
      }
    }
  }

  // 2. spikes — PERSISTENT deviants only. Scan-hardware noise (TDWB cart
  // rails: flagged at a median of 81 of 101 steps) sits at fixed cells for
  // much of the run, while sharp transient REAL morphology (a meanderpy
  // cutbank, deviant at exactly 1 step) must never be masked: masking is
  // static, so a transient flag would smooth the cell at every step.
  // The tank-edge band is checked exhaustively (noise clusters there);
  // the interior makes do with sampled steps.
  const EDGE_BAND = 8
  const bad = new Uint8Array(nRows * nCols)
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      if (exempt[r * nCols + c]) continue
      const nearEdge =
        r < EDGE_BAND || r >= nRows - EDGE_BAND || c < EDGE_BAND || c >= nCols - EDGE_BAND
      // recurrence bar: high enough that a one-off real event never gets
      // statically masked, low enough to catch intermittent scan noise
      const ks = nearEdge ? allSteps : steps
      const need = nearEdge ? 3 : 2
      let n = 0
      for (const k of ks) {
        if (dev(r, c, k) > statThresh && ++n >= need) {
          bad[r * nCols + c] = 1
          break
        }
      }
    }
  }

  // 3. trim edges: junk lines (inward diff >> relief) or flag-dominated.
  // The plateau wedges are NOT cropped — the top surface renders them as
  // flat shoulders (like the original block diagrams) and the wall painter
  // pens up across them (opts.skipMask), so they cost no real extent.
  let r0 = 0
  let r1 = nRows - 1
  let c0 = 0
  let c1 = nCols - 1
  const diffThresh = Math.max(8 * p95, 10 * res)
  const k = nt - 1
  // plateau cells are excluded from the line statistics: their constant fill
  // has zero inward diff and would dilute the average below the junk
  // threshold (real scan noise on the same line then goes undetected)
  const rowStats = (r: number, inner: number) => {
    let d = 0
    let flagged = 0
    let n = 0
    for (let c = c0; c <= c1; c++) {
      if (exempt[r * nCols + c]) continue
      d += Math.abs(at(r, c, k) - at(inner, c, k))
      flagged += bad[r * nCols + c]
      n++
    }
    if (!n) return { meanDiff: 0, flagFrac: 0 }
    return { meanDiff: d / n, flagFrac: flagged / n }
  }
  const colStats = (c: number, inner: number) => {
    let d = 0
    let flagged = 0
    let n = 0
    for (let r = r0; r <= r1; r++) {
      if (exempt[r * nCols + c]) continue
      d += Math.abs(at(r, c, k) - at(r, inner, k))
      flagged += bad[r * nCols + c]
      n++
    }
    if (!n) return { meanDiff: 0, flagFrac: 0 }
    return { meanDiff: d / n, flagFrac: flagged / n }
  }
  const junk = (s: { meanDiff: number; flagFrac: number }) => s.meanDiff > diffThresh || s.flagFrac > 0.3
  for (let i = 0; i < 8 && r1 - r0 > 20 && junk(rowStats(r0, r0 + 1)); i++) r0++
  for (let i = 0; i < 8 && r1 - r0 > 20 && junk(rowStats(r1, r1 - 1)); i++) r1--
  for (let i = 0; i < 8 && c1 - c0 > 20 && junk(colStats(c0, c0 + 1)); i++) c0++
  for (let i = 0; i < 8 && c1 - c0 > 20 && junk(colStats(c1, c1 - 1)); i++) c1--
  // scan noise clusters at the scan margins, and compact 2-3 cell clusters
  // there defeat median tests (their neighbors are fellow spikes) — on
  // spike-bearing datasets keep a 2-line safety margin beyond detected junk
  if (hasSpikes) {
    r0 += 2
    r1 -= 2
    c0 += 2
    c1 -= 2
  }

  // color range over clean, in-crop cells only (spikes would compress it)
  let lo = Infinity
  let hi = -Infinity
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (bad[r * nCols + c]) continue
      const b = (r * nCols + c) * nt
      for (let i = 0; i < nt; i++) {
        const v = data[b + i]
        if (Number.isFinite(v)) {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
    }
  }

  return { r0, r1, c0, c1, bad, exempt, range: [lo, hi], spikeThresh }
}
