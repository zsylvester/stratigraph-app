import { useEffect, useState } from 'react'

import type { Dataset } from '../data/loader'
import { gridSection, Section, section2d, sectionBounds } from './core'
import { useAppStore } from '../state/store'

export interface SectionState {
  section: Section
  bounds: { lo: number; hi: number }
  /** what the section is, for labels: e.g. "dip 130" */
  label: string
}

/**
 * Loads/derives the current section (shared by the cross-section, Wheeler and
 * Barrell panels) whenever dataset or section selection changes.
 */
export function useSection(dataset: Dataset): SectionState | null {
  const sectionAxis = useAppStore((s) => s.sectionAxis)
  const sectionIndex = useAppStore((s) => s.sectionIndex)
  const [state, setState] = useState<SectionState | null>(null)

  useEffect(() => {
    const kind = dataset.manifest.kind
    if (kind === 'curve1d') {
      setState(null)
      return
    }
    let cancelled = false
    const p =
      kind === 'grid3d'
        ? gridSection(dataset, sectionAxis, sectionIndex)
        : section2d(dataset)
    void p.then((section) => {
      if (cancelled) return
      setState({
        section,
        bounds: sectionBounds(section),
        label: kind === 'grid3d' ? `${sectionAxis} ${sectionIndex}` : 'section',
      })
    })
    return () => {
      cancelled = true
    }
  }, [dataset, sectionAxis, sectionIndex])

  return state
}
