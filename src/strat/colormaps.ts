/** Small stop-interpolated colormaps matching the paper figures. */

type RGB = [number, number, number]

function hex(h: string): RGB {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}

function makeMap(stops: string[]): (t: number) => RGB {
  const cols = stops.map(hex)
  return (t: number) => {
    const c = Math.min(1, Math.max(0, t)) * (cols.length - 1)
    const i = Math.min(cols.length - 2, Math.floor(c))
    const f = c - i
    const a = cols[i]
    const b = cols[i + 1]
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
  }
}

/** matplotlib viridis (age coloring in cross sections / columns) */
export const viridis = makeMap([
  '#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c',
  '#28ae80', '#5ec962', '#addc30', '#fde725',
])

/** matplotlib RdBu (Wheeler diagrams: erosion red, deposition blue) */
const rdbu = makeMap([
  '#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7',
  '#d1e5f0', '#92c5de', '#4393c3', '#2166ac', '#053061',
])

/**
 * Wheeler colormap: RdBu with a white band at zero (stasis/vacuity), like the
 * notebook's ListedColormap with newcolors[126:131] = white.
 */
export function wheelerColor(v: number, vmin: number, vmax: number): RGB {
  const t = (v - vmin) / (vmax - vmin)
  if (Math.abs(t - 0.5) < 0.01) return [247, 247, 247]
  return rdbu(t)
}

/** approximation of cmocean 'deep' reversed (attribute maps) */
export const deepR = makeMap([
  '#fdfdcc', '#c8e8b5', '#8fd1ac', '#60b7a5', '#459ba0',
  '#3d7f9a', '#3d6494', '#42498b', '#3b2d59', '#281a2c',
].reverse())

export function css(c: RGB): string {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
}

/**
 * Facies colors by water depth at deposition (topset / foreset / bottomset),
 * as in the stratigraph package's list_of_colors.
 */
export const FACIES_COLORS = ['#fffacd', '#cd853f', '#a0522d'] // lemonchiffon / peru / sienna

/** facies index from water depth (wd = elevation - sea level) and depth bins */
export function faciesFromDepth(wd: number, bins: number[]): number {
  if (wd >= bins[0]) return 0
  if (wd >= bins[1]) return 1
  return 2
}
