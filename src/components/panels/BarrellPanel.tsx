import { useEffect, useRef, useState } from 'react'

import type { Dataset } from '../../data/loader'
import { drawFrame, makeFrame, setupCanvas, themeColors, xPix, yPix } from '../../plot/frame'
import { classify, retroDeform } from '../../strat/core'
import {
  css,
  FACIES_COLORS,
  faciesFromDepth,
  hexToRgb,
  LAYER_FACIES_COLORS,
  viridis,
} from '../../strat/colormaps'
import { useSection } from '../../strat/useSection'
import { sectionLength, useAppStore } from '../../state/store'

interface Curve {
  times: Float64Array
  e: Float32Array
  cls: Int8Array
  /** raw (non-retro-deformed) elevation at the probe, for facies coloring */
  rawTopo: Float32Array | null
  seaLevel: Float64Array | null
  /** per-interval facies labels (e.g. meanderpy point bar / levee) */
  layerFacies: Int8Array | null
}

/**
 * Time-elevation (Barrell) plot at one location: elevation history colored by
 * deposition/erosion/stasis, preserved-elevation profile, and the resulting
 * stratigraphic column (colored by age, unconformities in red). For 2D/3D
 * datasets the location is the probe along the current section.
 */
export function BarrellPanel({ dataset }: { dataset: Dataset }) {
  const timeStep = useAppStore((s) => s.timeStep)
  const probeIndex = useAppStore((s) => s.probeIndex)
  const colorMode = useAppStore((s) => s.sectionColorMode)
  const hover = useAppStore((s) => s.hover)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sectionState = useSection(dataset)
  const [curve, setCurve] = useState<Curve | null>(null)
  const [showScan, setShowScan] = useState(false)
  const uiTheme = useAppStore((s) => s.theme) // redraw when the theme flips
  const scanRef = useRef<{ img: HTMLImageElement; extent: number[] } | null>(null)

  const m = dataset.manifest
  const isCurve = m.kind === 'curve1d'
  const scanAsset = m.assets?.barrellOriginal

  // original-plot scan underlay (Barrell dataset only)
  useEffect(() => {
    scanRef.current = null
    if (!scanAsset?.extent) return
    const img = new Image()
    img.onload = () => {
      scanRef.current = { img, extent: scanAsset.extent! }
    }
    img.src = `${import.meta.env.BASE_URL}data/${m.id}/${scanAsset.path}`
  }, [scanAsset, m.id])

  // assemble the elevation series + classification for the probed location
  useEffect(() => {
    let cancelled = false
    const res = m.processing.resolution
    void (async () => {
      const times = (await dataset.array(m.time.array)).data as Float64Array
      let e: Float32Array
      let rawTopo: Float32Array | null = null
      let seaLevel: Float64Array | null = null
      let layerFacies: Int8Array | null = null
      if (isCurve) {
        const el = await dataset.array('elevation')
        e = Float32Array.from(el.data as Float64Array)
      } else {
        if (!sectionState) return
        const sec = sectionState.section
        const j = Math.min(sec.n - 1, probeIndex)
        // elevation history at the probe, in the final-datum frame (the datum
        // choice does not affect the classification or geometry of the plot)
        const topoS = retroDeform(sec, sec.nt - 1)
        e = topoS.slice(j * sec.nt, (j + 1) * sec.nt)
        rawTopo = sec.topo.slice(j * sec.nt, (j + 1) * sec.nt)
        if (m.kind === 'grid3d' && m.arrays.seaLevel) {
          seaLevel = (await dataset.array('seaLevel')).data as Float64Array
        }
        if (m.derived?.layerFacies) {
          layerFacies = (await dataset.array('layerFacies')).data as Int8Array
        }
      }
      const cls = new Int8Array(e.length - 1)
      classify(e, 0, e.length, res, cls, 0)
      if (!cancelled) setCurve({ times, e, cls, rawTopo, seaLevel, layerFacies })
    })()
    return () => {
      cancelled = true
    }
  }, [dataset, m, isCurve, sectionState, probeIndex])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !curve) return
    const draw = () => {
      const ctx = setupCanvas(canvas)
      if (!ctx) return
      drawBarrell(
        ctx, canvas, curve, timeStep, dataset, colorMode, hover,
        showScan ? scanRef.current : null,
      )
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [curve, timeStep, dataset, colorMode, hover, showScan, uiTheme])

  return (
    <div className="panel__body">
      <div className="controls-row">
        {!isCurve && <ProbeControls dataset={dataset} />}
        {scanAsset && (
          <button
            className={`seg__btn seg__btn--solo${showScan ? ' is-active' : ''}`}
            onClick={() => setShowScan((v) => !v)}
            title="show Barrell's original 1917 figure behind the curve"
          >
            1917 scan
          </button>
        )}
      </div>
      <canvas ref={canvasRef} className="plot-canvas" />
    </div>
  )
}

