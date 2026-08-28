/**
 * Topography surface of the 3D block diagram: a heightfield mesh over a
 * window of the (nRows, nCols) grid (sub-blocks of exploded views pass their
 * own windows + world offsets). X/Z positions and the triangle index are
 * built once; per-time-step updates rewrite Y (strided gather from the
 * time-last topo volume), vertex colors, and normals — normals come from
 * central differences (O(verts), cheap enough for every playback step;
 * recomputing them only on pause left the start-of-playback relief shading
 * "imprinted" on the surface). Spike cells flagged by gridClean are replaced
 * with the median of their clean neighbors, display-only.
 * Y is raw elevation — vertical exaggeration is the caller's group.scale.y.
 */

import * as THREE from 'three'

import type { NdArray } from '../../data/ndarray'
import { deepR, hexToRgb } from '../../strat/colormaps'

export interface TopoDims {
  nRows: number
  nCols: number
  nt: number
  dRow: number
  dCol: number
}

export interface TopoWindow {
  r0: number
  r1: number
  c0: number
  c1: number
  /** world offset (exploded sub-blocks) */
  ox: number
  oz: number
}

/**
 * The surface always colors by elevation/bathymetry (like the map view) —
 * facies is a property of the DEPOSITS on the walls, not of the live
 * topography, so the facies toggle only affects the wall sections.
 */
export interface TopoColorOpts {
  /** sea level at the current step (subaerial wash), or null */
  seaLevel: number | null
  /** theme paper color (subaerial wash target) */
  paper: string
  /** fixed elevation color range over the whole run (stable playback colors) */
  range: [number, number]
  /**
   * Photo texture draped over the surface instead of elevation colors (the
   * mesh must have been built with a texExtent). Vertex colors go white so
   * the map shows unmodulated; heights, normals and lighting are unchanged.
   */
  texture?: THREE.Texture | null
}

export interface TopoMeshCtl {
  mesh: THREE.Mesh
  update(k: number, opts: TopoColorOpts): void
  dispose(): void
}

/** target vertex budget per mesh; larger windows are decimated by a stride */
const MAX_VERTS = 150_000

