import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useStore } from './store'
import { BaseMap } from './components/BaseMap'
import { Calculator } from './components/Calculator'
import { Timers } from './components/Timers'
import { Settings } from './components/Settings'
import { RebirthTab } from './components/RebirthTab'
import { ErrorBoundary } from './components/ErrorBoundary'
import { findByIncome } from './data/income'
import { formatCredits, getSellValue } from './data/droidValues'

function Toast() {
  const toast = useStore(s => s.toast)
  if (!toast) return null
  return <div className="toast">{toast.msg}</div>
}

function App() {
  const { activeTab, clickThrough, setClickThrough, collapsed } = useStore()
  const timersDetached = useStore(s => s.timersDetached)
  const panelSize = useStore(s => s.panelSize ?? 'M')
  const customW = useStore(s => s.panelW)
  const customH = useStore(s => s.panelH)
  const panelWidth = customW ?? (panelSize === 'S' ? 300 : panelSize === 'L' ? 420 : 350)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Manual drag-resize: left edge = width, bottom edge = height.
  // Direct DOM updates during the drag (no re-renders), committed to the
  // persisted store on release. Double-click a handle to reset it.
  const beginResize = (mode: 'w' | 'h') => (e: ReactMouseEvent) => {
    if (useStore.getState().clickThrough) return
    e.preventDefault()
    e.stopPropagation()
    const el = panelRef.current
    if (!el) return
    const startX = e.clientX
    const startY = e.clientY
    const startW = el.offsetWidth
    const startH = el.offsetHeight
    const onMove = (ev: MouseEvent) => {
      if (mode === 'w') {
        const w = Math.max(260, Math.min(640, Math.round(startW + startX - ev.clientX)))
        el.style.width = `${w}px`
      } else {
        const maxH = Math.round(window.innerHeight * 0.95)
        const h = Math.max(280, Math.min(maxH, Math.round(startH + ev.clientY - startY)))
        el.style.height = `${h}px`
      }
    }
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (mode === 'w') {
        useStore.getState().setPanelW(Math.max(260, Math.min(640, Math.round(startW + startX - ev.clientX))))
      } else {
        const maxH = Math.round(window.innerHeight * 0.95)
        useStore.getState().setPanelH(Math.max(280, Math.min(maxH, Math.round(startH + ev.clientY - startY))))
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    const api = window.electronAPI
    const unsubs: Array<() => void> = []
    if (api) {
      unsubs.push(api.onClickThroughChanged(setClickThrough))
      unsubs.push(api.onOpenTab((tab) => useStore.getState().setActiveTab(tab as AppState['activeTab'])))
      unsubs.push(api.onToggleCollapse(() => useStore.getState().toggleCollapsed()))
      unsubs.push(api.onFocusInput(() => {
        const focusRetry = (el: HTMLInputElement, tries = 5): void => {
          el.focus()
          el.select()
          if (tries <= 0) return
          setTimeout(() => {
            if (document.activeElement !== el) focusRetry(el, tries - 1)
          }, 120)
        }
        // Focus whatever is typeable right now: station picker first, then tab search.
        const picker = document.getElementById('picker-search') as HTMLInputElement | null
        if (picker) {
          focusRetry(picker)
          return
        }
        const rebirth = document.getElementById('rebirth-search') as HTMLInputElement | null
        if (rebirth) {
          focusRetry(rebirth)
          return
        }
        useStore.getState().showToast('Nothing to type in — open a station first (Droids) or go to Rebirth (F4).')
      }))
      unsubs.push(api.onDetectionUpdate((p) => useStore.getState().stageDetections(p.matches)))
      unsubs.push(api.onLiveScanChanged((v) => useStore.getState().setLiveScan(v)))
      unsubs.push(api.onSpotStatus(() => useStore.getState().showToast('🔍 Reading screen for income numbers…')))
      unsubs.push(api.onIncomeSpots((spots) => {
        const st = useStore.getState()
        st.setSpots(spots)
        // Instant path: a station picker is already open (armed) and the read
        // matches exactly one droid → place it immediately, no more taps.
        const armed = st.pickerSlot
        if (armed && spots.length > 0) {
          for (const sp of spots) {
            const hits = findByIncome(sp.value)
            if (hits.length === 1) {
              st.placeDroid(armed, hits[0].def.id, hits[0].quality)
              st.showToast(`✅ Placed ${hits[0].def.name} (${hits[0].quality}) — ${formatCredits(getSellValue(hits[0].def, hits[0].quality))}`)
              return
            }
          }
        }
        st.showToast(
          spots.length > 0
            ? `✅ Spotted ${spots.length} income value${spots.length > 1 ? 's' : ''} — open a station slot to match`
            : '❌ No income text found — aim at a droid so its popup shows, then F9'
        )
      }))
      unsubs.push(api.onTimersDetachedChanged((v) => useStore.getState().applyTimersDetached(v)))
    }
    // Ctrl+Z undo (overlay-scoped: only fires when the panel itself has focus,
    // so game keys are untouched; native text-field undo wins inside inputs).
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) {
        e.preventDefault()
        useStore.getState().undo()
      }
    }
    window.addEventListener('keydown', onKey)
    // Re-apply saved monitor choice (main starts with 'all')
    const pref = useStore.getState().overlayDisplay
    if (pref !== 'all') api?.setOverlayDisplay(Number(pref))
    // Re-apply saved timer placement (main starts detached)
    if (!useStore.getState().timersDetached) api?.setTimersDetached(false)
    return () => {
      unsubs.forEach(u => {
        try {
          u()
        } catch {}
      })
      window.removeEventListener('keydown', onKey)
    }
  }, [setClickThrough])

  // Pull-tab: slim edge handle, always clickable even in click-through mode
  if (collapsed) {
    return (
      <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
        <button
          className="icon-btn"
          title="Expand overlay (F8)"
          onClick={() => useStore.getState().setCollapsed(false)}
          style={{ width: 44, height: 44, fontSize: 22, borderRadius: 10, background: 'rgba(10,10,20,0.92)', borderColor: 'var(--gold)' }}
        >🤖</button>
      </div>
    )
  }

  return (
    <div ref={panelRef} className="overlay-panel" style={{ pointerEvents: clickThrough ? 'none' : 'auto', width: panelWidth, ...(customH ? { height: customH } : {}) }}>
      {!clickThrough && !collapsed && (
        <>
          <div className="resize-handle left" onMouseDown={beginResize('w')} onDoubleClick={() => useStore.getState().setPanelW(null)} title="Drag to resize width — double-click resets" />
          <div className="resize-handle bottom" onMouseDown={beginResize('h')} onDoubleClick={() => useStore.getState().setPanelH(null)} title="Drag to resize height — double-click resets" />
        </>
      )}
      <div className="panel-header">
        <span className="panel-title">Droid Tycoon Overlay</span>
        <span className={`mode-badge ${clickThrough ? 'game' : 'panel'}`} title={clickThrough ? 'Clicks pass through to Fortnite (F2 to interact)' : 'Overlay interactive (F2 for game)'}>
          {clickThrough ? '🎮 GAME' : '🖱️ PANEL'}
        </span>
        <div className="header-btns">
          <button className="icon-btn" title="Collapse to pull-tab (F8)" onClick={() => useStore.getState().setCollapsed(true)}>
            —
          </button>
          <button className="icon-btn" title="Toggle Click-Through (F2)" onClick={() => window.electronAPI?.setClickThrough(!clickThrough)}>
            {clickThrough ? '🔓' : '🔒'}
          </button>
          <button className="icon-btn" title="Hide Overlay (F1)" onClick={() => window.electronAPI?.setVisible(false)}>
            👁️
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab-btn ${activeTab === 'droids' ? 'active' : ''}`} onClick={() => useStore.getState().setActiveTab('droids')}>Droids <kbd>F3</kbd></button>
        <button className={`tab-btn ${activeTab === 'rebirth' ? 'active' : ''}`} onClick={() => useStore.getState().setActiveTab('rebirth')}>Rebirth <kbd>F4</kbd></button>
        <button className={`tab-btn ${activeTab === 'calculator' ? 'active' : ''}`} onClick={() => useStore.getState().setActiveTab('calculator')}>Calc <kbd>F5</kbd></button>
        <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => useStore.getState().setActiveTab('settings')}>Setup <kbd>F6</kbd></button>
        {!timersDetached && (
          <button className={`tab-btn ${activeTab === 'timers' ? 'active' : ''}`} onClick={() => useStore.getState().setActiveTab('timers')}>Timers <kbd>F7</kbd></button>
        )}
      </div>

      <div className="panel-content">
        <ErrorBoundary key={`droids-${activeTab}`} name="Droids">
          {activeTab === 'droids' && <BaseMap />}
        </ErrorBoundary>
        <ErrorBoundary key={`rebirth-${activeTab}`} name="Rebirth">
          {activeTab === 'rebirth' && <RebirthTab />}
        </ErrorBoundary>
        <ErrorBoundary key={`calc-${activeTab}`} name="Calculator">
          {activeTab === 'calculator' && <Calculator />}
        </ErrorBoundary>
        <ErrorBoundary key={`timers-${activeTab}`} name="Timers">
          {activeTab === 'timers' && !timersDetached && <Timers />}
        </ErrorBoundary>
        <ErrorBoundary key={`settings-${activeTab}`} name="Setup">
          {activeTab === 'settings' && <Settings />}
        </ErrorBoundary>
      </div>
      <Toast />

    </div>
  )
}

// Local alias so the open-tab handler stays typed without importing the store type.
type AppState = { activeTab: 'droids' | 'calculator' | 'timers' | 'settings' | 'rebirth' }

export default App
