/**
 * Minimal canvas plot frame: margins, data<->pixel transforms, ticks.
 * All views use these shared margins so vertically stacked panels (cross
 * section above Wheeler diagram) keep identical left/right plot edges.
 */

export const MARGIN = { left: 58, right: 14, top: 8, bottom: 30 }

export interface Frame {
  x0: number
  y0: number
  w: number
  h: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export function makeFrame(
  cw: number,
  ch: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): Frame {
  return {
    x0: MARGIN.left,
    y0: MARGIN.top,
    w: Math.max(10, cw - MARGIN.left - MARGIN.right),
    h: Math.max(10, ch - MARGIN.top - MARGIN.bottom),
    xMin,
    xMax,
    yMin,
    yMax,
  }
}

export function xPix(f: Frame, x: number): number {
  return f.x0 + ((x - f.xMin) / (f.xMax - f.xMin)) * f.w
}

/** y axis points up */
export function yPix(f: Frame, y: number): number {
  return f.y0 + f.h - ((y - f.yMin) / (f.yMax - f.yMin)) * f.h
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo
  if (span <= 0 || !Number.isFinite(span)) return [lo]
  const raw = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag
  const t0 = Math.ceil(lo / step) * step
  const out: number[] = []
  for (let t = t0; t <= hi + 1e-9 * span; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : t)
  return out
}

function fmtTick(v: number): string {
  const a = Math.abs(v)
  if (a >= 100000) return v.toExponential(0).replace('e+', 'e')
  if (a >= 1 || a === 0) return String(Math.round(v * 100) / 100)
  return v.toPrecision(2)
}

export interface FrameStyle {
  ink: string
  faint: string
  grid?: boolean
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  xLabel: string,
  yLabel: string,
  style: FrameStyle,
): void {
  ctx.save()
  ctx.font = '10px "Geist Mono", monospace'
  ctx.strokeStyle = style.faint
  ctx.fillStyle = style.ink
  ctx.lineWidth = 1

  ctx.strokeRect(f.x0 + 0.5, f.y0 + 0.5, f.w, f.h)

  for (const t of niceTicks(f.xMin, f.xMax, Math.max(3, Math.round(f.w / 90)))) {
    const px = xPix(f, t)
    ctx.beginPath()
    ctx.moveTo(px + 0.5, f.y0 + f.h)
    ctx.lineTo(px + 0.5, f.y0 + f.h + 4)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(fmtTick(t), px, f.y0 + f.h + 6)
  }
  for (const t of niceTicks(f.yMin, f.yMax, Math.max(3, Math.round(f.h / 45)))) {
    const py = yPix(f, t)
    ctx.beginPath()
    ctx.moveTo(f.x0 - 4, py + 0.5)
    ctx.lineTo(f.x0, py + 0.5)
    ctx.stroke()
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(fmtTick(t), f.x0 - 7, py)
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(xLabel, f.x0 + f.w / 2, f.y0 + f.h + MARGIN.bottom - 2)
  ctx.save()
  ctx.translate(12, f.y0 + f.h / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textBaseline = 'top'
  ctx.fillText(yLabel, 0, 0)
  ctx.restore()
  ctx.restore()
}

/** Sizes the canvas backing store to CSS pixels * dpr; returns a scaled ctx. */
export function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return null
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr
    canvas.height = h * dpr
  }
  const ctx = canvas.getContext('2d')!
  // full state reset (transform, clip, save stack) so nothing can leak
  // between frames; older engines fall back to transform + clear only
  if (typeof ctx.reset === 'function') ctx.reset()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return ctx
}

/** Theme colors resolved from CSS variables (falls back to hard-coded). */
export function themeColors(el: HTMLElement) {
  const cs = getComputedStyle(el)
  const get = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb
  return {
    ink: get('--ink', '#2a2318'),
    inkSoft: get('--ink-soft', '#7a6c54'),
    faint: get('--line-strong', '#b5a888'),
    paper: get('--paper', '#f6f1e7'),
    paper3: get('--paper-3', '#e4dac4'),
    dep: get('--dep', '#3d6b9e'),
    ero: get('--ero', '#a34a24'),
    vac: get('--vac', '#b9b0a0'),
  }
}
