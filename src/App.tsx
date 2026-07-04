import { useEffect } from 'react'

import { Header } from './components/Header'
import { PanelGrid } from './components/PanelGrid'
import { TimelineBar } from './components/TimelineBar'
import { useKeyboardShortcuts, usePlaybackLoop } from './state/playback'
import { useAppStore } from './state/store'
import { useUrlSync } from './state/urlSync'

export default function App() {
  const init = useAppStore((s) => s.init)
  const dataset = useAppStore((s) => s.dataset)
  const loadError = useAppStore((s) => s.loadError)

  useEffect(() => {
    void init()
  }, [init])

  usePlaybackLoop()
  useKeyboardShortcuts()
  useUrlSync()

  return (
    <div className="app">
      <Header />
      {loadError ? (
        <div className="error">{loadError}</div>
      ) : dataset ? (
        <PanelGrid />
      ) : (
        <div className="loading">loading dataset…</div>
      )}
      <TimelineBar />
    </div>
  )
}
