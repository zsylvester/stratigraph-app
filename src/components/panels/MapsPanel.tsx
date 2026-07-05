import { useEffect, useRef, useState } from 'react'

import type { Dataset } from '../../data/loader'
import type { NdArray } from '../../data/ndarray'
import type { SpaceGrid3d } from '../../data/types'
import { drawHColorbar } from '../../plot/colorbar'
import { boxBlur3, contourLevels, drawContour } from '../../plot/contours'
import { themeColors } from '../../plot/frame'
import { deepR, hexToRgb } from '../../strat/colormaps'
import { useAppStore } from '../../state/store'

type MapMode = 'topography' | 'thickness'

/** ms between thickness recomputes while the time step is moving */
const RECOMPUTE_THROTTLE = 150

interface Volumes {
  topo: NdArray
  subsid: NdArray | null
  seaLevel: Float64Array | null
  /** fixed topo color range over the whole run */
  topoRange: [number, number]
  /** deposit thickness range over the whole run */
  thicknessRange: [number, number]
}

/**
 * Map view: contoured topography at the current time step (shoreline
 * highlighted), or contoured deposit thickness accumulated up to it.
 * Doubles as the section picker: click/drag moves the section.
 */
export function MapsPanel({ dataset }: { dataset: Dataset }) {
  const timeStep = useAppStore((s) => s.timeStep)
  const sectionAxis = useAppStore((s) => s.sectionAxis)
  const sectionIndex = useAppStore((s) => s.sectionIndex)
  const setSection = useAppStore((s) => s.setSection)
  const hover = useAppStore((s) => s.hover)
  const setHover = useAppStore((s) => s.setHover)
  const xZoom = useAppStore((s) => s.xZoom) // cross-section zoom window
  const probeIndex = useAppStore((s) => s.probeIndex) // Barrell column location
  const [mode, setMode] = useState<MapMode>('topography')
  const uiTheme = useAppStore((s) => s.theme) // redraw when the theme flips
  const [volumes, setVolumes] = useState<Volumes | null>(null)
  const [field, setField] = useState<{ data: Float32Array; k: number; mode: MapMode } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef(false)

  const space = dataset.manifest.space as SpaceGrid3d
  const [nRows, nCols] = space.shape
  const [dRow, dCol] = space.spacing
  const nt = dataset.manifest.time.n
  const nLoc = nRows * nCols

  useEffect(() => {
    let cancelled = false
    setVolumes(null)
    setField(null)
    const m = dataset.manifest
    void Promise.all([
      dataset.array('topo'),
      m.arrays.subsid ? dataset.array('subsid') : Promise.resolve(null),
      m.arrays.seaLevel ? dataset.array('seaLevel') : Promise.resolve(null),
    ]).then(([topo, subsid, sl]) => {
      if (cancelled) return
      const t = topo.data as Float32Array
      let lo = Infinity
      let hi = -Infinity
      for (const v of t) {
        if (Number.isFinite(v)) {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
      const thickness = computeThickness(topo, subsid, nLoc, nt, nt - 1)
      let thMax = 0
      for (const v of thickness) if (Number.isFinite(v) && v > thMax) thMax = v
      setVolumes({
        topo,
        subsid,
        seaLevel: sl ? (sl.data as Float64Array) : null,
        topoRange: [lo, hi],
        thicknessRange: [0, thMax],
      })
    })
    return () => {
      cancelled = true
    }
  }, [dataset, nLoc, nt])

  // build the displayed field when time/mode changes (thickness throttled)
  const pendingRef = useRef<number | null>(null)
  const lastRunRef = useRef(0)
  useEffect(() => {
    if (!volumes) return
    const kk = Math.min(timeStep, nt - 1)
    const run = () => {
      lastRunRef.current = performance.now()
      const data =
        mode === 'topography'
          ? topoSlice(volumes.topo, nRows, nCols, kk)
          : computeThickness(volumes.topo, volumes.subsid, nLoc, nt, kk)
      setField({ data: boxBlur3(data, nRows, nCols), k: kk, mode })
    }
    if (mode === 'topography') {
      run() // just a slice + blur, cheap enough per frame
      return
    }
    const since = performance.now() - lastRunRef.current
    if (pendingRef.current !== null) window.clearTimeout(pendingRef.current)
    if (since >= RECOMPUTE_THROTTLE) run()
    else pendingRef.current = window.setTimeout(run, RECOMPUTE_THROTTLE - since)
    return () => {
      if (pendingRef.current !== null) window.clearTimeout(pendingRef.current)
    }
  }, [volumes, timeStep, mode, nRows, nCols, nLoc, nt])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !field || !volumes) return
    const draw = () =>
      drawMap(canvas, field, volumes, dataset, sectionAxis, sectionIndex, hover, xZoom, probeIndex)
    draw()
    // the canvas is sized by drawMap to fit its wrapper at the physical
    // aspect ratio, so watch the wrapper, not the canvas
    const ro = new ResizeObserver(draw)
    ro.observe(canvas.parentElement ?? canvas)
    return () => ro.disconnect()
  }, [field, volumes, dataset, sectionAxis, sectionIndex, hover, uiTheme, xZoom, probeIndex])

  const moveSection = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const relY = (e.clientY - rect.top) / rect.height
    if (sectionAxis === 'dip') setSection('dip', Math.round(relY * (nRows - 1)))
    else setSection('strike', Math.round(relX * (nCols - 1)))
  }

  return (
    <div className="panel__body">
      <div className="controls-row">
        <div className="seg">
          {(['topography', 'thickness'] as const).map((mm) => (
            <button
              key={mm}
              className={`seg__btn${mm === mode ? ' is-active' : ''}`}
              onClick={() => setMode(mm)}
            >
              {mm}
            </button>
          ))}
        </div>
      </div>
      <div
        className="map-wrap"
        // consumed by the mobile stylesheet only; on desktop the wrapper is
        // flex-bounded and the canvas is contain-fitted inside it
        style={{ '--map-aspect': `${nCols * dCol} / ${nRows * dRow}` } as React.CSSProperties}
      >
        <canvas
          ref={canvasRef}
          className="map-canvas"
          onPointerDown={(e) => {
            dragRef.current = true
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* synthetic or already-released pointer */
            }
            moveSection(e)
          }}
          onPointerMove={(e) => {
            if (dragRef.current) moveSection(e)
            // hover: position ALONG the current section under the pointer
            const canvas = canvasRef.current
            if (canvas) {
              const rect = canvas.getBoundingClientRect()
              const relX = (e.clientX - rect.left) / rect.width
              const relY = (e.clientY - rect.top) / rect.height
              const index =
                sectionAxis === 'dip'
                  ? Math.round(relX * (nCols - 1))
                  : Math.round(relY * (nRows - 1))
              setHover({ index, time: null })
            }
          }}
          onPointerUp={(e) => {
            dragRef.current = false
            try {
              e.currentTarget.releasePointerCapture(e.pointerId)
            } catch {
              /* synthetic or already-released pointer */
            }
          }}
          onPointerLeave={() => {
            dragRef.current = false
            setHover(null)
          }}
          title="click / drag to move the section"
        />
      </div>
    </div>
  )
}

