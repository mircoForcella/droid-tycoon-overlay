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
// chrome — just floating cards. Staged: pick a card first (stations stay
// hidden), then a station, then Confirm. Back returns to the cards.
// Keyboard works even when the game holds the mouse: 1-9 pick, Enter
// confirms, Esc goes back / closes. Placement itself runs in the overlay
// panel (first free slot of the chosen station).
export function SpotWindow() {
  const [spots, setSpots] = useState<Spot[]>([])
  const [spotIdx, setSpotIdx] = useState(0)
  const [hitIdx, setHitIdx] = useState<number | null>(null)
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
      setHitIdx(null)
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
  const mi = matched.length === 0 ? 0 : Math.min(spotIdx, matched.length - 1)
  const cur = matched[mi]

  const close = () => window.electronAPI?.spotClose()

  const pickCard = (i: number) => {
    if (i < 0 || !cur || i >= cur.hits.length) return
    setHitIdx(i)
    setStation(null)
    setError('')
  }

  const pickStation = (id: string) => {
    if (hitIdx === null || busy) return
    setStation(id)
    setError('')
  }

  const back = () => {
    if (station !== null) {
      setStation(null)
      setError('')
    } else if (hitIdx !== null) {
      setHitIdx(null)
      setError('')
    } else {
      close()
    }
  }

  const place = async () => {
    if (busy || hitIdx === null || station === null || !cur) return
    const h = cur.hits[Math.min(hitIdx, cur.hits.length - 1)]
    setBusy(true)
    setError('')
    try {
      const res = await window.electronAPI?.spotPlace({ droidId: h.def.id, quality: h.quality, station })
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

  // Keyboard drive (works while the game holds the mouse).
  useEffect(() => {
    if (matched.length === 0) return
    return window.electronAPI?.onSpotKey?.((key: string) => {
      if (key === 'Escape') {
        back()
        return
      }
      if (key === 'Enter') {
        if (hitIdx !== null && station !== null) void place()
        return
      }
      if (key === 'Backspace') {
        back()
        return
      }
      const n = Number(key)
      if (Number.isInteger(n) && n >= 1 && n <= 9) {
        if (hitIdx === null && cur && n - 1 < cur.hits.length) {
          pickCard(n - 1)
        } else if (hitIdx !== null && station === null && n - 1 < STATIONS.length) {
          pickStation(STATIONS[n - 1].id)
        }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, spotIdx, hitIdx, station, busy])

  return (
    <div style={{ width: '100vw', height: '100vh', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', maxWidth: 580 }}>
        {matched.length === 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', background: 'rgba(0,0,0,0.72)', padding: '8px 14px', borderRadius: 8 }}>
              No match — aim at a droid and press F9 again.
            </div>
            <button className="timer-float-close" style={{ position: 'static' }} title="Close (Esc)" onClick={close}>✕</button>
          </div>
        )}

        {cur && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.72)', padding: '3px 10px', borderRadius: 6, textShadow: '0 1px 3px #000' }}>
                {cur.sp.text} ({formatIncome(cur.sp.value)}) — pick the droid
              </div>
              <button className="timer-float-close" style={{ position: 'static' }} title="Close (Esc)" onClick={close}>✕</button>
            </div>
            {matched.length > 1 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                {matched.map((m, i) => (
                  <button key={i} onClick={() => { setSpotIdx(i); setHitIdx(null); setStation(null); setError('') }}
                    style={{ padding: '4px 8px', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                      background: i === mi ? 'var(--gold)' : 'rgba(0,0,0,0.72)',
                      color: i === mi ? '#000' : 'var(--green)',
                      border: '1px solid var(--green)' }}>
                    🔍 {m.sp.text}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {cur.hits.map((h, i) => {
                const card = getDroidCard(h.def.id)
                const picked = hitIdx === i
                return (
                  <button key={`${h.def.id}-${h.quality}`} onClick={() => pickCard(i)}
                      className={`rebirth-card spot-card${picked ? ' spot-pick' : ''}`}
                      style={{ width: 180 }} title={`${h.def.name} (${h.quality})`}>
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

            {hitIdx !== null && (() => {
              const h = cur.hits[Math.min(hitIdx, cur.hits.length - 1)]
              return (
                <>
                  <div style={{ fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.72)', padding: '3px 10px', borderRadius: 6, textShadow: '0 1px 3px #000' }}>
                    {h.def.name} ({h.quality}) — pick a station
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                    {STATIONS.map(s => (
                      <button key={s.id} disabled={busy}
                        onClick={() => pickStation(s.id)}
                        style={{ padding: '6px 16px', borderRadius: 6, cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 800,
                          background: station === s.id ? 'var(--gold)' : 'rgba(0,0,0,0.72)',
                          color: station === s.id ? '#000' : '#fff',
                          border: '1px solid var(--gold)', textShadow: station === s.id ? 'none' : '0 1px 3px #000' }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {station !== null && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.72)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--gold)' }}>
                      <span style={{ fontSize: 12, color: '#fff' }}>
                        Place {h.def.name} → {STATIONS.find(s => s.id === station)?.label}?
                      </span>
                      <button disabled={busy}
                        onClick={() => void place()}
                        style={{ padding: '4px 14px', borderRadius: 6, cursor: busy ? 'wait' : 'pointer', fontSize: 12, fontWeight: 800,
                          background: 'var(--green)', color: '#000', border: 'none' }}>
                        {busy ? '⏳…' : '✅ Confirm (Enter)'}
                      </button>
                      <button disabled={busy} onClick={back}
                        style={{ padding: '4px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                          background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
                        ← Back
                      </button>
                    </div>
                  )}
                </>
              )
            })()}
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', background: 'rgba(0,0,0,0.55)', padding: '2px 10px', borderRadius: 6, textShadow: '0 1px 3px #000' }}>
              keys: 1–{Math.max(cur.hits.length, STATIONS.length)} pick • Enter confirm • Esc back/close
            </div>
            {error && <div style={{ fontSize: 12, color: '#ff8080', background: 'rgba(0,0,0,0.72)', padding: '4px 10px', borderRadius: 6 }}>{error}</div>}
          </>
        )}
      </div>
    </div>
  )
}
