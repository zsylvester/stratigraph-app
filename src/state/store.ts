import { create } from 'zustand'

import { Dataset, fetchIndex, loadDataset } from '../data/loader'
import type { DatasetIndexEntry } from '../data/types'
import { applyUrlState, parseHash } from './urlSync'

/**
 * Global app state. The time step is shared by every view (Barrell plot, cross
 * sections, Wheeler diagram, maps) — that linkage is the core of the app.
 */
interface AppState {
  datasets: DatasetIndexEntry[]
  datasetId: string | null
  dataset: Dataset | null
  loadError: string | null

  /** current time step, 0 .. nt-1 */
  timeStep: number
  playing: boolean
  /** playback speed in time steps per second */
  stepsPerSecond: number

  /** current section: dip = fixed row, strike = fixed column (grid3d only) */
  sectionAxis: 'dip' | 'strike'
  sectionIndex: number
  /** location along the current section probed by the Barrell plot */
  probeIndex: number
  /** layer coloring shared by the cross section and the Barrell column */
  sectionColorMode: 'age' | 'facies'
  /**
   * Linked hover: a location along the current section (and optionally a time
   * step, when hovering the Wheeler diagram). Ghost markers render in every
   * panel; null when the pointer is outside all plots.
   */
  hover: { index: number; time: number | null } | null

  init: () => Promise<void>
  selectDataset: (id: string) => Promise<void>
  setTimeStep: (t: number) => void
  stepBy: (dt: number) => void
  setPlaying: (p: boolean) => void
  togglePlaying: () => void
  setStepsPerSecond: (s: number) => void
  setSection: (axis: 'dip' | 'strike', index: number) => void
  setProbeIndex: (i: number) => void
  setSectionColorMode: (m: 'age' | 'facies') => void
  setHover: (h: { index: number; time: number | null } | null) => void
}

/** length of a section (number of points) for the current axis */
export function sectionLength(dataset: Dataset | null, axis: 'dip' | 'strike'): number {
  const m = dataset?.manifest
  if (!m) return 1
  if (m.kind === 'grid3d') {
    const shape = (m.space as { shape: [number, number] }).shape
    // a dip section runs along columns; a strike section along rows
    return axis === 'dip' ? shape[1] : shape[0]
  }
  if (m.kind === 'section2d') return (m.space as { nx: number }).nx
  return 1
}

/** number of section positions available on the perpendicular axis */
export function sectionCount(dataset: Dataset | null, axis: 'dip' | 'strike'): number {
  const m = dataset?.manifest
  if (!m || m.kind !== 'grid3d') return 1
  const shape = (m.space as { shape: [number, number] }).shape
  return axis === 'dip' ? shape[0] : shape[1]
}

export const useAppStore = create<AppState>((set, get) => ({
  datasets: [],
  datasetId: null,
  dataset: null,
  loadError: null,
  timeStep: 0,
  playing: false,
  stepsPerSecond: 30,
  sectionAxis: 'dip',
  sectionIndex: 0,
  probeIndex: 0,
  sectionColorMode: 'age',
  hover: null,

  init: async () => {
    try {
      const index = await fetchIndex()
      set({ datasets: index.datasets })
      // dataset from the URL hash when valid, else the first in the index
      const url = parseHash()
      const id =
        url.d && index.datasets.some((d) => d.id === url.d)
          ? url.d
          : index.datasets[0]?.id
      if (id) {
        await get().selectDataset(id)
        applyUrlState(url)
      }
    } catch (e) {
      set({ loadError: String(e) })
    }
  },

  selectDataset: async (id) => {
    set({ datasetId: id, dataset: null, loadError: null, playing: false })
    try {
      const ds = await loadDataset(id)
      // stale response guard: user may have switched again while loading
      if (get().datasetId !== id) return
      // section defaults from the manifest views (paper figures)
      const views = ds.manifest.views
      const dipDefault =
        (views.dipSection?.defaultLoc as number | undefined) ??
        Math.floor(sectionCount(ds, 'dip') / 2)
      // start at the final time step: the complete stratigraphy, as in the paper
      set({
        dataset: ds,
        timeStep: ds.manifest.time.n - 1,
        sectionAxis: 'dip',
        sectionIndex: dipDefault,
        probeIndex: Math.floor(sectionLength(ds, 'dip') / 2),
      })
    } catch (e) {
      if (get().datasetId === id) set({ loadError: String(e) })
    }
  },

  setTimeStep: (t) => {
    const ds = get().dataset
    if (!ds) return
    const nt = ds.manifest.time.n
    set({ timeStep: Math.min(nt - 1, Math.max(0, Math.round(t))) })
  },

  stepBy: (dt) => get().setTimeStep(get().timeStep + dt),

  setPlaying: (p) => set({ playing: p }),

  togglePlaying: () => {
    const { playing, timeStep, dataset } = get()
    // pressing play at the end restarts from the beginning
    if (!playing && dataset && timeStep >= dataset.manifest.time.n - 1) {
      set({ timeStep: 0 })
    }
    set({ playing: !playing })
  },

  setStepsPerSecond: (s) => set({ stepsPerSecond: s }),

  setSection: (axis, index) => {
    const ds = get().dataset
    const nSec = sectionCount(ds, axis)
    const clamped = Math.min(nSec - 1, Math.max(0, Math.round(index)))
    const nLen = sectionLength(ds, axis)
    set({
      sectionAxis: axis,
      sectionIndex: clamped,
      probeIndex: Math.min(nLen - 1, get().probeIndex),
    })
  },

  setProbeIndex: (i) => {
    const nLen = sectionLength(get().dataset, get().sectionAxis)
    set({ probeIndex: Math.min(nLen - 1, Math.max(0, Math.round(i))) })
  },

  setSectionColorMode: (m) => set({ sectionColorMode: m }),

  setHover: (h) => set({ hover: h }),
}))
