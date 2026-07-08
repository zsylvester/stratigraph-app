/**
 * DOM-free painter for the geology body of a cross section: basement, layer
 * fills (age or water-depth facies), stratigraphic surface lines, current
 * topography, water, and erosional surfaces — everything between the axes
 * chrome and the interactive markers. Extracted from CrossSectionPanel so the
 * 3D block-diagram walls can render the exact same section image into
 * offscreen canvases (where getComputedStyle is unavailable — theme colors
 * are passed in).
 */

import type { Section } from '../strat/core'
import { retroDeform, stratUpTo } from '../strat/core'
import {
  css,
  FACIES_COLORS,
  hexToRgb,
  LAYER_FACIES_COLORS,
  viridis,
} from '../strat/colormaps'
import { Frame, xPix, yPix } from './frame'

/** Theme colors used by the painter (a subset of plot/frame's themeColors). */
export interface SectionTheme {
  ink: string
  inkSoft: string
  paper3: string
  dep: string
  ero: string
  vac: string
}

export interface SectionPaintOpts {
  /** sea level per time step (water fill + water-depth facies), or null */
  seaLevel: Float64Array | null
  /** per-layer facies codes (e.g. meanderpy point bar / levee), or null */
  layerFacies: Int8Array | null
  colorMode: 'age' | 'facies'
  /** facies water-depth bins (manifest processing.faciesDepthBins) */
  bins: number[]
  /** heavier-drawn key surfaces (manifest keySurfaceIndices) */
  keySurfaceIndices?: number[]
  /** draw erosional-surface overlay (red) */
  showErosion: boolean
  /** vertical resolution threshold for the erosion overlay */
  erosionRes: number
  /** fill the water body between sea level and submerged topography */
  drawWater: boolean
  /**
   * Width multiplier for the stratigraphic surface lines (default 1). The 3D
   * walls paint into large textures that the GPU then minifies — hairline
   * surfaces average away, so they are drawn heavier there.
   */
  lineScale?: number
  /** opacity of the non-key surface lines (default 0.55) */
  lineAlpha?: number
  /**
   * Per-point pen-up mask (1 = draw no strata or surface lines through this
   * point). Used by the 3D walls where the section crosses a constant-fill
   * plateau wedge (XES-02 corner fix): polygons bridging the fill boundary
   * collapse into a needle of slivers. The basement fill still spans masked
   * points — the wedge IS solid material up to the plateau level.
   */
  skipMask?: Uint8Array
}

/**
 * Paint preserved stratigraphy up to time step kk into frame f. Clips to the
 * frame rect (saved/restored). Returns the retro-deformed surfaces and
 * preserved stratigraphy so callers can draw on top without recomputing.
 */
