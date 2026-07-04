/** Colorbars and legends drawn into a fixed-width right gutter of a canvas. */

import { css } from '../strat/colormaps'
import { niceTicks } from './frame'

/** gutter width reserved for colorbars — shared by the stacked section and
 * Wheeler panels so their plot areas keep identical horizontal extents */
export const CBAR_GUTTER = 74

export interface CbarTheme {
  ink: string
  faint: string
}

/** Vertical colorbar with ticks on the right and a rotated label. */
export function drawColorbar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  cmap: (t: number) => [number, number, number],
  vmin: number,
  vmax: number,
  label: string,
  theme: CbarTheme,
): void {
  const w = 12
  ctx.save()
  for (let i = 0; i < h; i++) {
    const t = 1 - i / (h - 1)
    ctx.fillStyle = css(cmap(t))
    ctx.fillRect(x, y + i, w, 1.5)
  }
  ctx.strokeStyle = theme.faint
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, w, h)

  ctx.font = '9px "IBM Plex Mono", monospace'
  ctx.fillStyle = theme.ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const v of niceTicks(vmin, vmax, 4)) {
    const py = y + h - ((v - vmin) / (vmax - vmin || 1)) * h
    ctx.beginPath()
    ctx.moveTo(x + w, py + 0.5)
    ctx.lineTo(x + w + 3, py + 0.5)
    ctx.strokeStyle = theme.faint
    ctx.stroke()
    ctx.fillText(fmt(v), x + w + 5, py)
  }

  ctx.translate(x + w + 46, y + h / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 0, 0)
  ctx.restore()
}

/** Swatch legend (e.g. facies) stacked downward from (x, y). */
export function drawSwatchLegend(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  entries: Array<{ color: string; label: string; line?: boolean }>,
  theme: CbarTheme,
): void {
  ctx.save()
  ctx.font = '9px "IBM Plex Mono", monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  entries.forEach((e, i) => {
    const ey = y + i * 18
    if (e.line) {
      ctx.strokeStyle = e.color
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(x, ey + 6)
      ctx.lineTo(x + 14, ey + 6)
      ctx.stroke()
    } else {
      ctx.fillStyle = e.color
      ctx.fillRect(x, ey, 14, 12)
      ctx.strokeStyle = theme.faint
      ctx.strokeRect(x + 0.5, ey + 0.5, 14, 12)
    }
    ctx.fillStyle = theme.ink
    // wrap two-word labels onto the swatch line
    ctx.fillText(e.label, x + 18, ey + 6)
  })
  ctx.restore()
}

/** Compact horizontal colorbar (for the map view), with halo text. */
export function drawHColorbar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  cmap: (t: number) => [number, number, number],
  vmin: number,
  vmax: number,
  label: string,
  theme: CbarTheme & { paper: string },
): void {
  const h = 9
  ctx.save()
  for (let i = 0; i < w; i++) {
    ctx.fillStyle = css(cmap(i / (w - 1)))
    ctx.fillRect(x + i, y, 1.5, h)
  }
  ctx.strokeStyle = theme.faint
  ctx.strokeRect(x + 0.5, y + 0.5, w, h)
  ctx.font = '9px "IBM Plex Mono", monospace'
  ctx.textBaseline = 'bottom'
  ctx.lineWidth = 3
  ctx.strokeStyle = theme.paper
  ctx.textAlign = 'left'
  ctx.strokeText(fmt(vmin), x, y - 2)
  ctx.fillStyle = theme.ink
  ctx.fillText(fmt(vmin), x, y - 2)
  ctx.textAlign = 'right'
  ctx.strokeStyle = theme.paper
  ctx.strokeText(fmt(vmax), x + w, y - 2)
  ctx.fillStyle = theme.ink
  ctx.fillText(fmt(vmax), x + w, y - 2)
  ctx.textAlign = 'center'
  ctx.strokeStyle = theme.paper
  ctx.strokeText(label, x + w / 2, y + h + 12)
  ctx.fillStyle = theme.ink
  ctx.fillText(label, x + w / 2, y + h + 12)
  ctx.restore()
}

function fmt(v: number): string {
  const a = Math.abs(v)
  if (a >= 10000) return v.toExponential(0).replace('e+', 'e')
  if (a >= 100) return String(Math.round(v))
  if (a >= 1 || v === 0) return String(Math.round(v * 10) / 10)
  return v.toPrecision(2)
}
