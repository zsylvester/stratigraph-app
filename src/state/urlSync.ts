/**
 * Shareable URL state: #d=xes02&t=207&ax=dip&sec=130&p=55&cm=facies
 * Read once at startup (init uses it to pick the dataset and view state);
 * written back with replaceState, debounced, as the state changes.
 */

import { useEffect } from 'react'

import { useAppStore } from './store'

export interface UrlState {
  d?: string
  t?: number
  ax?: 'dip' | 'strike'
  sec?: number
  p?: number
  cm?: 'age' | 'facies'
}

export function parseHash(): UrlState {
  const out: UrlState = {}
  const h = window.location.hash.replace(/^#/, '')
  if (!h) return out
  const params = new URLSearchParams(h)
  const d = params.get('d')
  if (d) out.d = d
  const num = (k: string) => {
    const v = params.get(k)
    return v !== null && Number.isFinite(Number(v)) ? Number(v) : undefined
  }
  out.t = num('t')
  out.sec = num('sec')
  out.p = num('p')
  const ax = params.get('ax')
  if (ax === 'dip' || ax === 'strike') out.ax = ax
  const cm = params.get('cm')
  if (cm === 'age' || cm === 'facies') out.cm = cm
  return out
}

/** Apply the non-dataset parts of a parsed hash to the store (post-load). */
export function applyUrlState(u: UrlState): void {
  const s = useAppStore.getState()
  if (!s.dataset) return
  if (u.ax !== undefined || u.sec !== undefined) {
    s.setSection(u.ax ?? s.sectionAxis, u.sec ?? s.sectionIndex)
  }
  if (u.p !== undefined) s.setProbeIndex(u.p)
  if (u.cm !== undefined) s.setSectionColorMode(u.cm)
  if (u.t !== undefined) s.setTimeStep(u.t)
}

/** Keep the location hash in sync with the store (debounced). */
export function useUrlSync(): void {
  useEffect(() => {
    let timer: number | null = null
    const unsub = useAppStore.subscribe((s) => {
      if (!s.datasetId || !s.dataset) return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const params = new URLSearchParams()
        params.set('d', s.datasetId!)
        params.set('t', String(s.timeStep))
        if (s.dataset!.manifest.kind === 'grid3d') {
          params.set('ax', s.sectionAxis)
          params.set('sec', String(s.sectionIndex))
        }
        if (s.dataset!.manifest.kind !== 'curve1d') {
          params.set('p', String(s.probeIndex))
          params.set('cm', s.sectionColorMode)
        }
        history.replaceState(null, '', `#${params.toString()}`)
      }, 250)
    })
    return () => {
      unsub()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])
}
