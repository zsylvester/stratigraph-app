/**
 * TypeScript port of the core stratigraph operations (Sylvester, Straub &
 * Covault 2024). Validated against the Python pipeline in src/strat/validate.ts.
 *
 * Data layout convention: sections are (n, nt) location-major Float32Arrays —
 * one location's elevation history is contiguous, matching the time-last layout
 * of the grid3d bundles.
 */

import type { Dataset } from '../data/loader'
import type { SpaceGrid3d, SpaceSection2d } from '../data/types'

export interface Section {
  /** number of points along the section */
  n: number
  /** number of time steps */
  nt: number
  /** distance coordinate of each point, in space units */
  x: Float64Array
  /** (n, nt) topographic elevation */
  topo: Float32Array
  /** (n, nt) basement elevation (subsidence/uplift history), or null */
  subsid: Float32Array | null
  /**
   * (n, nt-1) deposition/erosion/stasis classification (+1/-1/0).
   * From the float64 Python pipeline where shipped (grid3d); computed with
   * `classify` otherwise. End-time independent.
   */
  cls: Int8Array
}

export type SectionAxis = 'dip' | 'strike'

/** Threshold smoothing + diff sign, matching create_wheeler_diagram's masking. */
export function classify(e: Float32Array | Float64Array, n0: number, nt: number, res: number, out: Int8Array, o0: number): void {
  // smoothed series state machine (smooth_elevation_series): a sample only
  // registers when it moves >= res away from the last registered level
  let etaOld = e[n0]
  let smPrev = e[n0]
  for (let i = 1; i < nt; i++) {
    const v = e[n0 + i]
    const sm = Math.abs(v - etaOld) >= res ? ((etaOld = v), v) : etaOld
    const d = sm - smPrev
    // wheeler = raw diff where smoothed diff != 0; classification is its sign
    out[o0 + i - 1] = d !== 0 ? Math.sign(e[n0 + i] - e[n0 + i - 1]) as -1 | 0 | 1 : 0
    smPrev = sm
  }
}

/**
 * Retro-deform a section to the datum of time step k:
 * topoS[j,i] = topo[j,i] + (subsid[j,k] - subsid[j,i]).
 * With no subsidence array this is a copy.
 */
export function retroDeform(sec: Section, k: number, out?: Float32Array): Float32Array {
  const { n, nt, topo, subsid } = sec
  const r = out ?? new Float32Array(n * nt)
  if (!subsid) {
    r.set(topo)
    return r
  }
  for (let j = 0; j < n; j++) {
    const base = j * nt
    const sk = subsid[base + k]
    for (let i = 0; i < nt; i++) {
      r[base + i] = topo[base + i] + sk - subsid[base + i]
    }
  }
  return r
}

/**
 * Preserved stratigraphy up to time step k (inclusive): reverse cumulative
 * minimum of topoS over [0..k] per location (topostrat). Entries > k are
 * left untouched.
 */
export function stratUpTo(topoS: Float32Array, n: number, nt: number, k: number, out?: Float32Array): Float32Array {
  const r = out ?? new Float32Array(n * nt)
  for (let j = 0; j < n; j++) {
    const base = j * nt
    let m = topoS[base + k]
    r[base + k] = m
    for (let i = k - 1; i >= 0; i--) {
      const v = topoS[base + i]
      if (v < m) m = v
      r[base + i] = m
    }
  }
  return r
}

/**
 * wheeler_strat values for display up to time k: preserved deposition
 * thickness (>0), erosion magnitude (<0, raw elevation drop), 0 for stasis
 * and vacuity — matching create_wheeler_diagram.
 */
export function wheelerStrat(
  sec: Section,
  topoS: Float32Array,
  strat: Float32Array,
  k: number,
  out?: Float32Array,
): Float32Array {
  const { n, nt, cls } = sec
  const r = out ?? new Float32Array(n * (nt - 1))
  for (let j = 0; j < n; j++) {
    const bt = j * nt
    const bc = j * (nt - 1)
    for (let i = 0; i < k; i++) {
      const c = cls[bc + i]
      r[bc + i] =
        c === 0 ? 0 : c < 0 ? topoS[bt + i + 1] - topoS[bt + i] : strat[bt + i + 1] - strat[bt + i]
    }
  }
  return r
}

