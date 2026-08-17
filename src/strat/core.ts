/**
 * TypeScript port of the core stratigraph operations (Sylvester, Straub &
 * Covault 2024). Validated against the Python pipeline in src/strat/validate.ts.
 *
 * Data layout convention: sections are (n, nt) location-major Float32Arrays —
 * one location's elevation history is contiguous, matching the time-last layout
 * of the grid3d bundles.
 */

import type { Dataset } from '../data/loader'
import type { NdArray } from '../data/ndarray'
import type { SpaceGrid3d, SpaceSection2d } from '../data/types'
import type { GridClean } from '../plot/three/gridClean'

export interface Section {
  /** number of points along the section */
  n: number
  /** number of time steps */
  nt: number
  /** distance coordinate of each point, in space units */
  x: Float64Array
  /**
   * Absolute grid index (along the section axis) of point 0. Nonzero when the
   * section is cropped to the clean sub-grid: the shared probe/hover indices
   * are ABSOLUTE, so panels map them through `localIndex`.
   */
  offset: number
  /**
   * Per-point pen-up mask (1 = draw no strata or surface lines through this
   * point), from the constant-fill plateau wedges; null when there are none.
   */
  skip: Uint8Array | null
  /** (n, nt) topographic elevation */
  topo: Float32Array
  /** (n, nt) basement elevation (subsidence/uplift history), or null */
  subsid: Float32Array | null
  /**
   * Deformation convention. 'snapshot' (default): topo[i] was measured at
   * time i, so each surface retro-deforms by its own subsidence
   * (+subsid[k]-subsid[i]). 'final-datum': topo[i] is stored in its FINAL
   * position (e.g. surfaces digitized from a completed diagram), so the whole
   * stack shifts uniformly by subsid[k]-subsid[nt-1].
   */
  deformation: 'snapshot' | 'final-datum'
  /**
   * (n, nt-1) deposition/erosion/stasis classification (+1/-1/0).
   * From the float64 Python pipeline where shipped (grid3d); computed with
   * `classify` otherwise. End-time independent.
   */
  cls: Int8Array
}

export type SectionAxis = 'dip' | 'strike'

/**
 * Local index into a (possibly cropped) section for an ABSOLUTE grid index —
 * the frame the shared probe/hover state lives in. Clamped to the section.
 */
