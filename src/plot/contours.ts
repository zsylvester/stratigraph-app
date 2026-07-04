/** Marching-squares contour lines over a regular grid, drawn to canvas. */

/**
 * 3x3 box blur (edge-clamped) — takes the scan noise out of contour lines.
 * Returns a new array; the input is untouched.
 */
export function boxBlur3(field: Float32Array, nRows: number, nCols: number): Float32Array {
  const out = new Float32Array(nRows * nCols)
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      let sum = 0
      let cnt = 0
      for (let dr = -1; dr <= 1; dr++) {
        const rr = Math.min(nRows - 1, Math.max(0, r + dr))
        for (let dc = -1; dc <= 1; dc++) {
          const cc = Math.min(nCols - 1, Math.max(0, c + dc))
          const v = field[rr * nCols + cc]
          if (Number.isFinite(v)) {
            sum += v
            cnt++
          }
        }
      }
      out[r * nCols + c] = cnt > 0 ? sum / cnt : NaN
    }
  }
  return out
}

/**
 * Draw one contour level. Grid samples sit at cell centers; toPx maps
 * fractional grid coordinates (col, row) to canvas pixels.
 */
export function drawContour(
  ctx: CanvasRenderingContext2D,
  field: Float32Array,
  nRows: number,
  nCols: number,
  level: number,
  toPx: (col: number, row: number) => [number, number],
): void {
  ctx.beginPath()
  for (let r = 0; r < nRows - 1; r++) {
    for (let c = 0; c < nCols - 1; c++) {
      const v00 = field[r * nCols + c] // top-left
      const v01 = field[r * nCols + c + 1] // top-right
      const v10 = field[(r + 1) * nCols + c] // bottom-left
      const v11 = field[(r + 1) * nCols + c + 1] // bottom-right
      if (
        !Number.isFinite(v00) ||
        !Number.isFinite(v01) ||
        !Number.isFinite(v10) ||
        !Number.isFinite(v11)
      )
        continue

      let idx = 0
      if (v00 > level) idx |= 8
      if (v01 > level) idx |= 4
      if (v11 > level) idx |= 2
      if (v10 > level) idx |= 1
      if (idx === 0 || idx === 15) continue

      // edge interpolation points (fractional grid coords)
      const top = (): [number, number] => [c + (level - v00) / (v01 - v00), r]
      const bottom = (): [number, number] => [c + (level - v10) / (v11 - v10), r + 1]
      const left = (): [number, number] => [c, r + (level - v00) / (v10 - v00)]
      const right = (): [number, number] => [c + 1, r + (level - v01) / (v11 - v01)]

      const seg = (a: [number, number], b: [number, number]) => {
        const [x1, y1] = toPx(a[0], a[1])
        const [x2, y2] = toPx(b[0], b[1])
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
      }

      switch (idx) {
        case 1:
        case 14:
          seg(left(), bottom())
          break
        case 2:
        case 13:
          seg(bottom(), right())
          break
        case 3:
        case 12:
          seg(left(), right())
          break
        case 4:
        case 11:
          seg(top(), right())
          break
        case 5: // saddle
          seg(top(), left())
          seg(bottom(), right())
          break
        case 6:
        case 9:
          seg(top(), bottom())
          break
        case 7:
        case 8:
          seg(top(), left())
          break
        case 10: // saddle
          seg(top(), right())
          seg(left(), bottom())
          break
      }
    }
  }
  ctx.stroke()
}

/** Contour levels at a round step covering [lo, hi], aiming for ~n lines. */
export function contourLevels(lo: number, hi: number, n = 12): number[] {
  const span = hi - lo
  if (!(span > 0)) return []
  const raw = span / n
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v)
  return out
}
