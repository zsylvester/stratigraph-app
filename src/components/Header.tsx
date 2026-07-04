import { useAppStore } from '../state/store'

export function Header() {
  const datasets = useAppStore((s) => s.datasets)
  const datasetId = useAppStore((s) => s.datasetId)
  const dataset = useAppStore((s) => s.dataset)
  const selectDataset = useAppStore((s) => s.selectDataset)

  return (
    <>
      <header className="header">
        <div className="header__bands" aria-hidden="true" />
        <div className="header__mast">
          <img
            className="header__logo"
            src={`${import.meta.env.BASE_URL}stratigraph_logo.png`}
            alt="stratigraph"
          />
          <span className="header__tagline">stratigraphy in space &amp; time</span>
        </div>
        <div className="header__spacer" />
        <nav className="picker" aria-label="dataset">
          {datasets.map((d) => (
            <button
              key={d.id}
              className={`picker__btn${d.id === datasetId ? ' is-active' : ''}`}
              onClick={() => void selectDataset(d.id)}
            >
              {shortName(d.id, d.name)}
            </button>
          ))}
        </nav>
      </header>
      <div className="subhead">
        <span className="subhead__desc">{dataset?.manifest.description ?? '…'}</span>
        <span className="subhead__cite">{dataset?.manifest.citation ?? ''}</span>
      </div>
    </>
  )
}

function shortName(id: string, name: string): string {
  const short: Record<string, string> = {
    barrell: 'Barrell 1917',
    wheeler1964: 'Wheeler 1964',
    xes02: 'XES-02',
  }
  return short[id] ?? name
}