export function localIndex(sec: Section, absolute: number): number {
  return Math.min(sec.n - 1, Math.max(0, absolute - sec.offset))
}

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
 * Retro-deform a section to the datum of time step k. 'snapshot' data:
 * topoS[j,i] = topo[j,i] + (subsid[j,k] - subsid[j,i]). 'final-datum' data:
 * the whole stack shifts by subsid[j,k] - subsid[j,nt-1] (zero at k = nt-1).
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
    if (sec.deformation === 'final-datum') {
      const shift = sk - subsid[base + nt - 1]
      for (let i = 0; i < nt; i++) {
        r[base + i] = topo[base + i] + shift
      }
    } else {
      for (let i = 0; i < nt; i++) {
        r[base + i] = topo[base + i] + sk - subsid[base + i]
      }
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

/** Inclusive [lo, hi] extent of a section along its own axis. */
export function sectionExtent(
  space: SpaceGrid3d,
  axis: SectionAxis,
  clean: GridClean | null,
): [number, number] {
  const [nRows, nCols] = space.shape
  if (axis === 'dip') return clean ? [clean.c0, clean.c1] : [0, nCols - 1]
  return clean ? [clean.r0, clean.r1] : [0, nRows - 1]
}

/**
 * Gather a dip or strike section from a grid3d dataset's volumes. With a
 * gridClean analysis the section is the DISPLAY section — cropped to the
 * clean sub-grid, despiked, basement-clamped, plateau wedges masked — i.e.
 * exactly what the 3D block diagram drapes on its walls. Pass null for the
 * raw section (validation against the Python pipeline).
 */
export async function gridSection(
  dataset: Dataset,
  axis: SectionAxis,
  index: number,
  clean: GridClean | null,
): Promise<Section> {
  const m = dataset.manifest
  const space = m.space as SpaceGrid3d
  const nt = m.time.n
  // subsid is optional: experiments scanned in an absolute frame don't have one
  const hasSubsid = !!m.arrays.subsid
  const [topoV, subsidV, clsV] = await Promise.all([
    dataset.array('topo'),
    hasSubsid ? dataset.array('subsid') : Promise.resolve(null),
    dataset.array('wheelerClass'),
  ])
  const [lo, hi] = sectionExtent(space, axis, clean)
  return gridSectionSlice(topoV, subsidV, space, nt, axis, index, lo, hi, { clean, cls: clsV })
}

export interface SliceOpts {
  /**
   * Display cleanup to apply (plot/three/gridClean.ts). When present, spike
   * cells are interpolated away, topo is clamped to the basement, and the
   * plateau wedges become the section's `skip` mask. Null/absent = raw.
   */
  clean?: GridClean | null
  /** classification volume to slice alongside (derived/wheelerClass) */
  cls?: NdArray | null
}

/**
 * Slice a dip/strike section from already-loaded grid3d volumes, restricted
 * to [lo, hi] (inclusive) along the section, with x in ABSOLUTE grid
 * coordinates so callers can place it in world space.
 *
 * With a clean analysis: spike-flagged points are linearly interpolated from
 * their nearest clean neighbors along the section (the whole elevation
 * history), so top edges and bounds stay sane; topo is clamped to the
 * basement, because a sediment surface below the basement is physically
 * impossible but the XES-02 scans contain such holes (up to ~240 mm deep in
 * the distal basin) and the running-minimum stratigraphy preserves them
 * forever; and the constant-fill plateau wedges become the `skip` mask.
 */
export function gridSectionSlice(
  topoV: NdArray,
  subsidV: NdArray | null,
  space: SpaceGrid3d,
  nt: number,
  axis: SectionAxis,
  index: number,
  lo: number,
  hi: number,
  opts?: SliceOpts,
): Section {
  const [nRows, nCols] = space.shape
  const [dRow, dCol] = space.spacing
  const n = hi - lo + 1
  const tSrc = topoV.data as Float32Array
  const sSrc = subsidV ? (subsidV.data as Float32Array) : null
  const clean = opts?.clean ?? null
  const bad = clean?.bad
  const idx =
    axis === 'dip'
      ? Math.min(nRows - 1, Math.max(0, index))
      : Math.min(nCols - 1, Math.max(0, index))

  const cellOf = (j: number) =>
    axis === 'dip' ? idx * nCols + (lo + j) : (lo + j) * nCols + idx

  let topo: Float32Array
  let subsid: Float32Array | null = null
  if (axis === 'dip') {
    topo = tSrc.subarray((idx * nCols + lo) * nt, (idx * nCols + hi + 1) * nt)
    if (sSrc) subsid = sSrc.subarray((idx * nCols + lo) * nt, (idx * nCols + hi + 1) * nt)
  } else {
    topo = new Float32Array(n * nt)
    if (sSrc) subsid = new Float32Array(n * nt)
    for (let j = 0; j < n; j++) {
      const src = ((lo + j) * nCols + idx) * nt
      topo.set(tSrc.subarray(src, src + nt), j * nt)
      if (subsid && sSrc) subsid.set(sSrc.subarray(src, src + nt), j * nt)
    }
  }

  if (bad) {
    let any = false
    for (let j = 0; j < n; j++) {
      if (bad[cellOf(j)]) {
        any = true
        break
      }
    }
    if (any) {
      if (axis === 'dip') topo = new Float32Array(topo) // don't mutate the cached volume
      // interpolate each maximal bad run from its clean endpoints
      let j = 0
      while (j < n) {
        if (!bad[cellOf(j)]) {
          j++
          continue
        }
        let j1 = j
        while (j1 + 1 < n && bad[cellOf(j1 + 1)]) j1++
        const a = j - 1 // clean left neighbor (or -1)
        const b = j1 + 1 // clean right neighbor (or n)
        for (let i = 0; i < nt; i++) {
          const va = a >= 0 ? topo[a * nt + i] : NaN
          const vb = b < n ? topo[b * nt + i] : NaN
          for (let jj = j; jj <= j1; jj++) {
            let v: number
            if (a >= 0 && b < n) {
              const t = (jj - a) / (b - a)
              v = va + t * (vb - va)
            } else {
              v = a >= 0 ? va : vb
            }
            if (Number.isFinite(v)) topo[jj * nt + i] = v
          }
        }
        j = j1 + 1
      }
    }
  }

  if (clean && subsid) {
    let violates = false
    for (let i = 0; i < n * nt; i++) {
      if (topo[i] < subsid[i]) {
        violates = true
        break
      }
    }
    if (violates) {
      if (axis === 'dip') topo = new Float32Array(topo) // may be a cache view
      for (let i = 0; i < n * nt; i++) {
        if (topo[i] < subsid[i]) topo[i] = subsid[i]
      }
    }
  }

  // pen-up mask where the section crosses a constant-fill plateau wedge: the
  // painter leaves the wedge as solid basement up to the plateau level
  let skip: Uint8Array | null = null
  if (clean) {
    const mask = new Uint8Array(n)
    let any = false
    for (let j = 0; j < n; j++) {
      if (clean.exempt[cellOf(j)]) {
        mask[j] = 1
        any = true
      }
    }
    if (any) skip = mask
  }

  // classification (deposition/erosion/stasis), sliced to the same window
  let cls = new Int8Array(0)
  const clsSrc = opts?.cls ? (opts.cls.data as Int8Array) : null
  if (clsSrc) {
    const ni = nt - 1
    if (axis === 'dip') {
      cls = clsSrc.subarray((idx * nCols + lo) * ni, (idx * nCols + hi + 1) * ni) as Int8Array
    } else {
      cls = new Int8Array(n * ni)
      for (let j = 0; j < n; j++) {
        const src = ((lo + j) * nCols + idx) * ni
        cls.set(clsSrc.subarray(src, src + ni), j * ni)
      }
    }
  }

  const step = axis === 'dip' ? dCol : dRow
  const x = Float64Array.from({ length: n }, (_, j) => (lo + j) * step)
  return { n, nt, x, offset: lo, skip, topo, subsid, cls, deformation: 'snapshot' }
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
  const deformation =
    m.processing.deformation === 'final-datum' ? 'final-datum' : 'snapshot'
  return { n: nx, nt, x, offset: 0, skip: null, topo, subsid, cls, deformation }
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
