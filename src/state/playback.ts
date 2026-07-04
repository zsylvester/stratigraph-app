import { useEffect } from 'react'

import { useAppStore } from './store'

/** Drives the shared time step while playing; stops at the last step. */
export function usePlaybackLoop() {
  const playing = useAppStore((s) => s.playing)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let fractional = 0

    const tick = (now: number) => {
      const { stepsPerSecond, timeStep, dataset, setTimeStep, setPlaying } =
        useAppStore.getState()
      if (!dataset) return
      fractional += ((now - last) / 1000) * stepsPerSecond
      last = now
      const whole = Math.floor(fractional)
      if (whole > 0) {
        fractional -= whole
        const next = timeStep + whole
        if (next >= dataset.manifest.time.n - 1) {
          setTimeStep(dataset.manifest.time.n - 1)
          setPlaying(false)
          return
        }
        setTimeStep(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])
}

/** Space = play/pause, arrows = step (shift = 10x). */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')
        return
      const { togglePlaying, stepBy } = useAppStore.getState()
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlaying()
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        stepBy(e.shiftKey ? 10 : 1)
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        stepBy(e.shiftKey ? -10 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
