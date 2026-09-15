import { useState } from 'react'
import { useStore } from '../store'
import { getSlotsByCategory, BaseSlot } from '../data/droids'
import { DROIDS, DroidDef, Quality, QUALITIES, getSellValue, formatCredits, getDroidDef } from '../data/droidValues'
import { getIncome, formatIncome, parseIncome, findByIncome } from '../data/income'

export function LiveScanBar() {
  const { liveScan, scanIntervalMs } = useStore()
  const s = useStore()

  const toggle = () => {
    const next = !useStore.getState().liveScan
    window.electronAPI?.setLiveScan(next, useStore.getState().scanIntervalMs)
    useStore.getState().setLiveScan(next)
  }

  const lastScan = useStore(st => st.lastScanAt)
  const lastMatchCount = useStore(st => st.lastMatchCount)
  const suggestions = useStore(st => st.suggestions)
  const autoAccept = useStore(st => st.autoAccept)

  return (
    <div style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${liveScan ? 'var(--green)' : 'var(--border)'}`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button className="icon-btn" style={{ width: 'auto', padding: '4px 12px', borderColor: liveScan ? 'var(--green)' : 'var(--border)', color: liveScan ? 'var(--green)' : 'var(--text)' }} onClick={toggle} title="Toggle visual station scan (default OFF to save CPU)">
          {liveScan ? '⏹ Stop scan' : '▶ Live scan'}
        </button>
        <button className="icon-btn" style={{ width: 'auto', padding: '4px 12px' }} onClick={() => window.electronAPI?.scanOnce()} title="Single snapshot scan">
          📸 Once
        </button>
        <SpotButton />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: autoAccept ? 'var(--green)' : 'var(--text-dim)', cursor: 'pointer' }} title="90%+ matches place themselves instantly. Manual slots are never overwritten.">
          <input type="checkbox" checked={autoAccept} onChange={e => useStore.getState().setAutoAccept(e.target.checked)} style={{ accentColor: 'var(--green)' }} />
          ⚡ Auto-place
        </label>
        <select value={scanIntervalMs} onChange={e => { s.setScanIntervalMs(Number(e.target.value)); if (liveScan) window.electronAPI?.setLiveScan(true, Number(e.target.value)) }}
          style={{ background: 'rgba(0,0,0,0.4)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, fontSize: 11 }}>
          <option value={3000}>3s</option>
          <option value={5000}>5s</option>
          <option value={10000}>10s</option>
        </select>
        <span style={{ fontSize: 11, color: liveScan ? 'var(--green)' : 'var(--text-dim)' }}>
          {liveScan ? `● LIVE — ${lastMatchCount} matches` : '○ idle (manual mode)'}
          {lastScan > 0 && ` — last ${new Date(lastScan).toLocaleTimeString()}`}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
        Look top-down at your base while scanning. Crop each droid's in-game look into <code>templates/</code> (named by droid id).
        3D views vary — results arrive as <strong>suggestions</strong> for you to confirm, and paint quality is always set manually.
        Best flow: aim at a droid (popup visible near the crosshair), press <strong>F9</strong> — spotted incomes land here as green chips, no mouse movement needed.
      </div>
      {suggestions.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 12, color: 'var(--gold)' }}>{suggestions.length} suggestion{suggestions.length > 1 ? 's' : ''} — tap to confirm</strong>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="icon-btn" style={{ width: 'auto', padding: '2px 10px', fontSize: 11 }} onClick={() => useStore.getState().acceptAllSuggestions()}>Accept all</button>
              <button className="icon-btn" style={{ width: 'auto', padding: '2px 10px', fontSize: 11 }} onClick={() => useStore.getState().clearSuggestions()}>Dismiss</button>
            </div>
          </div>
          {suggestions.map((sg, i) => {
            const def = getDroidDef(sg.droidId)
            if (!def) return null
            return (
              <div key={`${sg.slotId}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: 'rgba(255,200,50,0.08)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <span>{def.icon}</span>
                <span style={{ flex: 1 }}>{def.name} <span style={{ color: 'var(--text-dim)' }}>→ {sg.slotId} ({Math.round(sg.confidence * 100)}%)</span></span>
                <button className="icon-btn" style={{ width: 'auto', padding: '2px 10px', fontSize: 11, borderColor: 'var(--green)', color: 'var(--green)' }}
                  onClick={() => useStore.getState().acceptSuggestion(i)}>✓</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function DroidPickerModal({ isOpen, onClose, onSelect, category }: {
  isOpen: boolean
  onClose: () => void
  onSelect: (droid: DroidDef, quality: Quality) => void
  category: string
}) {
  const [search, setSearch] = useState('')
  const [quality, setQuality] = useState<Quality>('Default')
  const [incomeQ, setIncomeQ] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const spots = useStore(st => st.spots)
  if (!isOpen) return null

  // Income lookup: hover a droid in-game, type its income/s → narrows to
  // matching droid+quality combos and auto-selects the matched quality.
  const parsedIncome = parseIncome(incomeQ)
  const incomeHits = parsedIncome
    ? findByIncome(parsedIncome).filter(h => h.def.area === category)
    : null

  const q = search.toLowerCase()
  const rows: Array<{ d: DroidDef; q: Quality; income: number }> = incomeHits
    ? incomeHits.slice(0, 60).map(h => ({ d: h.def, q: h.quality, income: h.income }))
    : DROIDS.filter(d =>
        d.area === category &&
        d.tier !== 'Iconic' &&
        (d.name.toLowerCase().includes(q) || d.tier.toLowerCase().includes(q))
      ).slice(0, 60).map(d => ({ d, q: quality, income: getIncome(d, quality) }))

  const clampedIdx = rows.length === 0 ? 0 : Math.min(activeIdx, rows.length - 1)

  const onGridKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      setActiveIdx(i => (rows.length === 0 ? 0 : (i + 1) % rows.length))
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      setActiveIdx(i => (rows.length === 0 ? 0 : (i - 1 + rows.length) % rows.length))
    } else if (e.key === 'Enter' && rows.length > 0) {
      e.preventDefault()
      const r = rows[clampedIdx]
      onSelect(r.d, r.q)
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }} onKeyDown={onGridKey}>
        <h3 className="modal-title">Select Droid — {category} <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>(↑↓ + Enter)</span></h3>
        <input
          id="picker-search"
          autoFocus
          placeholder="Search name or tier (common/rare/epic...)"
          value={search}
          onChange={e => { setSearch(e.target.value); setActiveIdx(0) }}
          style={{ width: '100%', padding: 8, marginBottom: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(0,0,0,0.4)', color: 'var(--text)' }}
        />
        <input
          placeholder="Hover income/s in-game, type it here (e.g. 1.44k) 🔍"
          value={incomeQ}
          onChange={e => { setIncomeQ(e.target.value); setActiveIdx(0) }}
          style={{ width: '100%', padding: 8, marginBottom: 8, borderRadius: 6, border: `1px solid ${incomeHits ? 'var(--green)' : 'var(--border)'}`, background: 'rgba(0,0,0,0.4)', color: 'var(--text)' }}
        />
        {spots.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {spots.map((sp, i) => (
              <button key={i} onClick={() => { setIncomeQ(sp.text); setActiveIdx(0) }}
                title="Use OCR-spotted value"
                style={{ padding: '4px 8px', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  background: incomeQ === sp.text ? 'var(--gold)' : 'transparent',
                  color: incomeQ === sp.text ? '#000' : 'var(--green)',
                  border: '1px solid var(--green)' }}>
                🔍 {sp.text}
              </button>
            ))}
          </div>
        )}
        {incomeHits && (
          <div style={{ fontSize: 11, color: 'var(--green)', marginBottom: 8 }}>
            {incomeHits.length} match{incomeHits.length !== 1 ? 'es' : ''} for {formatIncome(parsedIncome!)} — quality auto-selected
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
          {QUALITIES.map(ql => (
            <button
              key={ql}
              onClick={() => setQuality(ql)}
              style={{
                padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                background: quality === ql ? 'var(--gold)' : 'transparent',
                color: quality === ql ? '#000' : 'var(--text-dim)',
                border: '1px solid var(--border)'
              }}
            >{ql}</button>
          ))}
        </div>
        <div className="droid-picker" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {rows.map(({ d, q, income }, ri) => (
            <button
              key={`${d.id}-${q}`}
              className="droid-option"
              data-active={ri === clampedIdx}
              style={ri === clampedIdx ? { borderColor: 'var(--gold)', background: 'rgba(255,200,50,0.12)' } : undefined}
              onMouseEnter={() => setActiveIdx(ri)}
              onClick={() => { onSelect(d, q); onClose(); }}
            >
              <div className="droid-option-icon">{d.icon}</div>
              <div className="droid-option-name">{d.name}</div>
              <div className="droid-option-value" style={{ color: 'var(--text-dim)' }}>{d.tier} {q}{d.fusion ? ' • fusion' : ''}</div>
              <div className="droid-option-value">💰 {formatIncome(income)}</div>
              <div className="droid-option-value">{formatCredits(getSellValue(d, q))}</div>
            </button>
          ))}
        </div>
        {rows.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 16 }}>No matches. Try another search.</div>}
      </div>
    </div>
  )
}

