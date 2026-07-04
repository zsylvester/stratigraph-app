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