/** Gather a dip or strike section from a grid3d dataset's volumes. */
export async function gridSection(dataset: Dataset, axis: SectionAxis, index: number): Promise<Section> {
  const m = dataset.manifest
  const space = m.space as SpaceGrid3d
  const [nRows, nCols] = space.shape
  const [dRow, dCol] = space.spacing
  const nt = m.time.n
  // subsid is optional: experiments scanned in an absolute frame don't have one
  const hasSubsid = !!m.arrays.subsid
  const [topoV, subsidV, clsV] = await Promise.all([
    dataset.array('topo'),
    hasSubsid ? dataset.array('subsid') : Promise.resolve(null),
    dataset.array('wheelerClass'),
  ])

  if (axis === 'dip') {
    // fix a row: contiguous (nCols, nt) block
    const r = Math.min(nRows - 1, Math.max(0, index))
    const x = Float64Array.from({ length: nCols }, (_, j) => j * dCol)
    return {
      n: nCols,
      nt,
      x,
      topo: topoV.pick(r).data as Float32Array,
      subsid: subsidV ? (subsidV.pick(r).data as Float32Array) : null,
      cls: clsV.pick(r).data as Int8Array,
    }
  }
  // strike: fix a column, gather across rows
  const c = Math.min(nCols - 1, Math.max(0, index))
  const x = Float64Array.from({ length: nRows }, (_, j) => j * dRow)
  const topo = new Float32Array(nRows * nt)
  const subsid = subsidV ? new Float32Array(nRows * nt) : null
  const cls = new Int8Array(nRows * (nt - 1))
  for (let r = 0; r < nRows; r++) {
    const src = (r * nCols + c) * nt
    topo.set((topoV.data as Float32Array).subarray(src, src + nt), r * nt)
    if (subsid && subsidV) {
      subsid.set((subsidV.data as Float32Array).subarray(src, src + nt), r * nt)
    }
    const srcC = (r * nCols + c) * (nt - 1)
    cls.set((clsV.data as Int8Array).subarray(srcC, srcC + (nt - 1)), r * (nt - 1))
  }
  return { n: nRows, nt, x, topo, subsid, cls }
}

/** Build the (single) section of a section2d dataset; computes classification. */
export async function section2d(dataset: Dataset): Promise<Section> {
  const m = dataset.manifest
  const space = m.space as SpaceSection2d
  const nt = m.time.n
  const nx = space.nx
  const [topoA, subsidA] = await Promise.all([dataset.array('topo'), dataset.array('subsid')])
  // stored (nt, nx) time-major; transpose to location-major (nx, nt)
  const topo = new Float32Array(nx * nt)
  const subsid = new Float32Array(nx * nt)
  const tSrc = topoA.data as Float32Array
  const sSrc = subsidA.data as Float32Array
  for (let i = 0; i < nt; i++) {
    for (let j = 0; j < nx; j++) {
      topo[j * nt + i] = tSrc[i * nx + j]
      subsid[j * nt + i] = sSrc[i * nx + j]
    }
  }
  const cls = new Int8Array(nx * (nt - 1))
  const res = m.processing.resolution
  // classification on the surfaces as stored (no retro-deformation), matching
  // the notebook's create_wheeler_diagram_2D(topo1.T, res)
  for (let j = 0; j < nx; j++) classify(topo, j * nt, nt, res, cls, j * (nt - 1))
  const x = Float64Array.from({ length: nx }, (_, j) => space.x0 + j * space.dx)
  return { n: nx, nt, x, topo, subsid, cls }
}

/**
 * Elevation range for stable framing. Lower bound from the final preserved
 * stratigraphy; upper bound must ALSO cover the raw topography, because the
 * active surface displayed at time k is topo[k] itself, which can stand higher
 * than anything ultimately preserved (later transgression/erosion removes it).
 */
export function sectionBounds(sec: Section): { lo: number; hi: number } {
  const { n, nt } = sec
  const topoS = retroDeform(sec, nt - 1)
  const strat = stratUpTo(topoS, n, nt, nt - 1)
  let lo = Infinity
  let hi = -Infinity
  for (const v of strat) {
    if (Number.isFinite(v)) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  for (const v of sec.topo) {
    if (Number.isFinite(v) && v > hi) hi = v
  }
  return { lo, hi }
}
