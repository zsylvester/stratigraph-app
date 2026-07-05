import { useEffect, type ComponentType } from 'react'

import type { Dataset } from '../data/loader'
import type { Manifest } from '../data/types'
import { useAppStore } from '../state/store'
import { BarrellPanel } from './panels/BarrellPanel'
import { CrossSectionPanel } from './panels/CrossSectionPanel'
import { MapsPanel } from './panels/MapsPanel'
import { WheelerPanel } from './panels/WheelerPanel'

interface ViewDef {
  key: string
  title: string
  kinds: Array<Manifest['kind']>
  component: ComponentType<{ dataset: Dataset }>
}

/**
 * Layout: Barrell | Cross section
 *         Maps    | Wheeler diagram
 * Cross section sits directly above the Wheeler diagram — they share the
 * distance axis and identical plot margins, so their edges align.
 */
const VIEWS: ViewDef[] = [
  { key: 'barrell', title: 'Barrell plot', kinds: ['curve1d', 'section2d', 'grid3d'], component: BarrellPanel },
  { key: 'section', title: 'Cross section', kinds: ['section2d', 'grid3d'], component: CrossSectionPanel },
  { key: 'maps', title: 'Map view', kinds: ['grid3d'], component: MapsPanel },
  { key: 'wheeler', title: 'Chronostratigraphic diagram', kinds: ['section2d', 'grid3d'], component: WheelerPanel },
]

export function PanelGrid() {
  const dataset = useAppStore((s) => s.dataset)
  const expandedPanel = useAppStore((s) => s.expandedPanel)
  const toggleExpandedPanel = useAppStore((s) => s.toggleExpandedPanel)

  // Esc collapses a maximized panel
  useEffect(() => {
    if (!expandedPanel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleExpandedPanel(expandedPanel)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expandedPanel, toggleExpandedPanel])

  if (!dataset) return null
  const kind = dataset.manifest.kind

  return (
    <main className={`grid${expandedPanel ? ' has-expanded' : ''}`}>
      {VIEWS.map((view, i) => {
        const available = view.kinds.includes(kind)
        const View = view.component
        const expanded = expandedPanel === view.key
        return (
          <section
            key={view.key}
            className={`panel panel--${view.key}${available ? '' : ' is-unavailable'}${expanded ? ' panel--expanded' : ''}`}
          >
            <div className="panel__head">
              <span className="panel__num">{String(i + 1).padStart(2, '0')}</span>
              <h2 className="panel__title">{view.title}</h2>
              {available && (
                <button
                  className="panel__expand"
                  onClick={() => toggleExpandedPanel(view.key)}
                  title={expanded ? 'restore panel grid (Esc)' : 'maximize panel'}
                  aria-label={expanded ? 'restore panel grid' : 'maximize panel'}
                >
                  {expanded ? <CollapseIcon /> : <ExpandIcon />}
                </button>
              )}
            </div>
            {available ? (
              <View dataset={dataset} key={dataset.manifest.id} />
            ) : (
              <div className="panel__body">
                <div className="ph">
                  <p className="ph__unavailable">not applicable to this dataset ({kind})</p>
                </div>
              </div>
            )}
          </section>
        )
      })}
    </main>
  )
}

function ExpandIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M1 4.5V1h3.5M11 7.5V11H7.5M7.5 1H11v3.5M4.5 11H1V7.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M4.5 1v3.5H1M7.5 11V7.5H11M11 4.5H7.5V1M1 7.5h3.5V11" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