function ProbeControls({ dataset }: { dataset: Dataset }) {
  const sectionAxis = useAppStore((s) => s.sectionAxis)
  const probeIndex = useAppStore((s) => s.probeIndex)
  const setProbeIndex = useAppStore((s) => s.setProbeIndex)
  const n = sectionLength(dataset, sectionAxis)
  return (
    <>
      <span className="controls-row__label">location along section</span>
      <input
        type="range"
        className="mini-slider"
        min={0}
        max={n - 1}
        value={probeIndex}
        onChange={(e) => setProbeIndex(Number(e.target.value))}
        aria-label="probe location"
      />
      <span className="controls-row__readout">{probeIndex}/{n - 1}</span>
    </>
  )
}

const COLUMN_W = 64 // px reserved on the right for the stratigraphic column

function drawBarrell(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  curve: Curve,
  k: number,
  dataset: Dataset,
  colorMode: 'age' | 'facies',
  hover: { index: number; time: number | null } | null,
  scan: { img: HTMLImageElement; extent: number[] } | null,
) {
  const { times, e, cls, rawTopo, seaLevel, layerFacies } = curve
  const m = dataset.manifest
  const nt = e.length
  const kk = Math.min(k, nt - 1)
  const theme = themeColors(canvas)
  const tf = m.time.displayFactor

  // fixed elevation/time ranges over the full series for a stable frame
  let lo = Infinity
  let hi = -Infinity
  for (const v of e) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const pad = (hi - lo) * 0.06
  const f = makeFrame(
    canvas.clientWidth - COLUMN_W,
    canvas.clientHeight,
    times[0] * tf,
    times[nt - 1] * tf,
    lo - pad,
    hi + pad,
  )

  // preserved elevation profile as of kk: reverse cummin of e[0..kk]
  const strat = new Float32Array(kk + 1)
  let mn = e[kk]
  for (let i = kk; i >= 0; i--) {
    if (e[i] < mn) mn = e[i]
    strat[i] = mn
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(f.x0, f.y0, f.w, f.h)
  ctx.clip()

  // original 1917 figure scan behind the curve; on dark paper, invert the
  // black-on-white scan and screen it so the linework reads as light lines
  if (scan) {
    const [sx0, sx1, sy0, sy1] = scan.extent
    const px0 = xPix(f, sx0)
    const px1 = xPix(f, sx1)
    const py0 = yPix(f, sy0)
    const py1 = yPix(f, sy1)
    const [pr, pg, pb] = hexToRgb(theme.paper)
    const darkPaper = 0.299 * pr + 0.587 * pg + 0.114 * pb < 128
    if (darkPaper) {
      ctx.filter = 'invert(1)'
      ctx.globalCompositeOperation = 'screen'
    } else {
      ctx.globalCompositeOperation = 'multiply'
    }
    ctx.drawImage(scan.img, px0, py1, px1 - px0, py0 - py1)
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
  }

  // linked hover ghost (time position)
  if (hover?.time !== null && hover?.time !== undefined) {
    const ht = Math.min(nt - 1, hover.time)
    ctx.globalAlpha = 0.45
    ctx.beginPath()
    ctx.moveTo(xPix(f, times[ht] * tf) + 0.5, f.y0)
    ctx.lineTo(xPix(f, times[ht] * tf) + 0.5, f.y0 + f.h)
    ctx.strokeStyle = theme.ink
    ctx.setLineDash([1, 3])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  // preserved profile (dashed, under the curve)
  ctx.beginPath()
  for (let i = 0; i <= kk; i++) {
    const px = xPix(f, times[i] * tf)
    const py = yPix(f, strat[i])
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.strokeStyle = theme.inkSoft
  ctx.setLineDash([4, 3])
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.setLineDash([])

  // elevation curve segments colored by classification
  const colorFor = (c: number) => (c > 0 ? theme.dep : c < 0 ? theme.ero : theme.vac)
  for (let i = 0; i < kk; i++) {
    ctx.beginPath()
    ctx.moveTo(xPix(f, times[i] * tf), yPix(f, e[i]))
    ctx.lineTo(xPix(f, times[i + 1] * tf), yPix(f, e[i + 1]))
    ctx.strokeStyle = colorFor(cls[i])
    ctx.lineWidth = 1.8
    ctx.stroke()
  }

  // time cursor
  ctx.beginPath()
  ctx.moveTo(xPix(f, times[kk] * tf) + 0.5, f.y0)
  ctx.lineTo(xPix(f, times[kk] * tf) + 0.5, f.y0 + f.h)
  ctx.strokeStyle = theme.ero
  ctx.lineWidth = 1
  ctx.setLineDash([2, 3])
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  drawFrame(ctx, f, `time (${m.time.displayUnits})`, `elevation (${m.elevationUnits})`, {
    ink: theme.inkSoft,
    faint: theme.faint,
  })

  // ---- stratigraphic column on the right (same elevation scale) ----
  const cx = f.x0 + f.w + 14
  const cw = COLUMN_W - 26
  ctx.strokeStyle = theme.faint
  ctx.strokeRect(cx + 0.5, f.y0 + 0.5, cw, f.h)

  // preserved intervals colored by age or by facies at deposition (shared
  // with the cross section); unconformities where preservation is interrupted
  const bins = (m.processing.faciesDepthBins as number[] | undefined) ?? [0, -100]
  const useLayerFacies = colorMode === 'facies' && layerFacies !== null
  const useFacies =
    colorMode === 'facies' && !useLayerFacies && rawTopo !== null && seaLevel !== null
  const intervalColor = (i: number) =>
    useLayerFacies
      ? layerFacies![i] >= 0
        ? LAYER_FACIES_COLORS[layerFacies![i]]
        : theme.vac
      : useFacies
        ? FACIES_COLORS[faciesFromDepth(rawTopo![i] - seaLevel![i], bins)]
        : css(viridis(i / Math.max(1, nt - 2)))
  let runTopIdx: number | null = null
  for (let i = 0; i < kk; i++) {
    const d = strat[i + 1] - strat[i]
    if (d > 0) {
      const y0 = yPix(f, strat[i])
      const y1 = yPix(f, strat[i + 1])
      ctx.fillStyle = intervalColor(i)
      ctx.fillRect(cx + 1, y1, cw - 1, y0 - y1)
      runTopIdx = i + 1
    } else if (runTopIdx !== null && cls[i] < 0) {
      // erosion after deposition: mark the truncated top as an unconformity
      const y = yPix(f, strat[runTopIdx])
      ctx.strokeStyle = theme.ero
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(cx, y + 0.5)
      ctx.lineTo(cx + cw, y + 0.5)
      ctx.stroke()
      runTopIdx = null
    }
  }

  ctx.fillStyle = theme.inkSoft
  ctx.font = '10px "IBM Plex Mono", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('column', cx + cw / 2, f.y0 + f.h + 16)

  // ---- time-fraction summary, paper convention: deposition counts only
  // preserved intervals; deposition later removed by erosion is vacuity ----
  const eps = 1e-9
  let nDep = 0
  let nEro = 0
  let nVac = 0
  for (let i = 0; i < kk; i++) {
    if (cls[i] > 0) {
      if (strat[i + 1] - strat[i] > eps) nDep++
      else nVac++
    } else if (cls[i] < 0) nEro++
  }
  const frac = (v: number) => ((100 * v) / Math.max(1, kk)).toFixed(0)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  let sx = f.x0 + 6
  for (const [label, v, color] of [
    ['dep', nDep, theme.dep],
    ['ero', nEro, theme.ero],
    ['vacuity', nVac, theme.vac],
    ['stasis', kk - nDep - nEro - nVac, theme.inkSoft],
  ] as const) {
    const txt = `${label} ${frac(v)}%`
    ctx.fillStyle = color
    ctx.fillText(txt, sx, f.y0 + 4)
    sx += ctx.measureText(txt).width + 14
  }
}
