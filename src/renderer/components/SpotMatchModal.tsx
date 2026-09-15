import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { ALL_SLOTS } from '../data/droids'
import { findByIncome, formatIncome } from '../data/income'
import { formatCredits, getSellValue } from '../data/droidValues'
import { getDroidCard } from '../data/droidCards'

const STATIONS = [
  { id: 'workers', label: 'Workers' },
  { id: 'astromechs', label: 'Astromechs' },
  { id: 'battle', label: 'Battle' }
] as const

// Post-spot match popup (F9 result): confirm the card — or pick one of
// several — then choose station + free slot. Income pins the quality, so
// there is no quality step: every hit already is droid+quality.
export function SpotMatchModal() {
  const spots = useStore(s => s.spots)
  const placed = useStore(s => s.placedDroids)
  const [spotIdx, setSpotIdx] = useState(0)
  const [hitIdx, setHitIdx] = useState(0)
  const [station, setStation] = useState<string | null>(null)
  const [slotId, setSlotId] = useState<string | null>(null)

  const matched = useMemo(
    () =>
      spots
        .map(sp => ({ sp, hits: findByIncome(sp.value) }))
        .filter(x => x.hits.length > 0),
    [spots]
  )
  if (matched.length === 0) return null
  const mi = Math.min(spotIdx, matched.length - 1)
  const { sp, hits } = matched[mi]
  const hi = Math.min(hitIdx, hits.length - 1)
  const hit = hits[hi]

  const stationId = station ?? (STATIONS.some(s => s.id === hit.def.area) ? hit.def.area : 'workers')
  const taken = new Set(placed.map(p => p.slotId))
  const freeOf = (cat: string) => ALL_SLOTS.filter(s => s.category === cat && !taken.has(s.id))
  const slots = ALL_SLOTS.filter(s => s.category === stationId)
  const free = slots.filter(s => !taken.has(s.id))
  const pretty = (id: string) => {
    const list = slots.map(s => s.id)
    return `${stationId === 'workers' ? 'W' : stationId === 'astromechs' ? 'A' : 'B'}-${list.indexOf(id) + 1}`
  }

  const close = () => useStore.getState().setSpotMatchOpen(false)
  const pick = (fn: () => void) => () => {
    setSlotId(null)
    fn()
  }
  const place = () => {
    if (!slotId) return
    useStore.getState().placeDroid(slotId, hit.def.id, hit.quality)
    useStore.getState().showToast(`✅ Placed ${hit.def.name} (${hit.quality}) — ${formatCredits(getSellValue(hit.def, hit.quality))}`)
    close()
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3 className="modal-title">
          Spotted {sp.text} ({formatIncome(sp.value)}) — {hits.length === 1 ? 'is this correct?' : 'pick the droid'}
        </h3>

        {matched.length > 1 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {matched.map((m, i) => (
              <button key={i} onClick={pick(() => { setSpotIdx(i); setHitIdx(0); setStation(null) })}
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
          {hits.map((h, i) => {
            const card = getDroidCard(h.def.id)
            return (
              <button key={`${h.def.id}-${h.quality}`} onClick={() => { setHitIdx(i); setSlotId(null) }}
                className={`rebirth-card spot-card${i === hi ? ' spot-pick' : ''}`}>
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

        <div className="section-title" style={{ marginTop: 12 }}>Station</div>
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

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="icon-btn" style={{ width: 'auto', padding: '4px 12px' }} onClick={close}>Cancel</button>
          <button className="icon-btn" style={{ width: 'auto', padding: '4px 12px', borderColor: 'var(--green)', color: 'var(--green)' }}
            disabled={!slotId} onClick={place}>
            ✅ Place {hit.def.name} → {slotId ? pretty(slotId) : '…'}
          </button>
        </div>
      </div>
    </div>
  )
}