function topoSlice(topo: NdArray, nRows: number, nCols: number, k: number): Float32Array {
  const out = new Float32Array(nRows * nCols)
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) out[r * nCols + c] = topo.get(r, c, k)
  }
  return out
}

/** deposit thickness up to step k: strat[k] - strat[0], datum-independent */
function computeThickness(
  topo: NdArray,
  subsid: NdArray | null,
  nLoc: number,
  nt: number,
  k: number,
): Float32Array {
  const t = topo.data as Float32Array
  const s = subsid ? (subsid.data as Float32Array) : null
  const out = new Float32Array(nLoc)
  for (let j = 0; j < nLoc; j++) {
    const b = j * nt
    const yk = t[b + k] - (s ? s[b + k] : 0)
    let mn = yk
    for (let i = k - 1; i >= 0; i--) {
      const y = t[b + i] - (s ? s[b + i] : 0)
      if (y < mn) mn = y
    }
    out[j] = yk - mn
  }
  return out
}

function drawMap(
  canvas: HTMLCanvasElement,
  field: { data: Float32Array; k: number; mode: MapMode },
  volumes: Volumes,
  dataset: Dataset,
  sectionAxis: 'dip' | 'strike',
  sectionIndex: number,
  hover: { index: number; time: number | null } | null,
  xZoom: [number, number] | null,
  probeIndex: number,
) {
  const theme = themeColors(canvas)
  const space = dataset.manifest.space as SpaceGrid3d
  const [nRows, nCols] = space.shape
  const { data, k, mode } = field

  // contain-fit the canvas inside its wrapper at the TRUE physical aspect
  // ratio — CSS max-height clamping would silently stretch the map
  const wrap = canvas.parentElement
  if (wrap) {
    const ratio = (nCols * space.spacing[1]) / (nRows * space.spacing[0])
    let cw = wrap.clientWidth
    let chh = cw / ratio
    if (chh > wrap.clientHeight && wrap.clientHeight > 0) {
      chh = wrap.clientHeight
      cw = chh * ratio
    }
    canvas.style.width = `${cw}px`
    canvas.style.height = `${chh}px`
  }
  const sl = volumes.seaLevel ? volumes.seaLevel[k] : null
  const [vmin, vmax] = mode === 'topography' ? volumes.topoRange : volumes.thicknessRange
  const [pr, pg, pb] = hexToRgb(theme.paper) // subaerial wash target
  const [ir, ig, ib] = hexToRgb(theme.ink) // contour line color

  // fill
  const img = new ImageData(nCols, nRows)
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const v = data[r * nCols + c]
      const p = (r * nCols + c) * 4
      if (!Number.isFinite(v)) {
        img.data[p + 3] = 0
        continue
      }
      let [rr, gg, bb] = deepR((v - vmin) / (vmax - vmin || 1))
      if (mode === 'topography' && sl !== null && v >= sl) {
        // subaerial: wash toward the paper color so land reads as land
        rr = rr + (pr - rr) * 0.55
        gg = gg + (pg - gg) * 0.55
        bb = bb + (pb - bb) * 0.55
      }
      img.data[p] = rr
      img.data[p + 1] = gg
      img.data[p + 2] = bb
      img.data[p + 3] = 255
    }
  }

  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const off = new OffscreenCanvas(nCols, nRows)
  off.getContext('2d')!.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.fillStyle = theme.paper
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(off, 0, 0, w, h)

  // contours (grid samples at cell centers)
  const toPx = (col: number, row: number): [number, number] => [
    ((col + 0.5) / nCols) * w,
    ((row + 0.5) / nRows) * h,
  ]
  // datasets can tune contour density via views.map.contourLevels
  const nLevels =
    ((dataset.manifest.views.map as { contourLevels?: number } | undefined)?.contourLevels) ?? 28
  ctx.strokeStyle = `rgba(${ir}, ${ig}, ${ib}, 0.45)`
  ctx.lineWidth = 0.7
  for (const level of contourLevels(vmin, vmax, nLevels)) {
    if (mode === 'thickness' && level <= 0) continue
    drawContour(ctx, data, nRows, nCols, level, toPx)
  }

  // shoreline: contour of topography at the current sea level
  if (mode === 'topography' && sl !== null) {
    ctx.strokeStyle = theme.dep
    ctx.lineWidth = 2
    drawContour(ctx, data, nRows, nCols, sl, toPx)
  }

  // section trace; the cross-section's current zoom window is the thick part
  const [dRow, dCol] = space.spacing
  // along-section distance -> map px (grid samples sit at cell centers)
  const alongPx = (dist: number) =>
    sectionAxis === 'dip'
      ? ((dist / dCol + 0.5) / nCols) * w
      : ((dist / dRow + 0.5) / nRows) * h
  const tracePx =
    sectionAxis === 'dip' ? ((sectionIndex + 0.5) / nRows) * h : ((sectionIndex + 0.5) / nCols) * w

  ctx.strokeStyle = theme.ero
  ctx.lineWidth = xZoom ? 1 : 2
  ctx.beginPath()
  if (sectionAxis === 'dip') {
    ctx.moveTo(0, tracePx)
    ctx.lineTo(w, tracePx)
  } else {
    ctx.moveTo(tracePx, 0)
    ctx.lineTo(tracePx, h)
  }
  ctx.stroke()
  if (xZoom) {
    const a = alongPx(xZoom[0])
    const b = alongPx(xZoom[1])
    ctx.lineWidth = 4
    ctx.beginPath()
    if (sectionAxis === 'dip') {
      ctx.moveTo(a, tracePx)
      ctx.lineTo(b, tracePx)
    } else {
      ctx.moveTo(tracePx, a)
      ctx.lineTo(tracePx, b)
    }
    ctx.stroke()
  }

  // Barrell column (probe) location: filled dot on the trace
  {
    const p = alongPx(probeIndex * (sectionAxis === 'dip' ? dCol : dRow))
    const px = sectionAxis === 'dip' ? p : tracePx
    const py = sectionAxis === 'dip' ? tracePx : p
    ctx.beginPath()
    ctx.arc(px, py, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = theme.ero
    ctx.fill()
    ctx.strokeStyle = theme.paper
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // linked hover ghost: dot on the section trace at the hovered position
  if (hover) {
    let hx: number
    let hy: number
    if (sectionAxis === 'dip') {
      hx = ((Math.min(nCols - 1, hover.index) + 0.5) / nCols) * w
      hy = ((sectionIndex + 0.5) / nRows) * h
    } else {
      hx = ((sectionIndex + 0.5) / nCols) * w
      hy = ((Math.min(nRows - 1, hover.index) + 0.5) / nRows) * h
    }
    ctx.beginPath()
    ctx.arc(hx, hy, 4, 0, Math.PI * 2)
    ctx.fillStyle = theme.paper
    ctx.fill()
    ctx.strokeStyle = theme.ero
    ctx.lineWidth = 1.6
    ctx.stroke()
  }

  ctx.strokeStyle = theme.faint
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)

  // colorbar, bottom right
  drawHColorbar(
    ctx, w - 130, h - 34, 110, deepR, vmin, vmax,
    mode === 'topography'
      ? `elevation (${dataset.manifest.elevationUnits})`
      : `thickness (${dataset.manifest.elevationUnits})`,
    { ink: theme.ink, faint: theme.faint, paper: theme.paper },
  )

  // caption
  ctx.font = '10px "IBM Plex Mono", monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  const units = dataset.manifest.elevationUnits
  const label =
    mode === 'topography'
      ? `topography at step ${k + 1}${sl !== null ? ` · shoreline at ${sl.toFixed(0)} ${units}` : ''}`
      : `deposit thickness up to step ${k + 1} · 0 to ${vmax.toFixed(0)} ${units}`
  ctx.lineWidth = 3
  ctx.strokeStyle = theme.paper
  ctx.strokeText(label, 6, h - 5)
  ctx.fillStyle = theme.ink
  ctx.fillText(label, 6, h - 5)
}
