import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useStore } from './store'
import { BaseMap } from './components/BaseMap'
import { Calculator } from './components/Calculator'
import { Timers } from './components/Timers'
import { Settings } from './components/Settings'
import { RebirthTab } from './components/RebirthTab'
import { ErrorBoundary } from './components/ErrorBoundary'
import { findByIncome } from './data/income'
import { formatCredits, getDroidDef, getSellValue, type Quality } from './data/droidValues'
import { ALL_SLOTS } from './data/droids'

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
  const panelWidth = customW ?? (panelSize === 'S' ? 340 : panelSize === 'L' ? 480 : 400)
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
        const w = Math.max(260, Math.min(720, Math.round(startW + startX - ev.clientX)))
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
        useStore.getState().setPanelW(Math.max(260, Math.min(720, Math.round(startW + startX - ev.clientX))))
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
    // Re-apply the saved monitor choice FIRST, defensively and before any
    // subscription below can throw: a window that never sends this boots (and
    // stays) on every monitor. Main also persists the choice itself, so this
    // is the second layer, not the only one.
    try {
      const pref = useStore.getState().overlayDisplay
      if (pref !== 'all') api?.setOverlayDisplay(Number(pref))
    } catch {}
    if (api) {
      unsubs.push(api.onClickThroughChanged(setClickThrough))
      unsubs.push(api.onOpenTab((tab) => useStore.getState().setActiveTab(tab as AppState['activeTab'])))
      // Symmetric minimize (F1): collapsing hands the mouse back to the game,
      // expanding hands it to the panel — one key, no F2 needed either way.
      // This also closes a trap: an interactive-but-minimized window is a
      // fullscreen invisible click-eater, so minimize always means game mode.
      unsubs.push(api.onToggleCollapse(() => {
        const st = useStore.getState()
        if (st.collapsed) {
          st.setCollapsed(false)
          st.setClickThrough(false)
        } else {
          st.setCollapsed(true)
          st.setClickThrough(true)
        }
      }))
      // Research mode (F10 / Enter): land interactive on the rebirth search.
      // Repeat press while the search already has focus wipes the query for a
      // fresh research — renderer-decided by focus, no press counting in main.
      // The droid picker handles itself (it mounts only when open): App stays
      // out whenever a selection is armed, so Enter still confirms there.
      const focusRetry = (el: HTMLInputElement, tries = 5): void => {
        el.focus()
        el.select()
        if (tries <= 0) return
        setTimeout(() => {
          if (document.activeElement !== el) focusRetry(el, tries - 1)
        }, 120)
      }
      const focusRebirthSearch = (): boolean => {
        const el = document.getElementById('rebirth-search') as HTMLInputElement | null
        if (!el) return false
        focusRetry(el)
        return true
      }
      unsubs.push(api.onResearchMode(() => {
        const st = useStore.getState()
        if (st.pickerSlot) return // droid selection open — picker owns this press
        st.setActiveTab('rebirth')
        // The tab switch mounts RebirthTab async; focus on the next frame.
        requestAnimationFrame(() => {
          const el = document.getElementById('rebirth-search') as HTMLInputElement | null
          if (!el) return
          if (document.activeElement === el) st.setRebirthQuery('')
          focusRetry(el)
        })
      }))
      // Focus-only path for the F10 foreground retries: never switches tabs,
      // never wipes — a retry landing mid-keystroke must not eat characters.
      unsubs.push(api.onResearchFocus(() => {
        const st = useStore.getState()
        const picker = st.pickerSlot
          ? (document.getElementById('picker-search') as HTMLInputElement | null)
          : null
        if (picker) { focusRetry(picker); return }
        focusRebirthSearch()
      }))
      unsubs.push(api.onDetectionUpdate((p) => useStore.getState().stageDetections(p.matches)))
      unsubs.push(api.onLiveScanChanged((v) => useStore.getState().setLiveScan(v)))
      unsubs.push(api.onSpotStatus(() => useStore.getState().showToast('🔍 Reading screen for income numbers…')))
      unsubs.push(api.onIncomeSpots((spots) => {
        const st = useStore.getState()
        st.setSpots(spots)
        // Instant path: a station picker is already open (armed) and the read
        // matches exactly one droid → place it immediately, no more taps.
        // F9 UX is "aim at the droid": try the crosshair-closest spot first.
        // Spots arrive center-ranked from main, but re-sort here so the
        // choice never depends on transport order (value-ascending used to
        // pick whatever was smallest, ignoring where you aim).
        const armed = st.pickerSlot
        if (armed && spots.length > 0) {
          const ordered = [...spots].sort(
            (a, b) =>
              (a.rx - 0.5) * (a.rx - 0.5) + (a.ry - 0.5) * (a.ry - 0.5) -
              ((b.rx - 0.5) * (b.rx - 0.5) + (b.ry - 0.5) * (b.ry - 0.5))
          )
          for (const sp of ordered) {
            const hits = findByIncome(sp.value)
            if (hits.length === 1) {
              st.placeDroid(armed, hits[0].def.id, hits[0].quality)
              st.showToast(`✅ Placed ${hits[0].def.name} (${hits[0].quality}) — ${formatCredits(getSellValue(hits[0].def, hits[0].quality))}`)
              return
            }
          }
        }
        // Match popup: any spot with table hits → centered floating window
        // (own window, never inside the panel). No area filter: any droid
        // can work any station, the user decides where it goes.
        if (spots.some(sp => findByIncome(sp.value).length > 0)) {
          api.openSpotWindow?.(spots)
          return
        }
        st.showToast(
          spots.length > 0
            ? `✅ Spotted ${spots.length} income value${spots.length > 1 ? 's' : ''} — open a station slot to match`
            : '❌ No income text found — aim at a droid so its popup shows, then F9'
        )
      }))
      unsubs.push(api.onTimersDetachedChanged((v) => useStore.getState().applyTimersDetached(v)))
      // Spot window placement: first free slot of the chosen station.
      // Runs here (panel process owns placements); the floating window only
      // collects droid + station and reports the result back through main.
      unsubs.push(api.onSpotPlaceRequest((req) => {
        const st = useStore.getState()
        const quality = req.quality as Quality
        try {
          const taken = new Set(st.placedDroids.map(p => p.slotId))
          const slot = ALL_SLOTS.find(s => s.category === req.station && !taken.has(s.id))
          if (!slot) {
            api.reportSpotPlaceDone({ reqId: req.reqId, ok: false, message: 'Station full — free a slot first.' })
            return
          }
          st.placeDroid(slot.id, req.droidId, quality)
          const def = getDroidDef(req.droidId)
          st.showToast(def ? `✅ Placed ${def.name} (${quality}) — ${formatCredits(getSellValue(def, quality))}` : '✅ Placed')
          api.reportSpotPlaceDone({ reqId: req.reqId, ok: true, message: 'placed' })
        } catch (e) {
          api.reportSpotPlaceDone({ reqId: req.reqId, ok: false, message: String((e as Error)?.message ?? e) })
        }
      }))
    }
    // Ctrl+Z undo (overlay-scoped: only fires when the panel itself has focus,
    // so game keys are untouched; native text-field undo wins inside inputs).
    // Enter (same scope): jump to Rebirth research — unless typing somewhere,
    // sitting on a button/select (native activation wins), the droid picker
    // is open (Enter confirms the selection there), or the panel is minimized
    // (unfocused, unreachable, but guarded anyway).
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      const inField = !!t && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) {
        e.preventDefault()
        useStore.getState().undo()
        return
      }
      if (e.key === 'Enter' && !e.repeat && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (inField || tag === 'BUTTON' || (t && t.isContentEditable)) return
        const st = useStore.getState()
        if (st.pickerSlot || st.collapsed) return
        e.preventDefault()
        api?.researchMode()
        return
      }
      // Rebirth-tab keys (panel-scoped like everything above): ↑/↓ step the
      // current path's rebirth (▲ back / ▼ forward, clamped 1–35 by the
      // store), 1–5 (row or numpad, NumLock on) jump Path buttons. Scoped to
      // the open Rebirth tab so arrows keep scrolling everywhere else, and
      // skipped while typing or while the picker owns the keyboard (it uses
      // arrows itself and confirms with Enter).
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.defaultPrevented) {
        const st = useStore.getState()
        // Arrows stay live even while typing in the rebirth search (digits
        // must still type, so only arrows get the exception — caret Up/Down
        // in that one single-line input is the accepted cost).
        const inRebirthSearch = tag === 'INPUT' && t?.id === 'rebirth-search'
        if (st.activeTab === 'rebirth' && !st.pickerSlot && !st.collapsed && (!inField || inRebirthSearch)) {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const p = st.rebirthPath
            const prog = st.rebirthProgress[String(p)] ?? 1
            st.setRebirthProgress(p, prog + (e.key === 'ArrowUp' ? -1 : 1))
            return
          }
          if (!inField && /^[1-5]$/.test(e.key)) {
            st.setRebirthPath(Number(e.key))
            return
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    // Respect the persisted minimize state: F1-minimize must survive relaunch
    // AND window recreation (display sleep/wake rebuilds every window and
    // used to force-expand all of them — full duplicate panel on screen 2).
    // Fresh installs boot expanded once via the store default (collapsed:
    // false); after that the user's saved state rules every window.
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
          title="Expand overlay (F1)"
          onClick={() => { useStore.getState().setCollapsed(false); useStore.getState().setClickThrough(false) }}
          style={{ width: 44, height: 44, fontSize: 22, borderRadius: 10, background: 'rgba(10,10,20,0.92)', borderColor: 'var(--gold)' }}
        >🤖</button>
      </div>
    )
  }

  return (
    <div ref={panelRef} className={`overlay-panel ${clickThrough ? 'mode-game' : 'mode-panel'}`} title={clickThrough ? 'Game mode — clicks pass through to Fortnite (F2 to interact)' : 'Panel mode — overlay interactive (F2 for game)'} style={{ pointerEvents: clickThrough ? 'none' : 'auto', width: panelWidth, ...(customH ? { height: customH } : {}) }}>
      {!clickThrough && !collapsed && (
        <>
          <div className="resize-handle left" onMouseDown={beginResize('w')} onDoubleClick={() => useStore.getState().setPanelW(null)} title="Drag to resize width — double-click resets" />
          <div className="resize-handle bottom" onMouseDown={beginResize('h')} onDoubleClick={() => useStore.getState().setPanelH(null)} title="Drag to resize height — double-click resets" />
        </>
      )}

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
