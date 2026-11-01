import { Fragment } from 'react'

import { guideSections } from '../../content/guide'

/** Renders the guide sections as scannable action/input tables. */
export function GuideTab() {
  return (
    <div className="info-content">
      {guideSections.map((sec) => (
        <section key={sec.id} className="info-entry">
          <h3 className="info-entry__title">{sec.title}</h3>
          {sec.body && <p className="info-entry__body">{sec.body}</p>}
          {sec.rows.length > 0 && (
            <div className="info-table">
              {sec.rows.map((row) => (
                <Fragment key={row.action}>
                  <div className="info-table__action">
                    {row.action}
                    {row.note && <span className="info-table__note"> — {row.note}</span>}
                  </div>
                  <div className="info-table__input">
                    {row.input.map((inp) => (
                      <Chip key={inp} value={inp} />
                    ))}
                  </div>
                </Fragment>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

/** A key/gesture chip; `ui:`-prefixed values name an on-screen control. */
function Chip({ value }: { value: string }) {
  const ui = value.startsWith('ui:')
  return <kbd className={`kbd${ui ? ' kbd--ui' : ''}`}>{ui ? value.slice(3) : value}</kbd>
}