export function paintSectionBody(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  sec: Section,
  kk: number,
  theme: SectionTheme,
  opts: SectionPaintOpts,
): { topoS: Float32Array; strat: Float32Array } {
  const { n, nt, x } = sec
  const { seaLevel, layerFacies, bins } = opts

  const topoS = retroDeform(sec, kk)
  const strat = stratUpTo(topoS, n, nt, kk)

  // maximal drawable runs of the section (pen up across masked points)
  const skip = opts.skipMask
  const runs: Array<[number, number]> = []
  if (skip) {
    let j = 0
    while (j < n) {
      if (skip[j]) {
        j++
        continue
      }
      let j1 = j
      while (j1 + 1 < n && !skip[j1 + 1]) j1++
      if (j1 > j) runs.push([j, j1])
      j = j1 + 1
    }
  } else {
    runs.push([0, n - 1])
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(f.x0, f.y0, f.w, f.h)
  ctx.clip()

  // Basement: below the oldest preserved surface. Across pen-up (plateau
  // wedge) intervals the outline is raised to the interval's top level with
  // VERTICAL edges flush against the neighboring strata — otherwise a
  // see-through slot opens between the deposit edge and the wedge column
  // (the masked ring cells have deep basal surfaces but no strata drawn).
  const bTopPts: Array<[number, number]> = [] // [x, elevation]
  if (skip) {
    let j = 0
    while (j < n) {
      if (!skip[j]) {
        bTopPts.push([x[j], strat[j * nt]])
        j++
        continue
      }
      const a = j
      let level = -Infinity
      while (j < n && skip[j]) {
        level = Math.max(level, strat[j * nt])
        j++
      }
      // flush vertical rise at the strata edge, flat across the masked
      // interval, flush vertical drop at the far edge
      bTopPts.push([x[a > 0 ? a - 1 : a], level], [x[j < n ? j : j - 1], level])
    }
  } else {
    for (let j = 0; j < n; j++) bTopPts.push([x[j], strat[j * nt]])
  }
  ctx.beginPath()
  ctx.moveTo(xPix(f, bTopPts[0][0]), f.y0 + f.h)
  for (const [bx, by] of bTopPts) ctx.lineTo(xPix(f, bx), yPix(f, by))
  ctx.lineTo(xPix(f, bTopPts[bTopPts.length - 1][0]), f.y0 + f.h)
  ctx.closePath()
  ctx.fillStyle = theme.paper3
  ctx.fill()
  ctx.strokeStyle = theme.inkSoft
  ctx.lineWidth = 1
  ctx.stroke()

  // Water-depth facies, matching split_layer_by_bathymetry: each layer is cut
  // by the coeval sea level and the shallow/deep boundary. In the 'unsubsided'
  // frame (display elevation minus the subsidence correction) those boundaries
  // are horizontal lines, so the sub-polygons come from a plain
  // Sutherland–Hodgman clip against a horizontal band — computed geometrically
  // and filled directly. (An earlier canvas-clip implementation cost ~900
  // clip layers per frame and broke down on large maximized canvases.)
  type UV = { x: number; yU: number; sh: number }
  const clipHalf = (pts: UV[], below: boolean, yCut: number): UV[] => {
    const out: UV[] = []
    const keep = (v: UV) => (below ? v.yU <= yCut : v.yU >= yCut)
    for (let a = 0; a < pts.length; a++) {
      const p = pts[a]
      const q = pts[(a + 1) % pts.length]
      const kp = keep(p)
      if (kp) out.push(p)
      if (kp !== keep(q)) {
        const t = (yCut - p.yU) / (q.yU - p.yU)
        out.push({ x: p.x + t * (q.x - p.x), yU: yCut, sh: p.sh + t * (q.sh - p.sh) })
      }
    }
    return out
  }
  // per-vertex unsubsided top/base + subsidence shift, reused across layers
  const topU = new Float64Array(n)
  const baseU = new Float64Array(n)
  const shU = new Float64Array(n)
  const drawSplitLayer = (i: number) => {
    const sl = seaLevel![Math.min(nt - 1, i + 1)]
    const b1 = sl + bins[0] // paleo-shoreline
    const b2 = sl + bins[1] // shallow/deep boundary

    let lo = Infinity
    let hi = -Infinity
    for (let j = 0; j < n; j++) {
      const sh = sec.subsid ? sec.subsid[j * nt + kk] - sec.subsid[j * nt + i + 1] : 0
      shU[j] = sh
      const t = strat[j * nt + i + 1] - sh
      const b = strat[j * nt + i] - sh
      topU[j] = t
      baseU[j] = b
      if (b < lo) lo = b
      if (t > hi) hi = t
    }

    // Clip CELL BY CELL: each cell's layer piece is a simple quad, so the
    // half-plane clips can never bridge disjoint pieces (the whole-ring
    // approach produced spurious connecting bands where layers pinch to
    // zero thickness). All pieces of a band go into one multi-subpath fill.
    const quad: UV[] = [
      { x: 0, yU: 0, sh: 0 },
      { x: 0, yU: 0, sh: 0 },
      { x: 0, yU: 0, sh: 0 },
      { x: 0, yU: 0, sh: 0 },
    ]
    const fillBand = (bLo: number, bHi: number, color: string) => {
      const path = new Path2D()
      let any = false
      for (let j = 0; j < n - 1; j++) {
        if (skip && (skip[j] || skip[j + 1])) continue
        // quick reject: cell entirely outside the band
        if (Math.max(topU[j], topU[j + 1]) < bLo) continue
        if (Math.min(baseU[j], baseU[j + 1]) > bHi) continue
        quad[0].x = x[j]
        quad[0].yU = topU[j]
        quad[0].sh = shU[j]
        quad[1].x = x[j + 1]
        quad[1].yU = topU[j + 1]
        quad[1].sh = shU[j + 1]
        quad[2].x = x[j + 1]
        quad[2].yU = baseU[j + 1]
        quad[2].sh = shU[j + 1]
        quad[3].x = x[j]
        quad[3].yU = baseU[j]
        quad[3].sh = shU[j]
        let pts: UV[] = quad
        if (bHi !== Infinity) pts = clipHalf(pts, true, bHi)
        if (bLo !== -Infinity && pts.length) pts = clipHalf(pts, false, bLo)
        if (pts.length < 3) continue
        path.moveTo(xPix(f, pts[0].x), yPix(f, pts[0].yU + pts[0].sh))
        for (let a = 1; a < pts.length; a++) {
          path.lineTo(xPix(f, pts[a].x), yPix(f, pts[a].yU + pts[a].sh))
        }
        path.closePath()
        any = true
      }
      if (!any) return
      ctx.fillStyle = color
      ctx.fill(path)
      ctx.strokeStyle = color
      ctx.lineWidth = 0.75
      ctx.stroke(path)
    }

    // fluvial above the paleo-shoreline, shallow between, deep below
    if (hi >= b1) fillBand(b1, Infinity, FACIES_COLORS[0])
    if (hi >= b2 && lo <= b1) fillBand(b2, b1, FACIES_COLORS[1])
    if (lo <= b2) fillBand(-Infinity, b2, FACIES_COLORS[2])
  }

  const fillPolyRun = (i: number, j0: number, j1: number, color: string) => {
    ctx.beginPath()
    for (let j = j0; j <= j1; j++) {
      const px = xPix(f, x[j])
      const py = yPix(f, strat[j * nt + i])
      if (j === j0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    for (let j = j1; j >= j0; j--) {
      ctx.lineTo(xPix(f, x[j]), yPix(f, strat[j * nt + i + 1]))
    }
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    // stroke with the fill color to close antialiasing seams between layers
    ctx.strokeStyle = color
    ctx.lineWidth = 0.75
    ctx.stroke()
  }

  // layers up to the current time step (stable colors during playback)
  const faciesMode = opts.colorMode === 'facies' && (layerFacies !== null || seaLevel !== null)
  for (let i = 0; i < kk; i++) {
    if (!faciesMode) {
      const color = css(viridis(i / Math.max(1, nt - 2)))
      for (const [a, b] of runs) fillPolyRun(i, a, b, color)
    } else if (layerFacies) {
      // per-layer facies (e.g. meanderpy point bar / levee); erosion sub-steps
      // leave no deposit, so their color rarely shows — use the vacuity tone
      const lf = layerFacies[i]
      const color = lf >= 0 ? LAYER_FACIES_COLORS[lf] : theme.vac
      for (const [a, b] of runs) fillPolyRun(i, a, b, color)
    } else {
      drawSplitLayer(i)
    }
  }

  // thin black stratigraphic surface lines (condensed zones read darker);
  // the manifest's key surfaces (originally digitized) are drawn heavier
  const keys = new Set<number>(opts.keySurfaceIndices ?? [])
  const lineFreq = Math.max(1, Math.ceil(nt / 80))
  const lineScale = opts.lineScale ?? 1
  const lineAlpha = opts.lineAlpha ?? 0.55
  ctx.strokeStyle = theme.ink
  for (let i = 0; i <= kk; i++) {
    const isKey = keys.has(i)
    if (!isKey && i % lineFreq !== 0) continue
    ctx.lineWidth = (isKey ? 0.7 : 0.35) * lineScale
    ctx.globalAlpha = isKey ? 1 : lineAlpha
    ctx.beginPath()
    for (const [a, b] of runs) {
      for (let j = a; j <= b; j++) {
        const px = xPix(f, x[j])
        const py = yPix(f, strat[j * nt + i])
        if (j === a) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // current topographic surface
  ctx.beginPath()
  for (const [a, b] of runs) {
    for (let j = a; j <= b; j++) {
      const px = xPix(f, x[j])
      const py = yPix(f, topoS[j * nt + kk])
      if (j === a) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
  }
  ctx.strokeStyle = theme.ink
  ctx.lineWidth = 1.4 * lineScale
  ctx.stroke()

  // water: fill between sea level and the submerged topographic surface,
  // like the notebook section plotters' plot_water option
  if (seaLevel && opts.drawWater) {
    const sl = seaLevel[kk]
    const [wr, wg, wb] = hexToRgb(theme.dep)
    ctx.fillStyle = `rgba(${wr}, ${wg}, ${wb}, 0.25)`
    const topoAt = (j: number) => topoS[j * nt + kk]
    // waterline crossing between j0 (dry) and j1 (wet)
    const shoreX = (j0: number, j1: number) =>
      x[j0] + ((sl - topoAt(j0)) / (topoAt(j1) - topoAt(j0))) * (x[j1] - x[j0])
    let j = 0
    while (j < n) {
      if (topoAt(j) < sl) {
        let j1 = j
        while (j1 + 1 < n && topoAt(j1 + 1) < sl) j1++
        const xa = j > 0 ? shoreX(j - 1, j) : x[0]
        const xb = j1 < n - 1 ? shoreX(j1 + 1, j1) : x[n - 1]
        ctx.beginPath()
        ctx.moveTo(xPix(f, xa), yPix(f, sl))
        ctx.lineTo(xPix(f, xb), yPix(f, sl))
        for (let jj = j1; jj >= j; jj--) {
          ctx.lineTo(xPix(f, x[jj]), yPix(f, topoAt(jj)))
        }
        ctx.closePath()
        ctx.fill()
        // water surface: solid line spanning only the water body
        ctx.beginPath()
        ctx.moveTo(xPix(f, xa), yPix(f, sl))
        ctx.lineTo(xPix(f, xb), yPix(f, sl))
        ctx.strokeStyle = theme.dep
        ctx.lineWidth = 1.2
        ctx.stroke()
        j = j1 + 1
      } else {
        j++
      }
    }
  }

  // erosional surfaces, drawn ON TOP of the layer/surface lines so they stay
  // visible: the preserved horizon of time i is a truncation surface wherever
  // the original time-i topography lay above it (vacuity)
  if (opts.showErosion) {
    const thresh = opts.erosionRes
    ctx.strokeStyle = theme.ero
    ctx.lineWidth = 1.8
    ctx.beginPath()
    for (let i = 1; i <= kk; i++) {
      let pen = false
      for (let j = 0; j < n; j++) {
        if (skip && skip[j]) {
          pen = false
          continue
        }
        if (topoS[j * nt + i] - strat[j * nt + i] > thresh) {
          const px = xPix(f, x[j])
          const py = yPix(f, strat[j * nt + i])
          if (pen) ctx.lineTo(px, py)
          else ctx.moveTo(px, py)
          pen = true
        } else {
          pen = false
        }
      }
    }
    ctx.stroke()
  }

  ctx.restore()
  return { topoS, strat }
}
