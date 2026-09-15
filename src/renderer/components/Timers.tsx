import { useEffect, useState } from 'react'
import { useStore } from '../store'

// Spawn schedule (local time):
// - Stellar: top of every hour (:00) — YELLOW
// - Mythic: every hour at :55 — PINK/RED
// - Galactic: fixed twice hourly, at :15 and :45 — PURPLE.
//   Never collides with :00 or :55.

function nextOccurrence(minutes: number[]): Date {
  const now = new Date()
  const candidate = new Date(now)
  candidate.setSeconds(0, 0)
  for (const m of minutes) {
    candidate.setMinutes(m)
    if (candidate.getTime() > now.getTime()) return candidate
  }
  candidate.setHours(candidate.getHours() + 1)
  candidate.setMinutes(minutes[0])
  return candidate
}

function fmt(ms: number): string {
  if (ms <= 0) return 'NOW'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = m.toString().padStart(2, '0')
  const ss = sec.toString().padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function Timers({ bare = false, showGrip = false }: { bare?: boolean; showGrip?: boolean }) {
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const now = Date.now()
  const stellar = nextOccurrence([0])
  const mythic = nextOccurrence([55])
  const galactic = nextOccurrence([15, 45])

  const cards = [
    { name: 'Stellar', at: stellar, cls: 'stellar', label: 'Top of hour' },
    { name: 'Mythic', at: mythic, cls: 'mythic', label: 'At :55 hourly' },
    { name: 'Galactic', at: galactic, cls: 'galactic', label: 'At :15 + :45 hourly' }
  ]

  const opacity = useStore(s => s.timerBgOpacity) / 100
  // Fill is always neutral black — only border + font carry the tier color,
  // so contrast stays high at any opacity.
  const bg = `rgba(0,0,0,${opacity})`

  if (bare) {
    return (
      <div className="timer-float-cards">
        {showGrip && <span className="timer-grip" title="Drag to move">⋮⋮</span>}
        {cards.map(c => {
          const left = c.at.getTime() - now
          return (
            <div key={c.name} className={`timer-chip ${c.cls}`} title={`${c.name} — ${c.label}, next ${fmtClock(c.at)}`} style={{ backgroundColor: bg }}>
              <span className="timer-chip-name">{c.name}</span>
              <span className={`timer-chip-value${left <= 0 ? ' now-flash' : ''}`}>{fmt(left)}</span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div>
      <div className="section-title">Spawn Timers</div>
      <div style={{ marginBottom: 12 }}>
        <button className="icon-btn" style={{ width: 'auto', padding: '4px 12px' }} onClick={() => useStore.getState().setTimersDetached(true)}>
          ⧉ Pop out to floating window
        </button>
      </div>
      <div className="timer-grid" style={{ gridTemplateColumns: '1fr' }}>
        {cards.map(c => {
          const left = c.at.getTime() - now
          return (
            <div key={c.name} className={`timer-card ${c.cls}`}>
              <div className="timer-name">{c.name} — {c.label}</div>
              <div className={`timer-value ${c.cls}${left <= 0 ? ' now-flash' : ''}`}>{fmt(left)}</div>
              <div className="timer-label">Next: {fmtClock(c.at)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
