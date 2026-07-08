import { useEffect, useRef, useState } from 'react'

import type { Dataset } from '../../data/loader'
import { CBAR_GUTTER, drawColorbar, drawSwatchLegend } from '../../plot/colorbar'
import {
  drawFrame,
  Frame,
  makeFrame,
  setupCanvas,
  themeColors,
  xPix,
} from '../../plot/frame'
import { paintSectionBody } from '../../plot/sectionPaint'
import { EROSION_ON_FACIES, FACIES_COLORS, LAYER_FACIES_COLORS, viridis } from '../../strat/colormaps'
import { useSection } from '../../strat/useSection'
import { sectionCount, useAppStore } from '../../state/store'

type ColorMode = 'age' | 'facies'

/**
 * Dip/strike cross section: preserved stratigraphy up to the shared time step.
 * Layers colored by absolute age (viridis) or by water-depth facies (shared
 * with the Barrell column); optional erosional-surface overlay (red);
 * basement gray, sea level dashed.
 */
export function CrossSectionPanel({ dataset }: { dataset: Dataset }) {
  const timeStep = useAppStore((s) => s.timeStep)
  const probeIndex = useAppStore((s) => s.probeIndex)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const state = useSection(dataset)
  const colorMode = useAppStore((s) => s.sectionColorMode)
  const setColorMode = useAppStore((s) => s.setSectionColorMode)
  const hover = useAppStore((s) => s.hover)
  const setHover = useAppStore((s) => s.setHover)
  const setProbeIndex = useAppStore((s) => s.setProbeIndex)
  const [showErosion, setShowErosion] = useState(false)
  // equal-scale axes (vertical exaggeration 1); manifest can set the default
  const [equalAxes, setEqualAxes] = useState(false)
  useEffect(() => {
    setEqualAxes(
      !!(dataset.manifest.views.section as { equalAxes?: boolean } | undefined)?.equalAxes,
    )
  }, [dataset])
  const uiTheme = useAppStore((s) => s.theme) // redraw when the theme flips
  const frameRef = useRef<Frame | null>(null)

  // zoom state: x range shared with the Wheeler panel, y range local
  const xZoom = useAppStore((s) => s.xZoom)
  const setXZoom = useAppStore((s) => s.setXZoom)
  const [yZoom, setYZoom] = useState<[number, number] | null>(null)
  const defaultsRef = useRef<{ x0: number; x1: number; y0: number; y1: number } | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const movedRef = useRef(false)
  // box zoom: drag a rectangle, release to zoom to it (persistent mode)
  const [boxMode, setBoxMode] = useState(false)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const boxOriginRef = useRef<{ x: number; y: number } | null>(null)

  // a new section (or dataset) has its own framing
  useEffect(() => {
    setYZoom(null)
  }, [state])

  // sea level and per-layer facies (both optional), fetched once
  const seaLevelRef = useRef<Float64Array | null>(null)
  const layerFaciesRef = useRef<Int8Array | null>(null)
  useEffect(() => {
    seaLevelRef.current = null
    layerFaciesRef.current = null
    const m = dataset.manifest
    if (m.kind === 'grid3d' && m.arrays.seaLevel) {
      void dataset.array('seaLevel').then((a) => {
        seaLevelRef.current = a.data as Float64Array
      })
    }
    if (m.derived?.layerFacies) {
      void dataset.array('layerFacies').then((a) => {
        layerFaciesRef.current = a.data as Int8Array
      })
    }
  }, [dataset])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !state) return
    const draw = () => {
      const ctx = setupCanvas(canvas)
      if (!ctx) return
      frameRef.current = drawSection(
        ctx, canvas, state, timeStep, probeIndex, seaLevelRef.current,
        layerFaciesRef.current, dataset, colorMode, showErosion, hover,
        xZoom, yZoom, equalAxes, defaultsRef,
      )
      if (box) {
        // rubber band for box zoom
        ctx.save()
        ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--ero').trim() || '#a34a24'
        ctx.fillStyle = 'rgba(163, 74, 36, 0.08)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 3])
        const bx = Math.min(box.x0, box.x1)
        const by = Math.min(box.y0, box.y1)
        const bw = Math.abs(box.x1 - box.x0)
        const bh = Math.abs(box.y1 - box.y0)
        ctx.fillRect(bx, by, bw, bh)
        ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh)
        ctx.restore()
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [state, timeStep, probeIndex, dataset, colorMode, showErosion, hover, uiTheme, xZoom, yZoom, equalAxes, box])

  // In 1:1 mode the full extent of a low-relief section is a hairline, so
  // materialize a visible default window (sized by the relief, centered on
  // the probe) into the shared xZoom — the Wheeler diagram follows along.
  // Resetting zoom re-materializes it, i.e. reset returns to this view.
  useEffect(() => {
    if (!equalAxes || xZoom !== null || !state) return
    const d = defaultsRef.current
    const f = frameRef.current
    if (!d || !f) return
    // window a few geobodies wide (~40x the relief); sections are genuinely
    // thin ribbons at true scale, so this is a starting point for zooming
    const xspan = (d.y1 - d.y0) * 40
    if (xspan >= (d.x1 - d.x0) * 0.999) return // whole section visible at 1:1
    const { x, n } = state.section
    const half = xspan / 2
    const cx = Math.max(
      d.x0 + half,
      Math.min(d.x1 - half, x[Math.min(n - 1, probeIndex)]),
    )
    setXZoom([cx - half, cx + half])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equalAxes, xZoom, state])

  // pointer position -> index along the section (zoom-aware: via data coords)
  const indexAtPx = (clientX: number): number | null => {
    const f = frameRef.current
    const canvas = canvasRef.current
    if (!f || !canvas || !state) return null
    const rect = canvas.getBoundingClientRect()
    const frac = (clientX - rect.left - f.x0) / f.w
    if (frac < 0 || frac > 1) return null
    const { x, n } = state.section
    const xData = f.xMin + frac * (f.xMax - f.xMin)
    const step = (x[n - 1] - x[0]) / (n - 1)
    return Math.min(n - 1, Math.max(0, Math.round((xData - x[0]) / step)))
  }

  /**
   * One view update combining scale and translation: the data point that was
   * under (oldX, oldY) ends up under (newX, newY) with spans scaled by factor.
   * Pure pan is factor=1; wheel zoom passes old == new. Doing both in a single
   * state update per axis avoids the pinch bug where a pan computed from a
   * stale frame overwrote the zoom applied in the same pointer event.
   */
  const applyView = (
    newX: number, newY: number, oldX: number, oldY: number, factor: number,
  ) => {
    const f = frameRef.current
    const d = defaultsRef.current
    const canvas = canvasRef.current
    if (!f || !d || !canvas) return
    const rect = canvas.getBoundingClientRect()

    const axis = (
      lo: number, hi: number, dLo: number, dHi: number,
      fracOld: number, fracNew: number,
    ): [number, number] | null => {
      const defSpan = dHi - dLo
      const span = Math.min(defSpan, Math.max(defSpan / 80, (hi - lo) * factor))
      if (span >= defSpan * 0.999) return null
      const anchor = lo + fracOld * (hi - lo)
      let nLo = anchor - fracNew * span
      nLo = Math.max(dLo, Math.min(dHi - span, nLo))
      return [nLo, nLo + span]
    }

    const nx = axis(
      f.xMin, f.xMax, d.x0, d.x1,
      (oldX - rect.left - f.x0) / f.w,
      (newX - rect.left - f.x0) / f.w,
    )
    setXZoom(nx)
    if (equalAxes) {
      // the y span is derived from x; only the center is free (unclamped,
      // since 1:1 spans routinely exceed the data's elevation range)
      if (nx === null) {
        setYZoom(null) // back to full extent: re-center vertically too
      } else {
        const fracOld = 1 - (oldY - rect.top - f.y0) / f.h
        const fracNew = 1 - (newY - rect.top - f.y0) / f.h
        const span = (f.yMax - f.yMin) * factor
        const anchor = f.yMin + fracOld * (f.yMax - f.yMin)
        const nLo = anchor - fracNew * span
        setYZoom([nLo, nLo + span])
      }
    } else {
      setYZoom(
        axis(
          f.yMin, f.yMax, d.y0, d.y1,
          1 - (oldY - rect.top - f.y0) / f.h,
          1 - (newY - rect.top - f.y0) / f.h,
        ),
      )
    }
  }

  const resetZoom = () => {
    setXZoom(null)
    setYZoom(null)
  }

  const canvasLocal = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  useEffect(() => {
    if (!boxMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBoxMode(false)
        setBox(null)
        boxOriginRef.current = null
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [boxMode])

  const zoomToBox = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const f = frameRef.current
    const d = defaultsRef.current
    if (!f || !d) return
    const toData = (p: { x: number; y: number }) => ({
      x: f.xMin + ((p.x - f.x0) / f.w) * (f.xMax - f.xMin),
      y: f.yMin + (1 - (p.y - f.y0) / f.h) * (f.yMax - f.yMin),
    })
    const p1 = toData(a)
    const p2 = toData(b)
    const x0 = Math.min(p1.x, p2.x)
    const x1 = Math.max(p1.x, p2.x)
    const y0 = Math.min(p1.y, p2.y)
    const y1 = Math.max(p1.y, p2.y)
    if (equalAxes) {
      // 1:1: fit the whole rectangle at equal scale; y center is free
      let xspan = Math.max(x1 - x0, (y1 - y0) * (f.w / f.h))
      xspan = Math.min(d.x1 - d.x0, Math.max((d.x1 - d.x0) / 80, xspan))
      const half = xspan / 2
      const cx = Math.max(d.x0 + half, Math.min(d.x1 - half, (x0 + x1) / 2))
      setXZoom([cx - half, cx + half])
      const yspan = xspan * (f.h / f.w)
      const cy = (y0 + y1) / 2
      setYZoom([cy - yspan / 2, cy + yspan / 2])
    } else {
      const range = (lo: number, hi: number, dLo: number, dHi: number): [number, number] | null => {
        const defSpan = dHi - dLo
        const span = Math.min(defSpan, Math.max(defSpan / 80, hi - lo))
        if (span >= defSpan * 0.999) return null
        let nLo = Math.max(dLo, Math.min(dHi - span, lo))
        return [nLo, nLo + span]
      }
      setXZoom(range(x0, x1, d.x0, d.x1))
      setYZoom(range(y0, y1, d.y0, d.y1))
    }
  }

  // the native wheel listener is registered once; reach the latest applyView
  // (which closes over equalAxes) through a ref
  const applyViewRef = useRef(applyView)
  applyViewRef.current = applyView

  // wheel zoom needs a non-passive native listener (React's is passive)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      applyViewRef.current(e.clientX, e.clientY, e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // facies coloring needs either a sea level curve (water-depth facies) or
  // per-layer facies shipped in the bundle
  const hasFacies =
    dataset.manifest.kind === 'grid3d' &&
    (!!dataset.manifest.arrays.seaLevel || !!dataset.manifest.derived?.layerFacies)
  return (
    <div className="panel__body">
      <div className="controls-row">
        <SectionControls dataset={dataset} />
        {hasFacies && (
          <div className="seg">
            {(['age', 'facies'] as const).map((cm) => (
              <button
                key={cm}
                className={`seg__btn${cm === colorMode ? ' is-active' : ''}`}
                onClick={() => setColorMode(cm)}
              >
                {cm}
              </button>
            ))}
          </div>
        )}
        <button
          className={`seg__btn seg__btn--solo${showErosion ? ' is-active' : ''}`}
          onClick={() => setShowErosion((v) => !v)}
          title="show erosional surfaces (red)"
        >
          erosion
        </button>
        <div className="seg">
          {(['fit', '1:1'] as const).map((mode) => (
            <button
              key={mode}
              className={`seg__btn${(mode === '1:1') === equalAxes ? ' is-active' : ''}`}
              onClick={() => {
                setEqualAxes(mode === '1:1')
                setXZoom(null) // re-frame for the new aspect rule
                setYZoom(null)
              }}
              title={mode === '1:1' ? 'equal horizontal/vertical scale' : 'stretch to fill the panel'}
            >
              {mode}
            </button>
          ))}
        </div>
        <button
          className={`seg__btn seg__btn--solo${boxMode ? ' is-active' : ''}`}
          onClick={() => {
            setBoxMode((v) => !v)
            setBox(null)
            boxOriginRef.current = null
          }}
          title="drag a rectangle to zoom to it (Esc exits)"
        >
          box zoom
        </button>
        {(xZoom || yZoom) && (
          <button className="seg__btn seg__btn--solo" onClick={resetZoom} title="reset zoom (double-click)">
            reset zoom
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="plot-canvas"
        style={{
          touchAction: boxMode ? 'none' : 'pan-y',
          cursor: boxMode ? 'crosshair' : undefined,
        }}
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* synthetic or already-released pointer */
          }
          pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          movedRef.current = false
          if (boxMode && pointersRef.current.size === 1) {
            const p = canvasLocal(e.clientX, e.clientY)
            boxOriginRef.current = p
            setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
          }
        }}
        onPointerMove={(e) => {
          const pts = pointersRef.current
          const prev = pts.get(e.pointerId)
          if (!prev) {
            // plain hover
            const i = indexAtPx(e.clientX)
            setHover(i === null ? null : { index: i, time: null })
            return
          }
          const oldPts = [...pts.values()]
          pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (boxMode && boxOriginRef.current && pts.size === 1 && e.buttons) {
            const o = boxOriginRef.current
            const p = canvasLocal(e.clientX, e.clientY)
            if (Math.abs(p.x - o.x) + Math.abs(p.y - o.y) > 2) movedRef.current = true
            setBox({ x0: o.x, y0: o.y, x1: p.x, y1: p.y })
          } else if (pts.size === 1 && e.buttons) {
            const dx = e.clientX - prev.x
            const dy = e.clientY - prev.y
            if (Math.abs(dx) + Math.abs(dy) > 2) movedRef.current = true
            if (movedRef.current) applyView(e.clientX, e.clientY, prev.x, prev.y, 1)
          } else if (pts.size === 2 && oldPts.length === 2) {
            // a second finger cancels any rubber band and pinches instead
            boxOriginRef.current = null
            setBox(null)
            // pinch: scale from distance ratio, translate from midpoint motion
            movedRef.current = true
            const newPts = [...pts.values()]
            const dist = (p: { x: number; y: number }[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)
            const mid = (p: { x: number; y: number }[]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 })
            const oldD = dist(oldPts)
            const newD = dist(newPts)
            if (oldD > 0 && newD > 0) {
              const m = mid(newPts)
              const mo = mid(oldPts)
              applyView(m.x, m.y, mo.x, mo.y, oldD / newD)
            }
          }
        }}
        onPointerUp={(e) => {
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* synthetic or already-released pointer */
          }
          pointersRef.current.delete(e.pointerId)
          if (boxMode && boxOriginRef.current) {
            const o = boxOriginRef.current
            const p = canvasLocal(e.clientX, e.clientY)
            boxOriginRef.current = null
            setBox(null)
            if (movedRef.current && Math.abs(p.x - o.x) > 6 && Math.abs(p.y - o.y) > 6) {
              zoomToBox(o, p)
              return
            }
          }
          if (!movedRef.current && pointersRef.current.size === 0) {
            const i = indexAtPx(e.clientX)
            if (i !== null) setProbeIndex(i)
          }
        }}
        onPointerCancel={(e) => {
          pointersRef.current.delete(e.pointerId)
          boxOriginRef.current = null
          setBox(null)
        }}
        onPointerLeave={() => {
          if (pointersRef.current.size === 0) setHover(null)
        }}
        onDoubleClick={resetZoom}
        title="click: move probe · drag: pan · wheel/pinch: zoom · double-click: reset"
      />
    </div>
  )
}

