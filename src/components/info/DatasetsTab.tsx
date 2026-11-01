import { datasetCredits } from '../../content/datasets'
import { useAppStore } from '../../state/store'

/**
 * Dataset descriptions and credits. Each entry carries id="ds-<datasetId>" so
 * the header's "about" link can scroll straight to the active dataset.
 */
export function DatasetsTab() {
  const datasetId = useAppStore((s) => s.datasetId)

  return (
    <div className="info-content">
      <p className="info-content__intro">
        This is a web page that makes it possible to explore five stratigraphic
        datasets. The idea is to watch a landscape evolve and see how that evolution
        translates into stratigraphy. The two classic diagrams (Barrell and Wheeler)
        were digitized from the original publications; the two tank experiments were run
        and shared by the laboratories credited below; the meandering channel-belt model
        comes from a numerical model. All were processed into this app&rsquo;s format as
        described in Sylvester, Straub &amp; Covault (2024).
      </p>
      {datasetCredits.map((d) => (
        <section
          key={d.id}
          id={`ds-${d.id}`}
          className={`info-entry${d.id === datasetId ? ' is-current' : ''}`}
        >
          <h3 className="info-entry__title">
            {d.title}
            {d.id === datasetId && <span className="info-entry__badge">current</span>}
          </h3>
          <p className="info-entry__body">{d.summary}</p>
          <dl className="info-meta">
            <dt>source</dt>
            <dd>{d.origin}</dd>
            <dt>credit</dt>
            <dd>{d.credit}</dd>
          </dl>
          <ul className="info-refs">
            {d.references.map((r) => (
              <li key={r.title} className="info-refs__item">
                {r.authors} ({r.year}) {r.title}. <i>{r.source}</i>
                {r.pages ? `, ${r.pages}` : ''}.{' '}
                {r.doi ? (
                  <a
                    className="subhead__link"
                    href={`https://doi.org/${r.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    doi:{r.doi}
                  </a>
                ) : r.url ? (
                  <a
                    className="subhead__link"
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    link
                  </a>
                ) : null}
                {r.verify && <span className="verify-badge">verify</span>}
              </li>
            ))}
          </ul>
          {d.links.length > 0 && (
            <p className="info-links">
              {d.links.map((l, i) => (
                <span key={l.href}>
                  {i > 0 && ' · '}
                  <a
                    className="subhead__link"
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {l.label}
                  </a>
                </span>
              ))}
            </p>
          )}
        </section>
      ))}
    </div>
  )
}
