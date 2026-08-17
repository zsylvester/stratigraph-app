import { create } from 'zustand'

import { Dataset, fetchIndex, loadDataset } from '../data/loader'
import type { DatasetIndexEntry } from '../data/types'
import type { GridClean } from '../plot/three/gridClean'
import { gridCleanFor } from '../strat/clean'
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

  /**
   * Display cleanup for the current grid3d dataset (spike mask, plateau
   * wedges, junk-edge crop), or null while it is still being computed / for
   * other dataset kinds. It bounds what the section and probe sliders offer,
   * so every panel works over the same extent as the 3D block.
   */
  clean: GridClean | null

  /** current section: dip = fixed row, strike = fixed column (grid3d only) */
  sectionAxis: 'dip' | 'strike'
  /** ABSOLUTE grid index of the section on the perpendicular axis */
  sectionIndex: number
  /** ABSOLUTE grid index along the current section, probed by the Barrell plot */
  probeIndex: number
  /** layer coloring shared by the cross section and the Barrell column */
  sectionColorMode: 'age' | 'facies'
  /**
   * Linked hover: a location along the current section (and optionally a time
   * step, when hovering the Wheeler diagram). Ghost markers render in every
   * panel; null when the pointer is outside all plots.
   */
  hover: { index: number; time: number | null } | null

  /** color theme; canvases subscribe so they redraw when it flips */
  theme: 'light' | 'dark'

  /** panel key currently maximized to fill the grid, or null */
  expandedPanel: string | null

  /**
   * Zoomed distance range along the section, shared by the cross section and
   * the Wheeler diagram so their x-axes never diverge; null = full extent.
   */
  xZoom: [number, number] | null

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
  toggleTheme: () => void
  setXZoom: (z: [number, number] | null) => void
  toggleExpandedPanel: (key: string) => void
}

function initialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('stratigraph-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
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

/**
 * Selectable section positions on the perpendicular axis, inclusive. Cropped
 * to the clean sub-grid once known: the outer rows/columns are tank-wall junk
 * or scan-margin noise, and the 3D block never shows them either.
 */
export function sectionIndexRange(
  dataset: Dataset | null,
  axis: 'dip' | 'strike',
  clean: GridClean | null,
): [number, number] {
  if (!clean) return [0, sectionCount(dataset, axis) - 1]
  return axis === 'dip' ? [clean.r0, clean.r1] : [clean.c0, clean.c1]
}

/** Selectable probe positions ALONG the current section, inclusive. */
export function sectionSpanRange(
  dataset: Dataset | null,
  axis: 'dip' | 'strike',
  clean: GridClean | null,
): [number, number] {
  if (!clean) return [0, sectionLength(dataset, axis) - 1]
  return axis === 'dip' ? [clean.c0, clean.c1] : [clean.r0, clean.r1]
}

const clampTo = ([lo, hi]: [number, number], v: number) => Math.min(hi, Math.max(lo, Math.round(v)))

export const useAppStore = create<AppState>((set, get) => ({
  datasets: [],
  datasetId: null,
  dataset: null,
  loadError: null,
  timeStep: 0,
  playing: false,
  stepsPerSecond: 30,
  clean: null,
  sectionAxis: 'dip',
  sectionIndex: 0,
  probeIndex: 0,
  sectionColorMode: 'age',
  hover: null,
  theme: initialTheme(),
  expandedPanel: null,
  xZoom: null,

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
    set({ datasetId: id, dataset: null, clean: null, loadError: null, playing: false })
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
        xZoom: null,
      })
      // the grid analysis takes ~1-2 s in a worker; panels render the raw
      // extent until it lands, then re-render cropped and cleaned
      void gridCleanFor(ds).then((clean) => {
        if (get().datasetId !== id || !clean) return
        set({ clean })
        // re-clamp: the displayed extent is narrower than the raw grid
        const { sectionAxis, sectionIndex, probeIndex } = get()
        set({
          sectionIndex: clampTo(sectionIndexRange(ds, sectionAxis, clean), sectionIndex),
          probeIndex: clampTo(sectionSpanRange(ds, sectionAxis, clean), probeIndex),
        })
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
    const { dataset: ds, clean } = get()
    set({
      sectionAxis: axis,
      sectionIndex: clampTo(sectionIndexRange(ds, axis, clean), index),
      probeIndex: clampTo(sectionSpanRange(ds, axis, clean), get().probeIndex),
      // a different section has a different distance axis
      xZoom: axis === get().sectionAxis ? get().xZoom : null,
    })
  },

  setProbeIndex: (i) => {
    const { dataset: ds, sectionAxis, clean } = get()
    set({ probeIndex: clampTo(sectionSpanRange(ds, sectionAxis, clean), i) })
  },

  setSectionColorMode: (m) => set({ sectionColorMode: m }),

  setHover: (h) => set({ hover: h }),

  toggleTheme: () => {
    const theme = get().theme === 'light' ? 'dark' : 'light'
    localStorage.setItem('stratigraph-theme', theme)
    set({ theme })
  },

  setXZoom: (z) => set({ xZoom: z }),

  toggleExpandedPanel: (key) =>
    set({ expandedPanel: get().expandedPanel === key ? null : key }),
}))
