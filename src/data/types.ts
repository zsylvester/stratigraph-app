/** TypeScript mirror of the bundle format documented in ../FORMAT.md. */

export type Dtype = 'int8' | 'int16' | 'float32' | 'float64'

export interface ArrayEntry {
  path: string
  dtype: Dtype
  shape: number[]
  /** int16 only: value = raw * scale + offset */
  scale?: number
  offset?: number
  /** int16 only: raw sentinel meaning NaN */
  nan?: number
  note?: string
}

export interface TimeInfo {
  n: number
  units: string
  displayUnits: string
  displayFactor: number
  array: string
}

export interface SpaceGrid3d {
  shape: [number, number]
  spacing: [number, number]
  axes: [string, string]
  units: string
}

export interface SpaceSection2d {
  nx: number
  dx: number
  x0: number
  units: string
}

/**
 * A per-time-step image sequence draped on a surface (e.g. XES-02 overhead
 * photos on the 3D block's topography). Images are pre-warped offline to grid
 * coordinates: row 0 = grid row 0, so u = (x - x0)/(x1 - x0), v = (y - y0)/
 * (y1 - y0) with extent = [x0, x1, y0, y1] in space units.
 */
export interface TextureSet {
  /** URL pattern relative to the bundle, '{step}' replaced by the step index */
  pattern: string
  /** zero-padding width of the step index in filenames */
  stepPad?: number
  /** number of images (= time steps) */
  n: number
  /** [x0, x1, y0, y1] coverage in grid node coordinates (space units) */
  extent: [number, number, number, number]
  size?: [number, number]
  note?: string
}

export interface Manifest {
  id: string
  name: string
  description: string
  citation: string
  kind: 'curve1d' | 'section2d' | 'grid3d'
  elevationUnits: string
  time: TimeInfo
  space?: SpaceGrid3d | SpaceSection2d
  processing: { resolution: number; [k: string]: unknown }
  keySurfaceIndices?: number[]
  arrays: Record<string, ArrayEntry>
  derived?: Record<string, ArrayEntry>
  assets?: Record<string, { path: string; extent?: number[] }>
  textures?: Record<string, TextureSet>
  views: Record<string, Record<string, unknown>>
}

export interface DatasetIndexEntry {
  id: string
  name: string
  description: string
  path: string
}

export interface DatasetIndex {
  datasets: DatasetIndexEntry[]
}
