import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { ALL_SLOTS } from '../data/droids'
import { findByIncome, formatIncome } from '../data/income'
import { formatCredits, getDroidDef, getSellValue } from '../data/droidValues'
import { getDroidCard } from '../data/droidCards'

const STATIONS = [
  { id: 'workers', label: 'Workers' },
  { id: 'astromechs', label: 'Astromechs' },
  { id: 'battle', label: 'Battle' }
] as const

// Step 1 (F9 result): confirm the card — or pick one of several.
// Income already pins the quality; clicking a card opens step 2.
export function SpotMatchModal() {
  const spots = useStore(s => s.spots)

  const matched = useMemo(
    () =>
      spots
        .map(sp => ({ sp, hits: findByIncome(sp.value) }))
        .filter(x => x.hits.length > 0),
    [spots]
  )
  const [spotIdx, setSpotIdx] = useState(0)
  if (matched.length === 0) return null
  const mi = Math.min(spotIdx, matched.length - 1)
  const { sp, hits } = matched[mi]

  const closeAll = () => {
    useStore.getState().setSpotMatchOpen(false)
    useStore.getState().setSpotPlace(null)
  }
  const select = (droidId: string, quality: (typeof hits)[number]['quality']) => {
    useStore.getState().setSpotPlace({ droidId, quality })
    useStore.getState().setSpotMatchOpen(false)
  }

  return (
    <div className="modal-overlay" onClick={closeAll}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3 className="modal-title">
          Spotted {sp.text} ({formatIncome(sp.value)}) — {hits.length === 1 ? 'is this correct?' : 'pick the droid'}
        </h3>

        {matched.length > 1 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {matched.map((m, i) => (
              <button key={i} onClick={() => setSpotIdx(i)}
                style={{ padding: '4px 8px', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  background: i === mi ? 'var(--gold)' : 'transparent',
                  color: i === mi ? '#000' : 'var(--green)',
                  border: '1px solid var(--green)' }}>
                🔍 {m.sp.text}
              </button>
            ))}
          </div>
        )}

        <div className="droid-picker" style={{ gridTemplateColumns: `repeat(${Math.min(hits.length, 3)}, 1fr)` }}>
          {hits.map(h => {
            const card = getDroidCard(h.def.id)
            return (
              <button key={`${h.def.id}-${h.quality}`} onClick={() => select(h.def.id, h.quality)}
                className="rebirth-card spot-card" title={`Place ${h.def.name} (${h.quality})`}>
                {card ? (
                  <img src={card} alt={h.def.name} className="rebirth-card-bg" loading="lazy" />
                ) : (
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 54 }}>{h.def.icon}</span>
                )}
                <div className="rebirth-card-scrim" />
                <div className="rebirth-card-body">
                  <div className="rebirth-card-name">{h.def.name}</div>
                  <div>
                    <div className="rebirth-card-sub">{h.def.tier} {h.quality}{h.def.fusion ? ' • fusion' : ''}</div>
                    <div className="rebirth-card-sub">💰 {formatIncome(h.income)}</div>
                    <div className="rebirth-card-sell">{formatCredits(getSellValue(h.def, h.quality))}</div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="icon-btn" style={{ width: 'auto', padding: '4px 12px' }} onClick={closeAll}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// Step 2 (separate interface): pick station, then the exact free slot.
// Closes on place (F3 Droids tab updates itself from the store).
export function SpotPlaceModal() {
  const pending = useStore(s => s.spotPlace)
  const placed = useStore(s => s.placedDroids)
  const [station, setStation] = useState<string | null>(null)
  const [slotId, setSlotId] = useState<string | null>(null)
  if (!pending) return null

  const stationId = station ?? 'workers'
  const taken = new Set(placed.map(p => p.slotId))
  const freeOf = (cat: string) => ALL_SLOTS.filter(s => s.category === cat && !taken.has(s.id))
  const free = freeOf(stationId)
  const pretty = (id: string) => {
    const list = ALL_SLOTS.filter(s => s.category === stationId).map(s => s.id)
    return `${stationId === 'workers' ? 'W' : stationId === 'astromechs' ? 'A' : 'B'}-${list.indexOf(id) + 1}`
  }

  const closeAll = () => {
    useStore.getState().setSpotPlace(null)
    useStore.getState().setSpotMatchOpen(false)
  }
  const back = () => {
    setSlotId(null)
    useStore.getState().setSpotPlace(null)
    useStore.getState().setSpotMatchOpen(true)
  }
  const place = () => {
    if (!slotId) return
    const st = useStore.getState()
    st.placeDroid(slotId, pending.droidId, pending.quality)
    const def = getDroidDef(pending.droidId)
    if (def) st.showToast(`✅ Placed ${def.name} (${pending.quality}) — ${formatCredits(getSellValue(def, pending.quality))}`)
    st.setSpotPlace(null)
    st.setSpotMatchOpen(false)
  }

  return (
    <div className="modal-overlay" onClick={closeAll}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h3 className="modal-title">Where to place it?</h3>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {STATIONS.map(s => (
            <button key={s.id} onClick={() => { setStation(s.id); setSlotId(null) }}
              style={{ padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: stationId === s.id ? 'var(--gold)' : 'transparent',
                color: stationId === s.id ? '#000' : 'var(--text)',
                border: '1px solid var(--border)' }}>
              {s.label} ({freeOf(s.id).length} free)
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
          {free.map(s => (
            <button key={s.id} onClick={() => setSlotId(s.id)}
              style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: slotId === s.id ? 'var(--green)' : 'transparent',
                color: slotId === s.id ? '#000' : 'var(--text)',
                border: '1px solid var(--green)' }}>
              {pretty(s.id)}
            </button>
          ))}
          {free.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Station full — free a slot first.</span>}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button className="icon-btn" style={{ width: 'auto', padding: '4px 12px' }} onClick={back}>← Droids</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="icon-btn" style={{ width: 'auto', padding: '4px 12px' }} onClick={closeAll}>Cancel</button>
            <button className="icon-btn" style={{ width: 'auto', padding: '4px 12px', borderColor: 'var(--green)', color: 'var(--green)' }}
              disabled={!slotId} onClick={place}>
              ✅ Place → {slotId ? pretty(slotId) : '…'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
