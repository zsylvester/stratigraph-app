import { useEffect, useRef } from 'react'

import { useAppStore } from '../state/store'
import { DatasetsTab } from './info/DatasetsTab'
import { GuideTab } from './info/GuideTab'

/**
 * The about/help overlay: Datasets (descriptions + credits) and Guide tabs.
 * Rendered only while store.infoView is set; full-screen on phones.
 */
export function InfoOverlay() {
  const infoView = useAppStore((s) => s.infoView)
  const setInfoView = useAppStore((s) => s.setInfoView)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Esc closes the overlay only: capture phase runs before PanelGrid's
  // bubble-phase Esc (which restores a maximized panel), stopPropagation
  // keeps that panel maximized until a second Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        useAppStore.getState().setInfoView(null)
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  if (!infoView) return null

  return (
    <div className="info-overlay" onClick={() => setInfoView(null)}>
      <div
        className="info-overlay__panel"
        role="dialog"
        aria-modal="true"
        aria-label="about & user guide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="info-overlay__head">
          <div className="info-overlay__tabs" role="tablist">
            {(['datasets', 'guide'] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={infoView === tab}
                className={`info-overlay__tab${infoView === tab ? ' is-active' : ''}`}
                onClick={() => setInfoView(tab)}
              >
                {tab === 'datasets' ? 'datasets & credits' : 'user guide'}
              </button>
            ))}
          </div>
          <button
            ref={closeRef}
            className="info-overlay__close"
            onClick={() => setInfoView(null)}
            title="close (Esc)"
            aria-label="close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        </div>
        <div className="info-overlay__body">
          {infoView === 'datasets' ? <DatasetsTab /> : <GuideTab />}
        </div>
      </div>
    </div>
  )
}
