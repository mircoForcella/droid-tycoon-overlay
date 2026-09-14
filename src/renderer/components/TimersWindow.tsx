import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Timers } from './Timers'

// Floating timer window (loaded with #timers hash): no chrome, no title,
// just the 3 see-through rectangles. Draggable while interactive, × to dock back.
export function TimersWindow() {
  // Shared persisted prefs: reflect the current mode on load, then track toggles.
  const [interactive, setInteractive] = useState(() => !useStore.getState().clickThrough)

  useEffect(() => {
    window.electronAPI?.onTimerOpacityChanged((v) => useStore.getState().applyTimerBgOpacity(v))
    window.electronAPI?.onClickThroughChanged((v) => setInteractive(!v))
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', background: 'transparent' }}>
      <div className="timer-float">
        <button
          className="timer-float-close"
          title="Dock timers back as a tab"
          onClick={() => useStore.getState().setTimersDetached(false)}
        >✕</button>
        <Timers bare showGrip={interactive} />
      </div>
    </div>
  )
}