/** Axis toggle + section position slider (grid3d only); row contents. */
export function SectionControls({ dataset }: { dataset: Dataset }) {
  const sectionAxis = useAppStore((s) => s.sectionAxis)
  const sectionIndex = useAppStore((s) => s.sectionIndex)
  const setSection = useAppStore((s) => s.setSection)
  if (dataset.manifest.kind !== 'grid3d') return null
  const nSec = sectionCount(dataset, sectionAxis)
  return (
    <>
      <div className="seg">
        {(['dip', 'strike'] as const).map((a) => (
          <button
            key={a}
            className={`seg__btn${a === sectionAxis ? ' is-active' : ''}`}
            onClick={() => setSection(a, a === sectionAxis ? sectionIndex : Math.floor(sectionCount(dataset, a) / 2))}
          >
            {a}
          </button>
        ))}
      </div>
      <input
        type="range"
        className="mini-slider"
        min={0}
        max={nSec - 1}
        value={sectionIndex}
        onChange={(e) => setSection(sectionAxis, Number(e.target.value))}
        aria-label="section position"
      />
      <span className="controls-row__readout">
        {sectionAxis} {sectionIndex}/{nSec - 1}
      </span>
    </>
  )
}

function drawSection(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: NonNullable<ReturnType<typeof useSection>>,
  k: number,
  probeIndex: number,
  seaLevel: Float64Array | null,
  layerFacies: Int8Array | null,
  dataset: Dataset,
  colorMode: ColorMode,
  showErosion: boolean,
  hover: { index: number; time: number | null } | null,
  xZoom: [number, number] | null,
  yZoom: [number, number] | null,
  equalAxes: boolean,
  defaultsOut: { current: { x0: number; x1: number; y0: number; y1: number } | null },
): Frame {
  const { section: sec, bounds } = state
  const { n, nt, x } = sec
  const kk = Math.min(k, nt - 1)
  const theme = themeColors(canvas)
  const m = dataset.manifest

  // manifest ylim (paper framing) wins; otherwise preserved-strat bounds
  const ylim = (m.views.section as { ylim?: [number, number] } | undefined)?.ylim
  const pad = (bounds.hi - bounds.lo) * 0.05
  const [yLo, yHi] = ylim ?? [bounds.lo - pad, bounds.hi + pad]
  defaultsOut.current = { x0: x[0], x1: x[n - 1], y0: yLo, y1: yHi }
  const [vx0, vx1] = xZoom ?? [x[0], x[n - 1]]
  let [vy0, vy1] = yZoom ?? [yLo, yHi]
  const units = (m.space as { units?: string })?.units ?? m.elevationUnits
  // right gutter for the colorbar — same width as the Wheeler panel below
  let f = makeFrame(canvas.clientWidth - CBAR_GUTTER, canvas.clientHeight, vx0, vx1, vy0, vy1)
  if (equalAxes) {
    // 1:1 scale: the elevation span follows from the distance span and the
    // pixel aspect; only the vertical center is free
    const ySpan = ((vx1 - vx0) / f.w) * f.h
    const yCenter = yZoom ? (yZoom[0] + yZoom[1]) / 2 : (yLo + yHi) / 2
    vy0 = yCenter - ySpan / 2
    vy1 = yCenter + ySpan / 2
    f = makeFrame(canvas.clientWidth - CBAR_GUTTER, canvas.clientHeight, vx0, vx1, vy0, vy1)
  }

  const faciesMode = colorMode === 'facies' && (layerFacies !== null || seaLevel !== null)
  paintSectionBody(ctx, f, sec, kk, theme, {
    seaLevel,
    layerFacies,
    colorMode,
    bins: (m.processing.faciesDepthBins as number[] | undefined) ?? [0, -100],
    keySurfaceIndices: m.keySurfaceIndices,
    showErosion,
    erosionRes: m.processing.resolution,
    drawWater: true,
  })

  // interactive markers, clipped to the plot area like the geology
  ctx.save()
  ctx.beginPath()
  ctx.rect(f.x0, f.y0, f.w, f.h)
  ctx.clip()

  // probe location marker (where the Barrell plot samples)
  const pj = Math.min(n - 1, probeIndex)
  ctx.beginPath()
  ctx.moveTo(xPix(f, x[pj]) + 0.5, f.y0)
  ctx.lineTo(xPix(f, x[pj]) + 0.5, f.y0 + f.h)
  ctx.strokeStyle = theme.ero
  ctx.lineWidth = 1
  ctx.setLineDash([2, 3])
  ctx.stroke()
  ctx.setLineDash([])

  // linked hover ghost
  if (hover && hover.index !== pj) {
    const hj = Math.min(n - 1, hover.index)
    ctx.globalAlpha = 0.45
    ctx.beginPath()
    ctx.moveTo(xPix(f, x[hj]) + 0.5, f.y0)
    ctx.lineTo(xPix(f, x[hj]) + 0.5, f.y0 + f.h)
    ctx.strokeStyle = theme.ink
    ctx.setLineDash([1, 3])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  ctx.restore()

  drawFrame(ctx, f, `distance (${units})`, `elevation (${m.elevationUnits})`, {
    ink: theme.inkSoft,
    faint: theme.faint,
  })

  // colorbar / legend in the right gutter
  const cbX = f.x0 + f.w + 14
  if (!faciesMode) {
    drawColorbar(
      ctx, cbX, f.y0, f.h, viridis, 0, nt - 1,
      'deposit age (time step)', { ink: theme.inkSoft, faint: theme.faint },
    )
  } else if (layerFacies) {
    const labels =
      (m.processing.layerFaciesLabels as string[] | undefined) ?? ['facies 0', 'facies 1']
    drawSwatchLegend(
      ctx, cbX, f.y0,
      [
        ...labels.map((label, i) => ({ color: LAYER_FACIES_COLORS[i], label })),
        ...(showErosion ? [{ color: EROSION_ON_FACIES, label: 'erosion', line: true }] : []),
      ],
      { ink: theme.inkSoft, faint: theme.faint },
    )
  } else {
    drawSwatchLegend(
      ctx, cbX, f.y0,
      [
        { color: FACIES_COLORS[0], label: 'topset' },
        { color: FACIES_COLORS[1], label: 'foreset' },
        { color: FACIES_COLORS[2], label: 'deep' },
        ...(showErosion ? [{ color: EROSION_ON_FACIES, label: 'erosion', line: true }] : []),
      ],
      { ink: theme.inkSoft, faint: theme.faint },
    )
  }
  return f
}