export function SpotButton() {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const spots = useStore(st => st.spots)

  const run = async () => {
    if (busy || !window.electronAPI?.spotIncomes) return
    setBusy(true)
    setNote('')
    try {
      const res = await window.electronAPI.spotIncomes()
      const spots = res?.spots ?? []
      useStore.getState().setSpots(spots)
      useStore.getState().setSpotMatchOpen(false)
      if (spots.some(sp => findByIncome(sp.value).length > 0)) {
        useStore.getState().setSpotMatchOpen(true)
      } else if (spots.length === 0) {
        const meta = res?.meta
        setNote(
          meta && meta.lines === 0
            ? 'OCR saw no text at all — popup may not have been visible, or frame was black (see app.log "ocr" lines).'
            : 'No income text caught - hover the droid in-game and press F9 instead (clicking moves the mouse off the popup).'
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <button className="icon-btn" style={{ width: 'auto', padding: '4px 12px' }} onClick={run} title="OCR: read hover income/s numbers off the game frame (one shot, offline). Better: aim + F9.">
        {busy ? '⏳ Reading…' : '🔍 Spot incomes'}
      </button>
      {spots.length > 0 && (
        <span style={{ fontSize: 11, color: 'var(--green)' }}>{spots.length} spotted — open a slot to match</span>
      )}
      {note && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{note}</span>}
    </span>
  )
}

export function BaseMap() {
  const { placeDroid, removeDroid, getPlaced, openPicker, closePicker } = useStore()
  const pickerSlot = useStore(s => s.pickerSlot)
  const pickerCategory = useStore(s => s.pickerCategory)

  const handleSlotClick = (slotId: string, category: string) => {
    const placed = getPlaced(slotId)
    if (!placed || placed.auto) {
      // Empty — or auto-placed (reopen to correct; becomes manual on select).
      // An open picker also ARMS the slot: aim + F9 with a unique income
      // match places the droid here instantly, no more taps.
      openPicker(slotId, category)
    } else {
      removeDroid(slotId)
    }
  }

  const renderSection = (title: string, category: string, slots: BaseSlot[]) => (
    <div className="section">
      <div className="section-title">{title} ({slots.length})</div>
      <div className="base-map">
        {slots.map(slot => {
          const placed = getPlaced(slot.id)
          return (
            <div key={slot.id}
              className={`slot ${placed ? 'filled' : ''}`}
              onClick={() => handleSlotClick(slot.id, category)}>
              <span className="slot-category">{placed ? `${placed.def.tier} ${placed.quality}` : category}</span>
              {placed ? (
                <>
                  <span className="slot-icon">{placed.def.icon}</span>
                  <span className="slot-name">{placed.def.name}</span>
                  <span className="slot-value">{formatCredits(placed.sell)}{placed.auto && placed.confidence ? ` ✨${Math.round(placed.confidence * 100)}%` : ''}</span>
                </>
              ) : (
                <span className="slot-name" style={{ color: 'var(--text-dim)' }}>Empty</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  const workers = getSlotsByCategory('workers')
  const astros = getSlotsByCategory('astromechs')
  const battle = getSlotsByCategory('battle')

  return (
    <>
      <LiveScanBar />
      {renderSection('Workers (Main)', 'workers', workers.slice(0, 8))}
      {renderSection('Workers (Small)', 'workers', workers.slice(8, 11))}
      {renderSection('Astromechs', 'astromechs', astros)}
      {renderSection('Battle — Floor 1', 'battle', battle.slice(0, 5))}
      {renderSection('Battle — Floor 2', 'battle', battle.slice(5, 11))}
      <DroidPickerModal
        isOpen={!!pickerSlot}
        onClose={() => closePicker()}
        category={pickerCategory}
        onSelect={(d, q) => { if (pickerSlot) placeDroid(pickerSlot, d.id, q) }}
      />
      <div className="hotkey-hint">Click a filled slot to clear it (auto-placed reopens for correction). Open a slot, then aim + F9: unique income matches place instantly. Sell values use tier multipliers (C-3PO ×2 applies in Calculator).</div>
    </>
  )
}
