import { useAppStore } from '../state/store'

export function Header() {
  const datasets = useAppStore((s) => s.datasets)
  const datasetId = useAppStore((s) => s.datasetId)
  const dataset = useAppStore((s) => s.dataset)
  const selectDataset = useAppStore((s) => s.selectDataset)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)

  return (
    <>
      <header className="header">
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
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={`switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          aria-label="toggle color theme"
        >
          {theme === 'light' ? <MoonIcon /> : <SunIcon />}
        </button>
      </header>
      <div className="subhead">
        <span className="subhead__desc">{dataset?.manifest.description ?? '…'}</span>
        <span className="subhead__right">
          <span className="subhead__cite">{dataset?.manifest.citation ?? ''} · </span>
          <a
            className="subhead__link"
            href="https://zsylvester.github.io/papers/stratigraphy_space_time/"
            target="_blank"
            rel="noopener noreferrer"
          >
            paper
          </a>
          {' · '}
          <a
            className="subhead__link"
            href="https://github.com/zsylvester/stratigraph"
            target="_blank"
            rel="noopener noreferrer"
          >
            code
          </a>
        </span>
      </div>
    </>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <path
        d="M12 8.6A5.5 5.5 0 0 1 5.4 2 5.5 5.5 0 1 0 12 8.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <circle cx="7" cy="7" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4
        return (
          <line
            key={i}
            x1={7 + Math.cos(a) * 4.6}
            y1={7 + Math.sin(a) * 4.6}
            x2={7 + Math.cos(a) * 6.3}
            y2={7 + Math.sin(a) * 6.3}
            stroke="currentColor"
            strokeWidth="1.2"
          />
        )
      })}
    </svg>
  )
}

function shortName(id: string, name: string): string {
  const short: Record<string, string> = {
    barrell: 'Barrell 1917',
    wheeler1964: 'Wheeler 1964',
    xes02: 'XES-02',
    tdwb17: 'TDWB-17-1',
    meanderpy: 'meanderpy',
  }
  return short[id] ?? name
}
