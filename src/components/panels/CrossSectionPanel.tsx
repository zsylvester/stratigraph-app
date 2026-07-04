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
  yPix,
} from '../../plot/frame'
import { retroDeform, stratUpTo } from '../../strat/core'
import { css, FACIES_COLORS, faciesFromDepth, viridis } from '../../strat/colormaps'
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
  const uiTheme = useAppStore((s) => s.theme) // redraw when the theme flips
  const frameRef = useRef<Frame | null>(null)

  // sea level (grid3d only), fetched once
  const seaLevelRef = useRef<Float64Array | null>(null)
  useEffect(() => {
    seaLevelRef.current = null
    if (dataset.manifest.kind === 'grid3d') {
      void dataset.array('seaLevel').then((a) => {
        seaLevelRef.current = a.data as Float64Array
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
        ctx, canvas, state, timeStep, probeIndex, seaLevelRef.current, dataset,
        colorMode, showErosion, hover,
      )
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [state, timeStep, probeIndex, dataset, colorMode, showErosion, hover, uiTheme])

  // pointer position -> index along the section
  const indexAt = (e: React.MouseEvent<HTMLCanvasElement>): number | null => {
    const f = frameRef.current
    const canvas = canvasRef.current
    if (!f || !canvas || !state) return null
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const frac = (px - f.x0) / f.w
    if (frac < 0 || frac > 1) return null
    return Math.round(frac * (state.section.n - 1))
  }

  const hasFacies = dataset.manifest.kind === 'grid3d' // needs a sea level curve
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
      </div>
      <canvas
        ref={canvasRef}
        className="plot-canvas"
        onMouseMove={(e) => {
          const i = indexAt(e)
          setHover(i === null ? null : { index: i, time: null })
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const i = indexAt(e)
          if (i !== null) setProbeIndex(i)
        }}
        title="click to move the Barrell probe"
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
  dataset: Dataset,
  colorMode: ColorMode,
  showErosion: boolean,
  hover: { index: number; time: number | null } | null,
): Frame {
  const { section: sec, bounds } = state
  const { n, nt, x } = sec
  const kk = Math.min(k, nt - 1)
  const theme = themeColors(canvas)
  const m = dataset.manifest

  const topoS = retroDeform(sec, kk)
  const strat = stratUpTo(topoS, n, nt, kk)

  // manifest ylim (paper framing) wins; otherwise preserved-strat bounds
  const ylim = (m.views.section as { ylim?: [number, number] } | undefined)?.ylim
  const pad = (bounds.hi - bounds.lo) * 0.05
  const [yLo, yHi] = ylim ?? [bounds.lo - pad, bounds.hi + pad]
  const units = (m.space as { units?: string })?.units ?? m.elevationUnits
  // right gutter for the colorbar — same width as the Wheeler panel below
  const f = makeFrame(canvas.clientWidth - CBAR_GUTTER, canvas.clientHeight, x[0], x[n - 1], yLo, yHi)

  ctx.save()
  ctx.beginPath()
  ctx.rect(f.x0, f.y0, f.w, f.h)
  ctx.clip()

  // basement: below the oldest preserved surface
  ctx.beginPath()
  ctx.moveTo(xPix(f, x[0]), f.y0 + f.h)
  for (let j = 0; j < n; j++) ctx.lineTo(xPix(f, x[j]), yPix(f, strat[j * nt]))
  ctx.lineTo(xPix(f, x[n - 1]), f.y0 + f.h)
  ctx.closePath()
  ctx.fillStyle = theme.paper3
  ctx.fill()
  ctx.strokeStyle = theme.inkSoft
  ctx.lineWidth = 1
  ctx.stroke()

  // depth bins separating facies (water depth at deposition), from the manifest
  const bins = (m.processing.faciesDepthBins as number[] | undefined) ?? [0, -100]
  const faciesOf = (j: number, i: number): number =>
    // raw (non-retro-deformed) elevation vs sea level at deposition time
    faciesFromDepth(sec.topo[j * nt + i] - (seaLevel ? seaLevel[i] : 0), bins)

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
  for (let i = 0; i < kk; i++) {
    if (colorMode === 'age' || !seaLevel) {
      fillPolyRun(i, 0, n - 1, css(viridis(i / Math.max(1, nt - 2))))
    } else {
      // split the layer into runs of constant facies
      let j0 = 0
      let fPrev = faciesOf(0, i)
      for (let j = 1; j < n; j++) {
        const fj = faciesOf(j, i)
        if (fj !== fPrev) {
          fillPolyRun(i, j0, j, FACIES_COLORS[fPrev]) // overlap one point for continuity
          j0 = j
          fPrev = fj
        }
      }
      fillPolyRun(i, j0, n - 1, FACIES_COLORS[fPrev])
    }
  }

  // erosional surfaces: the preserved horizon of time i is a truncation
  // surface wherever the original time-i topography lay above it (vacuity)
  if (showErosion) {
    const thresh = m.processing.resolution
    ctx.strokeStyle = theme.ero
    ctx.lineWidth = 1.1
    ctx.beginPath()
    for (let i = 1; i <= kk; i++) {
      let pen = false
      for (let j = 0; j < n; j++) {
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

  // thin black stratigraphic surface lines (condensed zones read darker);
  // the manifest's key surfaces (originally digitized) are drawn heavier
  const keys = new Set<number>(m.keySurfaceIndices ?? [])
  const lineFreq = Math.max(1, Math.ceil(nt / 80))
  ctx.strokeStyle = theme.ink
  for (let i = 0; i <= kk; i++) {
    const isKey = keys.has(i)
    if (!isKey && i % lineFreq !== 0) continue
    ctx.lineWidth = isKey ? 0.7 : 0.35
    ctx.globalAlpha = isKey ? 1 : 0.55
    ctx.beginPath()
    for (let j = 0; j < n; j++) {
      const px = xPix(f, x[j])
      const py = yPix(f, strat[j * nt + i])
      if (j === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // current topographic surface
  ctx.beginPath()
  for (let j = 0; j < n; j++) {
    const px = xPix(f, x[j])
    const py = yPix(f, topoS[j * nt + kk])
    if (j === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.strokeStyle = theme.ink
  ctx.lineWidth = 1.4
  ctx.stroke()

  // sea level at the current time step
  if (seaLevel) {
    const sl = seaLevel[kk]
    ctx.beginPath()
    ctx.moveTo(f.x0, yPix(f, sl))
    ctx.lineTo(f.x0 + f.w, yPix(f, sl))
    ctx.strokeStyle = theme.dep
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    ctx.stroke()
    ctx.setLineDash([])
  }

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
  if (colorMode === 'age') {
    drawColorbar(
      ctx, cbX, f.y0, f.h, viridis, 0, nt - 1,
      'deposit age (time step)', { ink: theme.inkSoft, faint: theme.faint },
    )
  } else {
    drawSwatchLegend(
      ctx, cbX, f.y0,
      [
        { color: FACIES_COLORS[0], label: 'topset' },
        { color: FACIES_COLORS[1], label: 'foreset' },
        { color: FACIES_COLORS[2], label: 'deep' },
        ...(showErosion ? [{ color: theme.ero, label: 'erosion', line: true }] : []),
      ],
      { ink: theme.inkSoft, faint: theme.faint },
    )
  }
  return f
}
