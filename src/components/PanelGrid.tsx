import type { ComponentType } from 'react'

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
  if (!dataset) return null
  const kind = dataset.manifest.kind

  return (
    <main className="grid">
      {VIEWS.map((view, i) => {
        const available = view.kinds.includes(kind)
        const View = view.component
        return (
          <section key={view.key} className={`panel${available ? '' : ' is-unavailable'}`}>
            <div className="panel__head">
              <span className="panel__num">{String(i + 1).padStart(2, '0')}</span>
              <h2 className="panel__title">{view.title}</h2>
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
