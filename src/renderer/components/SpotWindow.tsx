import { useEffect, useMemo, useState } from 'react'
import { findByIncome, formatIncome } from '../data/income'
import { formatCredits, getSellValue } from '../data/droidValues'
import { getDroidCard } from '../data/droidCards'
import { PaintTag, TierTag } from './RarityTags'

interface Spot {
  text: string
  value: number
  rx: number
  ry: number
}

const STATIONS = [
  { id: 'workers', label: 'Workers' },
  { id: 'astromechs', label: 'Astromechs' },
  { id: 'battle', label: 'Battle' }
] as const

// Floating F9 result window (loaded with #spot): transparent, no panel, no
// chrome — just the match cards, then station buttons. Closes on place or ✕.
// Placement itself runs in the overlay panel (first free slot of the chosen
// station); this window only collects the two decisions.
export function SpotWindow() {
  const [spots, setSpots] = useState<Spot[]>([])
  const [spotIdx, setSpotIdx] = useState(0)
  const [hitIdx, setHitIdx] = useState(0)
  const [station, setStation] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.electronAPI?.getSpotData?.().then(s => {
      if (Array.isArray(s)) setSpots(s)
    }).catch(() => {})
    return window.electronAPI?.onSpotData?.((s) => {
      setSpots(Array.isArray(s) ? s : [])
      setSpotIdx(0)
      setHitIdx(0)
      setStation(null)
      setBusy(false)
      setError('')
    })
  }, [])

  const matched = useMemo(
    () =>
      spots
        .map(sp => ({ sp, hits: findByIncome(sp.value) }))
        .filter(x => x.hits.length > 0),
    [spots]
  )

  const close = () => window.electronAPI?.spotClose()

  const place = async (droidId: string, quality: string, stationId: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await window.electronAPI?.spotPlace({ droidId, quality, station: stationId })
      if (res?.ok) {
        window.electronAPI?.spotClose()
      } else {
        setError(res?.message || 'Placement failed.')
      }
    } catch {
      setError('Placement failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', maxWidth: 560 }}>
        <div style={{ display: 'flex', width: '100%', justifyContent: 'flex-end' }}>
          <button className="timer-float-close" title="Close" onClick={close} style={{ position: 'static', fontSize: 16 }}>✕</button>
        </div>

        {matched.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', background: 'rgba(0,0,0,0.72)', padding: '8px 14px', borderRadius: 8 }}>
            No match — aim at a droid and press F9 again.
          </div>
        )}

        {matched.length > 1 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
            {matched.map((m, i) => (
              <button key={i} onClick={() => { setSpotIdx(i); setHitIdx(0); setStation(null); setError('') }}
                style={{ padding: '4px 8px', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  background: i === Math.min(spotIdx, matched.length - 1) ? 'var(--gold)' : 'rgba(0,0,0,0.72)',
                  color: i === Math.min(spotIdx, matched.length - 1) ? '#000' : 'var(--green)',
                  border: '1px solid var(--green)' }}>
                🔍 {m.sp.text}
              </button>
            ))}
          </div>
        )}

        {matched.length > 0 && (() => {
          const mi = Math.min(spotIdx, matched.length - 1)
          const { sp, hits } = matched[mi]
          const hi = Math.min(hitIdx, hits.length - 1)
          return (
            <>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                {hits.map((h, i) => {
                  const card = getDroidCard(h.def.id)
                  return (
                    <button key={`${h.def.id}-${h.quality}`} onClick={() => { setHitIdx(i); setStation(null); setError('') }}
                      className={`rebirth-card spot-card${i === hi ? ' spot-pick' : ''}`}
                      style={{ width: 150 }} title={`${h.def.name} (${h.quality})`}>
                      {card ? (
                        <img src={card} alt={h.def.name} className="rebirth-card-bg" loading="lazy" />
                      ) : (
                        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 54 }}>{h.def.icon}</span>
                      )}
                      <div className="rebirth-card-scrim" />
                      <div className="rebirth-card-body">
                        <div className="rebirth-card-name">{h.def.name}</div>
                        <div>
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center', marginBottom: 3 }}>
                            <TierTag tier={h.def.tier} />
                            <PaintTag quality={h.quality} />
                          </div>
                          {h.def.fusion && <div className="rebirth-card-sub">• fusion</div>}
                          <div className="rebirth-card-sub">💰 {formatIncome(h.income)}</div>
                          <div className="rebirth-card-sell">{formatCredits(getSellValue(h.def, h.quality))}</div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div style={{ fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.72)', padding: '3px 10px', borderRadius: 6, textShadow: '0 1px 3px #000' }}>
                {sp.text} ({formatIncome(sp.value)}) — pick a station for {hits[hi].def.name}
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                {STATIONS.map(s => (
                  <button key={s.id} disabled={busy}
                    onClick={() => { setStation(s.id); void place(hits[hi].def.id, hits[hi].quality, s.id) }}
                    style={{ padding: '6px 16px', borderRadius: 6, cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 800,
                      background: station === s.id ? 'var(--gold)' : 'rgba(0,0,0,0.72)',
                      color: station === s.id ? '#000' : '#fff',
                      border: '1px solid var(--gold)', textShadow: station === s.id ? 'none' : '0 1px 3px #000' }}>
                    {s.label}
                  </button>
                ))}
              </div>
              {busy && <div style={{ fontSize: 12, color: '#fff', textShadow: '0 1px 3px #000' }}>⏳ Placing…</div>}
              {error && <div style={{ fontSize: 12, color: '#ff8080', background: 'rgba(0,0,0,0.72)', padding: '4px 10px', borderRadius: 6 }}>{error}</div>}
            </>
          )
        })()}
      </div>
    </div>
  )
}
