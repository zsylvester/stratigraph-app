import { useEffect, useRef } from 'react'

import type { Dataset } from '../../data/loader'
import { CBAR_GUTTER, drawColorbar } from '../../plot/colorbar'
import {
  drawFrame,
  Frame,
  makeFrame,
  setupCanvas,
  themeColors,
  xPix,
  yPix,
} from '../../plot/frame'
import { retroDeform, stratUpTo, wheelerStrat } from '../../strat/core'
import { wheelerColor } from '../../strat/colormaps'
import { useSection } from '../../strat/useSection'
import { useAppStore } from '../../state/store'

/**
 * Chronostratigraphic (Wheeler) diagram of the current section, in time
 * coordinates: preserved deposition blue, erosion red, stasis/vacuity white.
 * Grows with the shared time step. Clicking sets the time step AND the
 * Barrell probe location; hover shows a linked crosshair in all panels.
 * Shares horizontal margins + colorbar gutter with the cross section above.
 */
export function WheelerPanel({ dataset }: { dataset: Dataset }) {
  const timeStep = useAppStore((s) => s.timeStep)
  const probeIndex = useAppStore((s) => s.probeIndex)
  const hover = useAppStore((s) => s.hover)
  const setHover = useAppStore((s) => s.setHover)
  const setTimeStep = useAppStore((s) => s.setTimeStep)
  const setProbeIndex = useAppStore((s) => s.setProbeIndex)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const state = useSection(dataset)
  const uiTheme = useAppStore((s) => s.theme) // redraw when the theme flips
  const timesRef = useRef<Float64Array | null>(null)
  const frameRef = useRef<Frame | null>(null)

  useEffect(() => {
    timesRef.current = null
    void dataset.array(dataset.manifest.time.array).then((a) => {
      timesRef.current = a.data as Float64Array
    })
  }, [dataset])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !state) return
    const draw = () => {
      const ctx = setupCanvas(canvas)
      if (!ctx) return
      frameRef.current = drawWheeler(
        ctx, canvas, state, timeStep, probeIndex, timesRef.current, dataset, hover,
      )
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [state, timeStep, probeIndex, dataset, hover, uiTheme])

  /** pointer -> {index along section, time step} using the actual frame */
  const locate = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const f = frameRef.current
    const canvas = canvasRef.current
    const times = timesRef.current
    if (!f || !canvas || !state || !times) return null
    const rect = canvas.getBoundingClientRect()
    const fx = (e.clientX - rect.left - f.x0) / f.w
    const fy = 1 - (e.clientY - rect.top - f.y0) / f.h
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null
    const index = Math.round(fx * (state.section.n - 1))
    // invert the (possibly non-uniform) time axis
    const tf = dataset.manifest.time.displayFactor
    const target = f.yMin + fy * (f.yMax - f.yMin)
    let time = 0
    let best = Infinity
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(times[i] * tf - target)
      if (d < best) {
        best = d
        time = i
      }
    }
    return { index, time }
  }

  return (
    <div className="panel__body">
      <canvas
        ref={canvasRef}
        className="plot-canvas"
        onMouseMove={(e) => setHover(locate(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const loc = locate(e)
          if (loc) {
            setTimeStep(loc.time)
            setProbeIndex(loc.index)
          }
        }}
        title="click to set time + probe location"
      />
    </div>
  )
}

function drawWheeler(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: NonNullable<ReturnType<typeof useSection>>,
  k: number,
  probeIndex: number,
  times: Float64Array | null,
  dataset: Dataset,
  hover: { index: number; time: number | null } | null,
): Frame {
  const { section: sec } = state
  const { n, nt, x } = sec
  const kk = Math.min(k, nt - 1)
  const theme = themeColors(canvas)
  const m = dataset.manifest

  const topoS = retroDeform(sec, kk)
  const strat = stratUpTo(topoS, n, nt, kk)
  const ws = wheelerStrat(sec, topoS, strat, kk)

  const view = (m.views.dipSection ?? m.views.wheeler ?? {}) as Record<string, number>
  const vmax = Math.abs(view.wheelerVmax ?? view.vmax ?? 10)
  const vmin = -vmax

  const tf = m.time.displayFactor
  const t0 = times ? times[0] * tf : 0
  const t1 = times ? times[nt - 1] * tf : nt - 1
  const f = makeFrame(canvas.clientWidth - CBAR_GUTTER, canvas.clientHeight, x[0], x[n - 1], t0, t1)

  // heatmap via offscreen ImageData (n wide, nt-1 tall; row i = interval i)
  const img = new ImageData(n, nt - 1)
  for (let i = 0; i < kk; i++) {
    for (let j = 0; j < n; j++) {
      const v = ws[j * (nt - 1) + i]
      const [r, g, b] = wheelerColor(v, vmin, vmax)
      const p = ((nt - 2 - i) * n + j) * 4 // row 0 of image = latest time (top)
      img.data[p] = r
      img.data[p + 1] = g
      img.data[p + 2] = b
      img.data[p + 3] = 255
    }
  }
  const off = new OffscreenCanvas(n, nt - 1)
  off.getContext('2d')!.putImageData(img, 0, 0)

  ctx.save()
  ctx.beginPath()
  ctx.rect(f.x0, f.y0, f.w, f.h)
  ctx.clip()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(off, f.x0, f.y0, f.w, f.h)

  // time cursor
  const py = times ? yPix(f, times[kk] * tf) : yPix(f, kk)
  ctx.beginPath()
  ctx.moveTo(f.x0, py + 0.5)
  ctx.lineTo(f.x0 + f.w, py + 0.5)
  ctx.strokeStyle = theme.ero
  ctx.lineWidth = 1.2
  ctx.stroke()

  // probe location marker
  const pj = Math.min(n - 1, probeIndex)
  ctx.beginPath()
  ctx.moveTo(xPix(f, x[pj]) + 0.5, f.y0)
  ctx.lineTo(xPix(f, x[pj]) + 0.5, f.y0 + f.h)
  ctx.strokeStyle = theme.ero
  ctx.setLineDash([2, 3])
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.setLineDash([])

  // linked hover ghost (crosshair when the hover carries a time)
  if (hover) {
    const hj = Math.min(n - 1, hover.index)
    ctx.globalAlpha = 0.45
    ctx.strokeStyle = theme.ink
    ctx.setLineDash([1, 3])
    ctx.beginPath()
    ctx.moveTo(xPix(f, x[hj]) + 0.5, f.y0)
    ctx.lineTo(xPix(f, x[hj]) + 0.5, f.y0 + f.h)
    ctx.stroke()
    if (hover.time !== null && times) {
      const hy = yPix(f, times[Math.min(nt - 1, hover.time)] * tf)
      ctx.beginPath()
      ctx.moveTo(f.x0, hy + 0.5)
      ctx.lineTo(f.x0 + f.w, hy + 0.5)
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
  ctx.restore()

  const units = (m.space as { units?: string })?.units ?? m.elevationUnits
  drawFrame(ctx, f, `distance (${units})`, `time (${m.time.displayUnits})`, {
    ink: theme.inkSoft,
    faint: theme.faint,
  })

  drawColorbar(
    ctx, f.x0 + f.w + 14, f.y0, f.h,
    (t) => wheelerColor(vmin + t * (vmax - vmin), vmin, vmax),
    vmin, vmax, `elev. change (${m.elevationUnits})`,
    { ink: theme.inkSoft, faint: theme.faint },
  )
  return f
}
