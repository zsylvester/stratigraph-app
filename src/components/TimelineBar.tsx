import { useEffect, useRef, useState } from 'react'

import type { Dataset } from '../data/loader'
import { useAppStore } from '../state/store'

/**
 * Bottom timeline strip: play controls, mono time readout, and a scrubber whose
 * track shows the dataset's driving signal (base level for XES-02, elevation
 * for the Barrell curve, mean topography for the Wheeler reconstruction) so the
 * shared time step always has visual context.
 */
export function TimelineBar() {
  const dataset = useAppStore((s) => s.dataset)
  const timeStep = useAppStore((s) => s.timeStep)
  const playing = useAppStore((s) => s.playing)
  const stepsPerSecond = useAppStore((s) => s.stepsPerSecond)
  const setTimeStep = useAppStore((s) => s.setTimeStep)
  const stepBy = useAppStore((s) => s.stepBy)
  const togglePlaying = useAppStore((s) => s.togglePlaying)
  const setStepsPerSecond = useAppStore((s) => s.setStepsPerSecond)

  const [times, setTimes] = useState<Float64Array | null>(null)
  const [signal, setSignal] = useState<Float32Array | null>(null)
  const uiTheme = useAppStore((s) => s.theme) // redraw when the theme flips
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // load the time vector and the context signal when the dataset changes
  useEffect(() => {
    setTimes(null)
    setSignal(null)
    if (!dataset) return
    let cancelled = false
    void loadSignal(dataset).then(([t, s]) => {
      if (!cancelled) {
        setTimes(t)
        setSignal(s)
      }
    })
    return () => {
      cancelled = true
    }
  }, [dataset])

  // draw the track
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !dataset) return
    const draw = () => drawTrack(canvas, signal, timeStep, dataset.manifest.time.n)
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [signal, timeStep, dataset, uiTheme])

  if (!dataset) return <footer className="timeline" />

  const nt = dataset.manifest.time.n
  const { displayFactor, displayUnits } = dataset.manifest.time
  const tVal = times ? times[timeStep] * displayFactor : null

  return (
    <footer className="timeline">
      <div className="timeline__controls">
        <button className="tbtn" onClick={() => stepBy(-1)} title="step back (←)">
          <StepIcon dir={-1} />
        </button>
        <button
          className="tbtn tbtn--play"
          onClick={togglePlaying}
          title="play / pause (space)"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="tbtn" onClick={() => stepBy(1)} title="step forward (→)">
          <StepIcon dir={1} />
        </button>
        <span className="timeline__readout">
          t = <b>{tVal === null ? '…' : formatTime(tVal)}</b> {displayUnits} · step{' '}
          {timeStep + 1}/{nt}
        </span>
        <div className="speed">
          {[10, 30, 60].map((s) => (
            <button
              key={s}
              className={`speed__btn${s === stepsPerSecond ? ' is-active' : ''}`}
              onClick={() => setStepsPerSecond(s)}
            >
              {s}/s
            </button>
          ))}
        </div>
        <span className="timeline__hint">space play · ←→ step · shift ×10</span>
      </div>
      <div className="timeline__track">
        <canvas ref={canvasRef} className="timeline__canvas" />
        <input
          type="range"
          className="timeline__slider"
          min={0}
          max={nt - 1}
          value={timeStep}
          onChange={(e) => setTimeStep(Number(e.target.value))}
          aria-label="time step"
        />
      </div>
    </footer>
  )
}

async function loadSignal(dataset: Dataset): Promise<[Float64Array, Float32Array]> {
  const m = dataset.manifest
  const timeArr = await dataset.array(m.time.array)
  const times = timeArr.data as Float64Array

  let signal: Float32Array
  if (m.kind === 'grid3d' && m.arrays.seaLevel) {
    const sl = await dataset.array('seaLevel')
    signal = Float32Array.from(sl.data as Float64Array)
  } else if (m.kind === 'grid3d') {
    // no sea level (e.g. fluvial models): mean elevation per step, sampled
    const topo = await dataset.array('topo')
    const [nRows, nCols, ntt] = topo.shape
    signal = new Float32Array(ntt)
    const stride = 4
    for (let i = 0; i < ntt; i++) {
      let sum = 0
      let cnt = 0
      for (let r = 0; r < nRows; r += stride) {
        for (let c = 0; c < nCols; c += stride) {
          sum += topo.data[(r * nCols + c) * ntt + i]
          cnt++
        }
      }
      signal[i] = sum / cnt
    }
  } else if (m.kind === 'curve1d') {
    const el = await dataset.array('elevation')
    signal = Float32Array.from(el.data as Float64Array)
  } else {
    // section2d: mean topographic elevation per time step (rows are surfaces)
    const topo = await dataset.array('topo')
    const [ntt, nx] = topo.shape
    signal = new Float32Array(ntt)
    for (let i = 0; i < ntt; i++) {
      let sum = 0
      for (let j = 0; j < nx; j++) sum += topo.data[i * nx + j]
      signal[i] = sum / nx
    }
  }
  return [times, signal]
}

function drawTrack(
  canvas: HTMLCanvasElement,
  signal: Float32Array | null,
  timeStep: number,
  nt: number,
) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  const css = getComputedStyle(canvas)
  const col = (name: string) => css.getPropertyValue(name).trim()

  ctx.clearRect(0, 0, w, h)
  const xAt = (i: number) => (i / (nt - 1)) * w

  // elapsed-time tint
  ctx.fillStyle = 'rgba(61, 107, 158, 0.10)'
  ctx.fillRect(0, 0, xAt(timeStep), h)

  if (signal) {
    let lo = Infinity
    let hi = -Infinity
    for (const v of signal) {
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    }
    const pad = 5
    const yAt = (v: number) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - 2 * pad)

    ctx.beginPath()
    for (let i = 0; i < signal.length; i++) {
      const v = signal[i]
      if (!Number.isFinite(v)) continue
      if (i === 0) ctx.moveTo(xAt(i), yAt(v))
      else ctx.lineTo(xAt(i), yAt(v))
    }
    ctx.strokeStyle = col('--ink-soft') || '#7a6c54'
    ctx.lineWidth = 1.25
    ctx.stroke()
  }

  // current-time marker
  ctx.fillStyle = col('--ero') || '#a34a24'
  ctx.fillRect(xAt(timeStep) - 1, 0, 2, h)
}

function formatTime(v: number): string {
  const a = Math.abs(v)
  if (a >= 10000) return Math.round(v).toLocaleString('en-US')
  if (a >= 100) return v.toFixed(0)
  if (a >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M2 1 L11 6 L2 11 Z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1.5" y="1" width="3.2" height="10" fill="currentColor" />
      <rect x="7.3" y="1" width="3.2" height="10" fill="currentColor" />
    </svg>
  )
}

function StepIcon({ dir }: { dir: 1 | -1 }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" style={{ transform: dir === -1 ? 'scaleX(-1)' : undefined }}>
      <path d="M1 1 L8 6 L1 11 Z" fill="currentColor" />
      <rect x="9" y="1" width="2" height="10" fill="currentColor" />
    </svg>
  )
}
