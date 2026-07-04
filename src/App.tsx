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
  const theme = useAppStore((s) => s.theme)

  useEffect(() => {
    void init()
  }, [init])

  // theme lives on <html> so CSS variables (and the canvases reading them)
  // all flip together
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

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