/** sRGB byte -> linear float LUT (three.js works in linear space) */
const S2L = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function buildTopoMesh(
  topo: NdArray,
  dims: TopoDims,
  win: TopoWindow,
  bad?: Uint8Array,
  /** plateau wedges + cliff ring (gridClean.exempt): rendered untouched */
  exempt?: Uint8Array,
  /** per-step dynamic despike threshold (gridClean.spikeThresh), or 0 */
  spikeThresh = 0,
  /**
   * Basement volume (same layout as topo): the sediment surface is clamped
   * to it — scan holes dip physically impossibly below the tank floor.
   */
  basement?: Float32Array | null,
  /**
   * Photo-texture coverage [x0, x1, y0, y1] in grid node coordinates: builds
   * the UV attribute so TopoColorOpts.texture can be draped.
   */
  texExtent?: [number, number, number, number] | null,
): TopoMeshCtl {
  const { nRows, nCols, nt, dRow, dCol } = dims
  const wr = win.r1 - win.r0 + 1
  const wc = win.c1 - win.c0 + 1
  const stride = Math.max(1, Math.ceil(Math.sqrt((wr * wc) / MAX_VERTS)))
  const nr = Math.floor((wr - 1) / stride) + 1
  const nc = Math.floor((wc - 1) / stride) + 1

  const nVerts = nr * nc
  const positions = new Float32Array(nVerts * 3)
  const colors = new Float32Array(nVerts * 3)
  const normals = new Float32Array(nVerts * 3)
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const v = (r * nc + c) * 3
      positions[v] = (win.c0 + c * stride) * dCol + win.ox // X: along dip
      positions[v + 1] = 0
      positions[v + 2] = (win.r0 + r * stride) * dRow + win.oz // Z: along strike
      normals[v + 1] = 1
    }
  }
  // UVs from UNOFFSET grid coordinates (exploded sub-blocks share the photo)
  let uvs: Float32Array | null = null
  if (texExtent) {
    const [tx0, tx1, ty0, ty1] = texExtent
    uvs = new Float32Array(nVerts * 2)
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        const v = (r * nc + c) * 2
        uvs[v] = ((win.c0 + c * stride) * dCol - tx0) / (tx1 - tx0)
        uvs[v + 1] = ((win.r0 + r * stride) * dRow - ty0) / (ty1 - ty0)
      }
    }
  }

  const index = new Uint32Array((nr - 1) * (nc - 1) * 6)
  let ii = 0
  for (let r = 0; r < nr - 1; r++) {
    for (let c = 0; c < nc - 1; c++) {
      const a = r * nc + c
      const b = a + 1
      const d = a + nc
      const e = d + 1
      // wind so face normals point up (+Y)
      index[ii++] = a
      index[ii++] = e
      index[ii++] = b
      index[ii++] = a
      index[ii++] = d
      index[ii++] = e
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  if (uvs) geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geom.setIndex(new THREE.BufferAttribute(index, 1))
  geom.setDrawRange(0, ii)

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geom, mat)

  const data = topo.data as Float32Array

  // Elevation at full-grid (R, C) for display: cells in the static spike
  // mask are always replaced by the median of their clean neighbors, and any
  // cell deviating beyond spikeThresh AT THIS STEP is replaced too (catches
  // transient scan noise without permanently smoothing real morphology —
  // the replacement only applies at steps where the cell actually spikes).
  // Allocation-free: this runs for every vertex on every step, and the
  // median of ≤4 values falls out of running sum/min/max.
  const sample = (R: number, C: number, k: number): number => {
    const cell = R * nCols + C
    // sediment below the coeval basement is a scan artifact — clamp
    const fl = basement ? basement[cell * nt + k] : -Infinity
    let v = data[cell * nt + k]
    if (v < fl) v = fl
    // plateau wedges (XES-02 corner fix) + their cliff: rendered as-is, like
    // the original stratigraph block diagrams
    if (exempt && exempt[cell]) return v
    const isBad = !!bad && bad[cell] === 1
    if (!isBad) {
      // the dynamic (per-step) despike only pays off near the scan margins —
      // interior transient deviations are real morphology (and interior scan
      // noise is persistent, i.e. statically masked). Skipping the interior
      // also skips 4 cache-hostile strided reads per vertex per step.
      if (spikeThresh <= 0) return v
      const nearEdge =
        R - win.r0 < 8 || win.r1 - R < 8 || C - win.c0 < 8 || win.c1 - C < 8
      if (!nearEdge) return v
    }
    let s = 0
    let mn = Infinity
    let mx = -Infinity
    let cnt = 0
    if (R > 0 && (!bad || !bad[cell - nCols])) {
      const u = data[(cell - nCols) * nt + k]
      if (Number.isFinite(u)) {
        s += u
        if (u < mn) mn = u
        if (u > mx) mx = u
        cnt++
      }
    }
    if (R < nRows - 1 && (!bad || !bad[cell + nCols])) {
      const u = data[(cell + nCols) * nt + k]
      if (Number.isFinite(u)) {
        s += u
        if (u < mn) mn = u
        if (u > mx) mx = u
        cnt++
      }
    }
    if (C > 0 && (!bad || !bad[cell - 1])) {
      const u = data[(cell - 1) * nt + k]
      if (Number.isFinite(u)) {
        s += u
        if (u < mn) mn = u
        if (u > mx) mx = u
        cnt++
      }
    }
    if (C < nCols - 1 && (!bad || !bad[cell + 1])) {
      const u = data[(cell + 1) * nt + k]
      if (Number.isFinite(u)) {
        s += u
        if (u < mn) mn = u
        if (u > mx) mx = u
        cnt++
      }
    }
    if (cnt === 0) return v
    // median of 1/2/3/4 values from sum, min, max (floored like v)
    let med =
      cnt === 1 ? s : cnt === 2 ? s / 2 : cnt === 3 ? s - mn - mx : (s - mn - mx) / 2
    if (med < fl) med = fl
    if (isBad) return med
    return Math.abs(v - med) > spikeThresh ? med : v
  }

  // photo mode caches: recompiling the material (map on/off) and flushing the
  // color buffer only happen on actual transitions, not every playback step
  let colorsWhite = false

  const update = (k: number, opts: TopoColorOpts) => {
    const [vmin, vmax] = opts.range
    const span = vmax - vmin || 1
    const sl = opts.seaLevel
    const [pr, pg, pb] = hexToRgb(opts.paper)

    const tex = opts.texture ?? null
    if (tex !== mat.map) {
      const hadMap = !!mat.map
      mat.map = tex
      // adding/removing the map changes the shader; swapping textures doesn't
      if (hadMap !== !!tex) mat.needsUpdate = true
    }
    if (tex) {
      // map * white = the photo; skip the per-vertex color computation
      if (!colorsWhite) {
        colors.fill(1)
        geom.attributes.color.needsUpdate = true
        colorsWhite = true
      }
      updateHeights(k, vmin)
      return
    }
    colorsWhite = false

    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        const vi = r * nc + c
        const y = sample(win.r0 + r * stride, win.c0 + c * stride, k)
        const ok = Number.isFinite(y)
        positions[vi * 3 + 1] = ok ? y : vmin
        let rr: number
        let gg: number
        let bb: number
        if (!ok) {
          rr = pr
          gg = pg
          bb = pb
        } else {
          ;[rr, gg, bb] = deepR((y - vmin) / span)
          if (sl !== null && y >= sl) {
            // subaerial: wash toward the paper color so land reads as land
            rr = rr + (pr - rr) * 0.55
            gg = gg + (pg - gg) * 0.55
            bb = bb + (pb - bb) * 0.55
          }
        }
        colors[vi * 3] = S2L[rr & 255]
        colors[vi * 3 + 1] = S2L[gg & 255]
        colors[vi * 3 + 2] = S2L[bb & 255]
      }
    }

    geom.attributes.color.needsUpdate = true
    finishGeometry()
  }

  /** heights only (photo mode: colors are a constant white) */
  function updateHeights(k: number, vmin: number) {
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        const y = sample(win.r0 + r * stride, win.c0 + c * stride, k)
        positions[(r * nc + c) * 3 + 1] = Number.isFinite(y) ? y : vmin
      }
    }
    finishGeometry()
  }

  /** normals from the updated heightfield + attribute flags */
  function finishGeometry() {
    // heightfield normals by central differences (one-sided at the borders);
    // vertical exaggeration is a parent scale, corrected by the normalMatrix
    const dx = stride * dCol
    const dz = stride * dRow
    const yAt = (r: number, c: number) => positions[(r * nc + c) * 3 + 1]
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        const cl = c > 0 ? c - 1 : c
        const cr = c < nc - 1 ? c + 1 : c
        const ru = r > 0 ? r - 1 : r
        const rd = r < nr - 1 ? r + 1 : r
        const gx = (yAt(r, cr) - yAt(r, cl)) / ((cr - cl) * dx || 1)
        const gz = (yAt(rd, c) - yAt(ru, c)) / ((rd - ru) * dz || 1)
        const inv = 1 / Math.hypot(gx, 1, gz)
        const vi = (r * nc + c) * 3
        normals[vi] = -gx * inv
        normals[vi + 1] = inv
        normals[vi + 2] = -gz * inv
      }
    }
    geom.attributes.position.needsUpdate = true
    geom.attributes.normal.needsUpdate = true
    geom.computeBoundingSphere()
  }

  return {
    mesh,
    update,
    dispose: () => {
      geom.dispose()
      mat.dispose()
    },
  }
}
